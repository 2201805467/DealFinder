import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const steps = [
  [
    'format',
    [
      'node_modules/prettier/bin/prettier.cjs',
      '--write',
      'src',
      'tests',
      'qa',
      'package.json',
    ],
  ],
  ['prisma-format', ['node_modules/prisma/build/index.js', 'format']],
  ['generate', ['node_modules/prisma/build/index.js', 'generate']],
  ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']],
  ['migrate', ['node_modules/prisma/build/index.js', 'migrate', 'deploy']],
  [
    'unit',
    [
      '--import',
      'tsx',
      '--test',
      ...fs
        .readdirSync('tests')
        .filter((v) => v.endsWith('.test.ts'))
        .map((v) => 'tests/' + v),
    ],
  ],
  ['integration', ['--import', 'tsx', 'src/scripts/test-database.ts']],
  [
    'migration-status',
    ['node_modules/prisma/build/index.js', 'migrate', 'status'],
  ],
];
const report = { checkedAt: new Date().toISOString(), steps: [] };
for (const [name, args] of steps) {
  const start = performance.now();
  const r = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  const text = (r.stdout ?? '') + (r.stderr ?? '');
  fs.writeFileSync(`../docs/qa-evidence/backend-${name}.log`, text);
  const row = {
    name,
    exitCode: r.status,
    durationMs: performance.now() - start,
    tests: text.match(/(?:ℹ |# )tests (\d+)/)?.[1],
    failed: text.match(/(?:ℹ |# )fail (\d+)/)?.[1],
  };
  report.steps.push(row);
  console.log(JSON.stringify(row));
  if (r.status !== 0) {
    console.log(text.slice(-6000));
    process.exitCode = 1;
  }
  fs.writeFileSync(
    '../docs/qa-evidence/backend-verification.json',
    JSON.stringify(report, null, 2),
  );
}
