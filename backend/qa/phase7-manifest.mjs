import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const target = '../docs/qa-evidence/phase7-files.txt';
fs.writeFileSync(target, 'Phase 7 working tree file manifest\n');
const result = spawnSync(
  'git',
  ['status', '--short', '--untracked-files=all'],
  { cwd: '..', encoding: 'utf8' },
);
if (result.status !== 0) throw new Error('Cannot read working-tree manifest.');
fs.writeFileSync(
  target,
  'Phase 7 — ' +
    new Date().toISOString() +
    '\nM = modified, ?? = new/untracked. Generated Prisma client and build artifacts are ignored.\n\n' +
    result.stdout,
);
console.log(target);
