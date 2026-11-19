import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const sdk = path.join(process.env.LOCALAPPDATA, 'Android/Sdk');
const adb = path.join(sdk, 'platform-tools/adb.exe');
const devices = execFileSync(adb, ['devices'], { encoding: 'utf8' });
console.log(devices);
if (!/emulator-\d+\s+device/.test(devices)) {
  const child = spawn(
    path.join(sdk, 'emulator/emulator.exe'),
    [
      '-avd',
      'Pixel_5',
      '-no-snapshot-load',
      '-no-snapshot-save',
      '-no-window',
      '-gpu',
      'swiftshader_indirect',
      '-no-audio',
    ],
    { detached: true, windowsHide: true, stdio: 'ignore' },
  );
  child.unref();
  fs.writeFileSync(
    '../docs/qa-evidence/emulator-start.json',
    JSON.stringify(
      {
        pid: child.pid,
        startedAt: new Date().toISOString(),
        avd: 'Pixel_5',
        wipeData: false,
      },
      null,
      2,
    ),
  );
  console.log('Started existing AVD without wiping data');
}
