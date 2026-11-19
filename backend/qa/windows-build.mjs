import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const report = {
  checkedAt: new Date().toISOString(),
  method:
    'Scoped Gradle init invokes installed Flutter snapshot directly; no SDK modifications',
  builds: [],
};
const wrapper = path.resolve('qa/windows_flutter.cmd');
const realData = process.argv.includes('--real-data');
for (const mode of process.argv.includes('--debug-only')
  ? ['debug']
  : process.argv.includes('--release-only')
    ? ['release']
    : ['debug', 'release']) {
  const start = performance.now();
  const task = mode === 'debug' ? 'assembleDebug' : 'assembleRelease';
  const defines = realData
    ? ' -Pdart-defines=' +
      ['API_BASE_URL=http://10.0.2.2:3337/api/v1', 'DEMO_MODE=false']
        .map((v) => Buffer.from(v).toString('base64'))
        .join(',')
    : '';
  const command = `gradlew.bat --no-daemon --max-workers=1 -Dorg.gradle.jvmargs=-Xmx1536m --init-script ../../backend/qa/windows-flutter.init.gradle -Dqa.flutter.wrapper=${wrapper} -Ptarget-platform=android-x64 -Ptarget=lib/main.dart${defines} ${task}`;
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
    cwd: '../mobile/android',
    env: {
      ...process.env,
      JAVA_HOME: 'C:/Program Files/Eclipse Adoptium/jdk-17.0.19.10-hotspot',
    },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 240000,
    windowsVerbatimArguments: true,
  });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  fs.writeFileSync(`../docs/qa-evidence/apk-${mode}.log`, output);
  const row = {
    mode,
    exitCode: result.status,
    durationSeconds: (performance.now() - start) / 1000,
    error: result.error?.code,
  };
  const source = `../mobile/build/app/outputs/apk/${mode}/app-${mode}.apk`;
  if (result.status === 0 && fs.existsSync(source)) {
    const target = `../mobile/build/app/outputs/flutter-apk/app-${mode}.apk`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    row.bytes = fs.statSync(target).size;
    row.path = target;
  } else {
    console.log(output.slice(-3500));
    process.exitCode = 1;
  }
  report.builds.push(row);
  console.log(JSON.stringify(row));
  fs.writeFileSync(
    '../docs/qa-evidence/apk-builds.json',
    JSON.stringify(report, null, 2),
  );
}
