import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const label = process.argv[2];
if (!/^phase7-[a-z-]+$/.test(label ?? ''))
  throw new Error('Use a phase7 evidence label.');
const r = spawnSync(
  'C:/Users/taham/AppData/Local/Android/Sdk/platform-tools/adb.exe',
  ['exec-out', 'screencap', '-p'],
  { maxBuffer: 16 * 1024 * 1024 },
);
if (
  r.status !== 0 ||
  !r.stdout
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
)
  throw new Error('Android capture failed.');
const target = '../docs/qa-evidence/' + label + '.png';
fs.writeFileSync(target, r.stdout);
console.log(target);
