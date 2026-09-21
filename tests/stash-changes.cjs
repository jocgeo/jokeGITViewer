const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const assert = require('assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jkt-stash-'));
const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'config'), GIT_CONFIG_NOSYSTEM: '1' };
fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
function run(cmd, args, cwd = dir) {
  const r = cp.spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout;
}
const lib = fs.readFileSync(path.join(__dirname, '../src-tauri/src/lib.rs'), 'utf8').replace(/\r\n/g, '\n');
const helper = lib.slice(lib.indexOf('fn revision_changes('), lib.indexOf('#[tauri::command]\nasync fn commit_files')).trim();
const rust = `use std::process::Command;
fn git(path: &str, args: &[&str]) -> Result<String,String> {
 let o = Command::new("git").arg("-C").arg(path).args(args).output().unwrap();
 if !o.status.success() { return Err(String::from_utf8_lossy(&o.stderr).into()); }
 Ok(String::from_utf8_lossy(&o.stdout).into())
}
${helper}
fn main() {
 let a: Vec<String> = std::env::args().collect();
 print!("{}", revision_changes(&a[1], &a[2], a[3] == "true", &[&a[4]], a.get(5).map(String::as_str)).unwrap());
}`;
const source = path.join(dir, 'check.rs');
const exe = path.join(dir, process.platform === 'win32' ? 'check.exe' : 'check');
fs.writeFileSync(source, rust);
run('rustc', ['--edition=2021', source, '-o', exe]);
const fixture = path.join(dir, 'repo');
fs.mkdirSync(fixture);
const git = (...args) => run('git', args, fixture);
const changes = (hash, stash, mode = '--name-status', file) => run(exe, [fixture, hash, String(stash), mode, ...(file ? [file] : [])]);
git('init', '-b', 'main');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'Test');
fs.writeFileSync(path.join(fixture, 'tracked.txt'), 'base\n');
git('add', '.'); git('commit', '-m', 'root');
assert.match(changes('HEAD', false), /A\s+tracked.txt/);
fs.writeFileSync(path.join(fixture, 'new file.txt'), 'untracked content\n');
git('stash', 'push', '-u');
assert.equal(changes('stash@{0}', false).trim(), ''); // reproduce the old empty list
assert.match(changes('stash@{0}', true), /A\s+new file.txt/);
assert.match(changes('stash@{0}', true, '--numstat'), /1\s+0\s+new file.txt/);
assert.match(changes('stash@{0}', true, '-U3', 'new file.txt'), /\+untracked content/);
fs.writeFileSync(path.join(fixture, 'tracked.txt'), 'modified\n');
fs.writeFileSync(path.join(fixture, 'another.txt'), 'another\n');
git('stash', 'push', '-u');
assert.match(changes('stash@{0}', true), /M\s+tracked.txt/);
assert.match(changes('stash@{0}', true), /A\s+another.txt/);
assert.match(changes('stash@{0}', true, '-U3', 'tracked.txt'), /\+modified/);
fs.writeFileSync(path.join(fixture, 'tracked.txt'), 'staged\n');
git('add', '.'); git('stash', 'push');
assert.match(changes('stash@{0}', true), /M\s+tracked.txt/);
git('checkout', '-b', 'branch');
fs.writeFileSync(path.join(fixture, 'branch.txt'), 'branch\n');
git('add', '.'); git('commit', '-m', 'branch');
git('checkout', 'main'); git('merge', '--no-ff', 'branch', '-m', 'merge');
git('config', 'log.diffMerges', 'off');
assert.match(changes('HEAD', false), /A\s+branch.txt/);
assert.match(changes('HEAD', false, '-U3', 'branch.txt'), /\+branch/);
git('commit', '--allow-empty', '-m', 'empty');
assert.equal(changes('HEAD', false).trim(), '');
console.log('PASS: root, merge, empty commit, staged stash, mixed stash and untracked-only stash lists/statistics/patches');
// Resolve requests out of order: an older empty list or error must not replace
// the current selection, including when switching repositories.
(async () => {
  const vm = require('vm');
  const ts = require('typescript');
  const source = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
  const snippet = source.slice(source.indexOf('let filesRequest = 0;'), source.indexOf('function numBadge('));
  const pending = [];
  const element = { innerHTML: '' };
  let tab = { selected: 'old', repo: { path: 'repo', stashes: [] } };
  const ctx = {
    cur: () => tab, $: () => element, escapeHtml: String,
    invoke: (command) => command === 'commit_numstat' ? Promise.resolve([]) : new Promise((resolve, reject) => pending.push({ resolve, reject })),
    renderFileList() { ctx.rendered = ctx.lastFiles; },
  };
  vm.createContext(ctx);
  vm.runInContext(ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, ctx);
  const old = ctx.loadFiles('repo', 'old');
  tab.selected = 'new';
  const next = ctx.loadFiles('repo', 'new');
  pending[1].resolve([{ path: 'new.txt', status: 'A' }]);
  await next;
  pending[0].resolve([]);
  await old;
  assert.equal(ctx.rendered.hash, 'new');
  const stale = ctx.loadFiles('repo', 'new');
  tab = { selected: 'elsewhere', repo: { path: 'elsewhere', stashes: [] } };
  element.innerHTML = 'other repository';
  pending[2].reject('old error');
  await stale;
  assert.equal(element.innerHTML, 'other repository');
  console.log('PASS: stale file lists and errors cannot overwrite newer selections');
})().catch(e => { console.error(e); process.exitCode = 1; });
