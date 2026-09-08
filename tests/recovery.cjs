// Compile and test the actual recovery core without requiring a desktop session.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const repo = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jkt-recovery-tests-'));
const core = fs.readFileSync(path.join(repo, 'src-tauri/src/recovery.rs'), 'utf8')
  .split('#[tauri::command]')[0]
  .replace('use serde::Serialize;', '')
  .replaceAll('#[derive(Serialize)]', '');
const lib = fs.readFileSync(path.join(repo, 'src-tauri/src/lib.rs'), 'utf8');
const helpers = lib.slice(lib.indexOf('fn is_lock_busy('), lib.indexOf('// like git(), but pipes'));
const source = path.join(dir, 'recovery.rs');
const exe = path.join(dir, process.platform === 'win32' ? 'recovery-tests.exe' : 'recovery-tests');
fs.writeFileSync(source, `use std::process::Command;\n${helpers}\nmod recovery {\n${core}\n}`);
const config = path.join(dir, 'empty.gitconfig');
fs.writeFileSync(config, '');
const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' };
for (const [command, args] of [
  ['rustc', ['--edition=2021', '--test', source, '-o', exe]],
  [exe, []],
]) {
  const result = cp.spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
