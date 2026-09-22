const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const assert = require('assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jkt-discard-'));
const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'config'), GIT_CONFIG_NOSYSTEM: '1' };
fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
function run(cmd, args, cwd = dir) {
  const r = cp.spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout;
}
// the commands under test, lifted straight out of lib.rs
const lib = fs.readFileSync(path.join(__dirname, '../src-tauri/src/lib.rs'), 'utf8').replace(/\r\n/g, '\n');
const block = lib
  .slice(lib.indexOf('// ---- bulk discard / stash'), lib.indexOf('#[tauri::command]\nasync fn create_branch_checkout'))
  .replace(/#\[tauri::command\]\n/g, '')
  .replace(/async fn /g, 'fn ')
  .trim();
const rust = `use std::process::Command;
fn git(path: &str, args: &[&str]) -> Result<String,String> {
 let o = Command::new("git").arg("-C").arg(path).args(args).output().unwrap();
 if !o.status.success() {
  let e = String::from_utf8_lossy(&o.stderr).trim().to_string();
  return Err(if e.is_empty() { String::from_utf8_lossy(&o.stdout).trim().to_string() } else { e });
 }
 Ok(String::from_utf8_lossy(&o.stdout).into())
}
${block}
fn main() {
 let a: Vec<String> = std::env::args().collect();
 let r = match a[1].as_str() {
  "discard_all" => discard_all(a[2].clone()),
  "discard_unstaged" => discard_unstaged(a[2].clone()),
  "stash_unstaged" => stash_unstaged(a[2].clone()),
  other => panic!("unknown command {other}"),
 };
 if let Err(e) = r { eprint!("{e}"); std::process::exit(1); }
}`;
const source = path.join(dir, 'check.rs');
const exe = path.join(dir, process.platform === 'win32' ? 'check.exe' : 'check');
fs.writeFileSync(source, rust);
run('rustc', ['--edition=2021', source, '-o', exe]);

const fixture = path.join(dir, 'repo');
fs.mkdirSync(fixture);
const git = (...args) => run('git', args, fixture);
const write = (name, text) => fs.writeFileSync(path.join(fixture, name), text);
const read = (name) => fs.readFileSync(path.join(fixture, name), 'utf8');
const status = (cwd = fixture) =>
  run('git', ['status', '--porcelain', '--untracked-files=all'], cwd).trim().split('\n').filter(Boolean).sort();
const act = (command, cwd = fixture) => {
  const r = cp.spawnSync(exe, [command, cwd], { cwd: dir, env, encoding: 'utf8' });
  return { ok: r.status === 0, err: r.stderr };
};
// a.txt changed on both sides, b.txt in the worktree only, c.txt in the index
// only, plus a file git has never seen
const dirty = () => {
  write('a.txt', 'staged\n'); git('add', 'a.txt'); write('a.txt', 'staged+unstaged\n');
  write('b.txt', 'unstaged\n');
  write('c.txt', 'c-staged\n'); git('add', 'c.txt');
  write('untracked.txt', 'new\n');
  assert.deepEqual(status(), ['?? untracked.txt', 'M  c.txt', 'MM a.txt', ' M b.txt'].sort());
};

git('init', '-b', 'main');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'Test');
for (const f of ['a.txt', 'b.txt', 'c.txt']) write(f, 'base\n');
git('add', '.'); git('commit', '-m', 'root');
// no identity from here on: the temp commit has to carry its own
git('config', '--unset', 'user.email');
git('config', '--unset', 'user.name');

// ---- delete unstaged ----
dirty();
assert.ok(act('discard_unstaged').ok);
assert.deepEqual(status(), ['?? untracked.txt', 'M  a.txt', 'M  c.txt'].sort());
assert.equal(read('a.txt'), 'staged\n'); // worktree pulled back to the index
assert.equal(read('b.txt'), 'base\n');
assert.equal(read('untracked.txt'), 'new\n');
console.log('PASS: delete unstaged keeps the index, the staged half of a half-staged file and untracked files');

// ---- stash unstaged ----
git('reset', '--hard', 'HEAD');
fs.rmSync(path.join(fixture, 'untracked.txt'));
dirty();
const head = git('rev-parse', 'HEAD');
assert.ok(act('stash_unstaged').ok);
assert.equal(git('rev-parse', 'HEAD'), head, 'the temp commit must not survive');
assert.equal(git('log', '--format=%s').trim(), 'root');
assert.deepEqual(status(), ['?? untracked.txt', 'M  a.txt', 'M  c.txt'].sort());
assert.equal(read('a.txt'), 'staged\n');
assert.equal(read('b.txt'), 'base\n');
assert.equal(read('untracked.txt'), 'new\n');
const stashed = git('stash', 'show', '-p', 'stash@{0}');
assert.match(stashed, /\+staged\+unstaged/); // the unstaged half of a.txt
assert.match(stashed, /\+unstaged/); // b.txt
assert.doesNotMatch(stashed, /c-staged/); // the staged-only file stayed out
git('stash', 'pop');
assert.deepEqual(status(), ['?? untracked.txt', 'M  c.txt', 'MM a.txt', ' M b.txt'].sort());
assert.equal(read('a.txt'), 'staged+unstaged\n');
assert.equal(read('b.txt'), 'unstaged\n');
console.log('PASS: stash unstaged parks only the worktree side, leaves HEAD and the index alone, and pops back onto the staged work');

// ---- delete all ----
assert.ok(act('discard_all').ok);
assert.deepEqual(status(), ['?? untracked.txt']);
for (const f of ['a.txt', 'b.txt', 'c.txt']) assert.equal(read(f), 'base\n');
assert.equal(read('untracked.txt'), 'new\n', 'untracked files are never deleted');
console.log('PASS: delete all restores every tracked file and keeps untracked ones');

// ---- nothing unstaged / nothing staged ----
assert.equal(act('stash_unstaged').err, 'nothing unstaged to stash');
write('b.txt', 'only unstaged\n');
assert.ok(act('stash_unstaged').ok, 'nothing staged -> plain stash, no temp commit');
assert.deepEqual(status(), ['?? untracked.txt']);
assert.equal(git('log', '--format=%s').trim(), 'root');
git('stash', 'pop');
assert.equal(read('b.txt'), 'only unstaged\n');
console.log('PASS: stash unstaged reports an unchanged worktree and skips the temp commit when nothing is staged');

// ---- a repository with no commits yet ----
const unborn = path.join(dir, 'unborn');
fs.mkdirSync(unborn);
run('git', ['init', '-b', 'main'], unborn);
fs.writeFileSync(path.join(unborn, 'brand-new.txt'), 'never committed\n');
run('git', ['add', '.'], unborn);
for (const command of ['discard_all', 'stash_unstaged']) {
  const r = act(command, unborn);
  assert.equal(r.ok, false);
  assert.match(r.err, /no commits yet/);
}
// a bare `git reset --hard` here would have deleted the file off disk
assert.ok(fs.existsSync(path.join(unborn, 'brand-new.txt')));
assert.deepEqual(status(unborn), ['A  brand-new.txt']);
console.log('PASS: with no commits yet both refuse instead of deleting a staged new file');
