import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const stat = fs.statfsSync(process.cwd());
console.log(
  JSON.stringify({
    freeRAMMB: Math.round(os.freemem() / 1048576),
    freeDiskMB: Math.round((stat.bavail * stat.bsize) / 1048576),
  }),
);
for (const name of [
  'parallelism',
  'performance-final',
  'performance-after-large',
]) {
  const path = `../docs/qa-evidence/${name}.json`;
  if (!fs.existsSync(path)) continue;
  const j = JSON.parse(fs.readFileSync(path));
  console.log(
    name,
    JSON.stringify({
      done: j.finishedAt,
      cases: j.cases?.map((x) => ({
        workers: x.parallelWorkers,
        ok: x.ok,
        failed: x.failures.length,
      })),
      datasets: j.datasets?.map((d) => ({
        n: d.products,
        cases: d.cases.length,
      })),
    }),
  );
}
try {
  console.log(
    execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      timeout: 5000,
    })
      .split(/\r?\n/)
      .filter((v) => /dart|powershell|java|node.exe/i.test(v))
      .join('\n'),
  );
} catch {}
