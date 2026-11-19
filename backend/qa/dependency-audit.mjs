import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
if (fs.existsSync('audit-before.json')) {
  const before = fs.readFileSync('audit-before.json');
  const raw =
    before[0] === 255
      ? before.toString('utf16le').replace(/^\uFEFF/, '')
      : before.toString('utf8');
  fs.writeFileSync(
    '../docs/qa-evidence/npm-audit-before.json',
    JSON.stringify(JSON.parse(raw), null, 2),
  );
  // The converted audit above is the retained evidence; discard only our duplicate.
  fs.unlinkSync('audit-before.json');
}
const npm = path.join(
  path.dirname(process.execPath),
  'node_modules/npm/bin/npm-cli.js',
);
try {
  const result = execFileSync(process.execPath, [npm, 'audit', '--json'], {
    encoding: 'utf8',
  });
  fs.writeFileSync('../docs/qa-evidence/npm-audit-after.json', result);
  console.log('npm audit saved');
} catch (e) {
  if (e.stdout)
    fs.writeFileSync('../docs/qa-evidence/npm-audit-after.json', e.stdout);
  else console.log('npm audit unavailable');
}
const packages = [];
let p;
for (const line of fs
  .readFileSync('../mobile/pubspec.lock', 'utf8')
  .split(/\r?\n/)) {
  const m = line.match(/^  ([a-z_0-9]+):$/);
  if (m) p = { name: m[1], hosted: false };
  if (p && line === '    source: hosted') p.hosted = true;
  const v = line.match(/^    version: "?([^"\s]+)"?$/);
  if (p?.hosted && v)
    packages.push({
      package: { name: p.name, ecosystem: 'Pub' },
      version: v[1],
    });
}
try {
  const r = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: packages }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error('OSV HTTP failure');
  const j = await r.json();
  const findings = j.results.flatMap((v, i) =>
    (v.vulns ?? []).map((x) => ({
      package: packages[i].package.name,
      version: packages[i].version,
      id: x.id,
    })),
  );
  const report = {
    checkedAt: new Date().toISOString(),
    tool: 'OSV querybatch',
    packagesScanned: packages.length,
    findings,
  };
  fs.writeFileSync(
    '../docs/qa-evidence/flutter-osv.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch {
  fs.writeFileSync(
    '../docs/qa-evidence/flutter-osv.json',
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      error: 'OSV unavailable; no clean audit claimed',
      packagesScanned: 0,
    }),
  );
  console.log('OSV unavailable');
}
