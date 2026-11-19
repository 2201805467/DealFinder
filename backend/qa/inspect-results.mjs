import fs from 'node:fs';
for (const name of [
  'performance-baseline',
  'performance-final',
  'index-measurement',
  'parallelism',
  'backend-verification',
  'apk-builds',
]) {
  const j = JSON.parse(fs.readFileSync(`../docs/qa-evidence/${name}.json`));
  if (j.datasets)
    console.log(
      name,
      JSON.stringify({
        environment: j.environment,
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        datasets: j.datasets.map((d) => ({
          products: d.products,
          stopped: d.stoppedEscalationAt,
          cases: d.cases.map((c) => ({
            name: c.name,
            vu: c.connections,
            rps: c.rps,
            p95: c.p95Ms,
            errorRate: c.errorRate,
          })),
        })),
      }),
    );
  else console.log(name, JSON.stringify(j));
}
