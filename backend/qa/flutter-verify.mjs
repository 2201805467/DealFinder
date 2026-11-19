import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const dart = 'C:/flutter/bin/cache/dart-sdk/bin/dart.exe';
const snapshot = 'C:/flutter/bin/cache/flutter_tools.snapshot';
const report = { checkedAt: new Date().toISOString(), steps: [] };
for (const [name, args] of [
  ['format', ['format', 'lib', 'test', 'tool']],
  ['analyze', [snapshot, 'analyze']],
  ['tests', [snapshot, 'test', '--reporter', 'expanded']],
]) {
  const start = performance.now();
  const result = spawnSync(dart, args, {
    cwd: '../mobile',
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  fs.writeFileSync(`../docs/qa-evidence/flutter-${name}.log`, output);
  const row = {
    name,
    exitCode: result.status,
    durationMs: performance.now() - start,
    error: result.error?.code,
  };
  if (name === 'tests')
    row.passed = Number(
      [...output.matchAll(/\+(\d+).*All tests passed!/g)].at(-1)?.[1] ?? 0,
    );
  report.steps.push(row);
  console.log(JSON.stringify(row));
  if (result.status !== 0) {
    console.log(output.slice(-6000));
    process.exitCode = 1;
  }
  fs.writeFileSync(
    '../docs/qa-evidence/flutter-verification.json',
    JSON.stringify(report, null, 2),
  );
}
