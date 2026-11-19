import fs from 'node:fs';
const probe = JSON.parse(
  fs.readFileSync('../docs/qa-evidence/optimization-probe.json'),
);
function plan(p, depth = 0) {
  console.log(
    ' '.repeat(depth),
    p['Node Type'],
    JSON.stringify({
      ms: p['Actual Total Time'],
      rows: p['Actual Rows'],
      loops: p['Actual Loops'],
      tempRead: p['Temp Read Blocks'],
      tempWritten: p['Temp Written Blocks'],
      batches: p['Hash Batches'],
      sort: p['Sort Method'],
      filter: p.Filter,
    }),
  );
  for (const child of p.Plans ?? []) plan(child, depth + 1);
}
for (const c of probe.cases) {
  console.log(c.name, c.executionMs);
  plan(c.plan.Plan);
}
for (const name of ['optimization-before', 'optimization-after']) {
  const path = `../docs/qa-evidence/performance-${name}.json`;
  if (!fs.existsSync(path)) continue;
  const p = JSON.parse(fs.readFileSync(path));
  console.log(
    name,
    JSON.stringify({
      stopped: p.stopped,
      finishedAt: p.finishedAt,
      datasets: p.datasets.map((d) => ({
        n: d.products,
        cases: d.cases.map((c) => ({
          name: c.name,
          vu: c.connections,
          seconds: c.durationSeconds,
          ok: c.successfulRps,
          p95: c.p95Ms,
          error: c.errorRate,
        })),
      })),
    }),
  );
}
