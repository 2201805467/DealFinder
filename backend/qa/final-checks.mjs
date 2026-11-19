import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { spawnSync, execFileSync } from 'node:child_process';
import { parse } from 'dotenv';
import { createDatabaseClient } from '../dist/database/client.js';
import { assertTestDatabase } from '../dist/database/development-guard.js';
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/dealfinder_qa_test';
assertTestDatabase(url.href, process.env.DATABASE_URL);
const migrate = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  {
    env: {
      ...process.env,
      DATABASE_URL: url.href,
      MIGRATION_DATABASE_URL: url.href,
    },
    encoding: 'utf8',
  },
);
if (migrate.status !== 0) throw Error('QA migration failed');
const db = createDatabaseClient(url.href);
const report = {
  checkedAt: new Date().toISOString(),
  migrationExitCode: migrate.status,
  deepPagination: [],
  apks: [],
};
try {
  const { CatalogService } = await import('../dist/services/catalog.js');
  const catalog = new CatalogService(db, true);
  report.products = await db.product.count();
  for (const page of [1, 100, 1000, 5000]) {
    const start = performance.now();
    const result = await catalog.deals({
      page,
      pageSize: 20,
      currency: 'USD',
      sort: 'newest',
    });
    report.deepPagination.push({
      page,
      offset: (page - 1) * 20,
      milliseconds: performance.now() - start,
      items: result.data.length,
      total: result.pagination.total,
    });
  }
  const files = ['.env', '.env.test'];
  const values = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const [key, value] of Object.entries(parse(fs.readFileSync(file)))) {
      if (/DATABASE_URL/.test(key)) {
        const secret = new URL(value).password;
        if (secret.length >= 8) values.push(decodeURIComponent(secret));
      } else if (
        /KEY|TOKEN|SECRET|PASSWORD/.test(key) &&
        value.length >= 8 &&
        !/placeholder|replace|change|example/i.test(value)
      )
        values.push(value);
    }
  }
  const secrets = [...new Set(values)];
  for (const mode of ['debug', 'release']) {
    const file = `../mobile/build/app/outputs/flutter-apk/app-${mode}.apk`;
    if (!fs.existsSync(file)) continue;
    const zip = fs.readFileSync(file);
    let end = -1;
    for (let p = zip.length - 22; p >= Math.max(0, zip.length - 65557); p--) {
      if (zip.readUInt32LE(p) === 0x06054b50) {
        end = p;
        break;
      }
    }
    if (end < 0) throw Error('Invalid APK ZIP');
    const count = zip.readUInt16LE(end + 10);
    let position = zip.readUInt32LE(end + 16);
    let scanned = 0,
      findings = 0,
      utf16findings = 0;
    for (let i = 0; i < count; i++) {
      if (zip.readUInt32LE(position) !== 0x02014b50)
        throw Error('Invalid ZIP directory');
      const compression = zip.readUInt16LE(position + 10),
        size = zip.readUInt32LE(position + 20),
        nameLength = zip.readUInt16LE(position + 28),
        extra = zip.readUInt16LE(position + 30),
        comment = zip.readUInt16LE(position + 32),
        offset = zip.readUInt32LE(position + 42);
      const name = zip
        .subarray(position + 46, position + 46 + nameLength)
        .toString();
      position += 46 + nameLength + extra + comment;
      if (name.endsWith('/')) continue;
      const start =
        offset +
        30 +
        zip.readUInt16LE(offset + 26) +
        zip.readUInt16LE(offset + 28);
      const data = zip.subarray(start, start + size);
      const bytes =
        compression === 0
          ? data
          : compression === 8
            ? inflateRawSync(data, { maxOutputLength: 256 * 1024 * 1024 })
            : null;
      if (!bytes) throw Error('Unsupported APK ZIP compression');
      scanned++;
      for (const secret of secrets) {
        if (bytes.includes(Buffer.from(secret))) findings++;
        if (bytes.includes(Buffer.from(secret, 'utf16le'))) utf16findings++;
      }
    }
    report.apks.push({
      mode,
      bytes: zip.length,
      entriesScanned: scanned,
      configuredSecretValuesChecked: secrets.length,
      findings,
      utf16findings,
      modifiedAt: fs.statSync(file).mtime.toISOString(),
    });
    if (findings || utf16findings)
      throw Error('Configured secret found in APK; values withheld');
  }
  report.trackedEnvFiles = execFileSync(
    'git',
    ['ls-files', '--', '**/.env', '**/.env.*'],
    { cwd: '..', encoding: 'utf8' },
  )
    .split(/\r?\n/)
    .filter((v) => v && !v.endsWith('.example'));
  if (report.trackedEnvFiles.length)
    throw Error('Sensitive environment file tracked');
  const adb = path.join(
    process.env.LOCALAPPDATA,
    'Android/Sdk/platform-tools/adb.exe',
  );
  report.adbDevices = execFileSync(adb, ['devices'], {
    encoding: 'utf8',
    timeout: 15000,
  }).trim();
  const device = report.adbDevices.match(/(emulator-\d+)\s+device/);
  if (device) {
    report.emulatorStorage = execFileSync(
      adb,
      ['-s', device[1], 'shell', 'df', '-h', '/data'],
      { encoding: 'utf8', timeout: 15000 },
    );
  }
  fs.writeFileSync(
    '../docs/qa-evidence/final-checks.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await db.$disconnect();
}
