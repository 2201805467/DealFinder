import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Dedicated loopback port used only by this phase's explicitly launched acceptance server.
const result = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], {
  encoding: 'utf8',
});
const pids = [
  ...new Set(
    (result.stdout ?? '')
      .split('\n')
      .map(
        (line) =>
          line.match(
            /^\s*TCP\s+127\.0\.0\.1:3337\s+\S+\s+LISTENING\s+(\d+)/,
          )?.[1],
      )
      .filter(Boolean),
  ),
];
const wmic = 'C:/Windows/System32/wbem/WMIC.exe';
for (const pid of pids) {
  const command = fs.existsSync(wmic)
    ? (spawnSync(
        wmic,
        [
          'process',
          'where',
          'ProcessId=' + pid,
          'get',
          'CommandLine',
          '/value',
        ],
        { encoding: 'utf8' },
      ).stdout ?? '')
    : '';
  const fallback = fs.existsSync(wmic)
    ? ''
    : (spawnSync(
        'cscript.exe',
        [
          '//nologo',
          fileURLToPath(new URL('./acceptance-owner.vbs', import.meta.url)),
          pid,
        ],
        { encoding: 'utf8' },
      ).stdout ?? '');
  const owned =
    /qa[\\/]phase7-live\.ts/.test(command) || fallback.trim() === 'OWNED';
  console.log(
    JSON.stringify({
      pid,
      acceptanceCommandVerified: owned,
      wmicAvailable: fs.existsSync(wmic),
    }),
  );
  if (process.argv.includes('--stop') && owned) {
    const stopped = spawnSync(
      'taskkill.exe',
      ['/PID', pid, ...(process.argv.includes('--force') ? ['/F'] : [])],
      { encoding: 'utf8' },
    );
    console.log(JSON.stringify({ stoppedPid: pid, exitCode: stopped.status }));
  }
}
