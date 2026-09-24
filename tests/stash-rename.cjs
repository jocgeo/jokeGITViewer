const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const assert = require('assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jkt-stashname-'));
const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'config'), GIT_CONFIG_NOSYSTEM: '1' };
fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
function run(cmd, args, cwd = dir) {
  const r = cp.spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout;
}
// the command under test, lifted out of lib.rs together with the name helper
const lib = fs.readFileSync(path.join(__dirname, '../src-tauri/src/lib.rs'), 'utf8').replace(/\r\n/g, '\n');
const strip = (text) => text.replace(/#\[tauri::command\]\n/g, '').replace(/async fn /g, 'fn ').trim();
const naming = strip(
  lib.slice(lib.indexOf('// A stash the user named reads'), lib.indexOf('#[tauri::command]\nasync fn stash_pop('))
);
const rename = strip(
  lib.slice(lib.indexOf('// Renaming a stash is not something git does'), lib.indexOf('// ---- bulk discard / stash'))
);
const rust = `use std::path::Path;
use std::process::Command;
fn git(path: &str, args: &[&str]) -> Result<String,String> {
 let o = Command::new("git").arg("-C").arg(path).args(args).output().unwrap();
 if !o.status.success() { return Err(String::from_utf8_lossy(&o.stderr).trim().to_string()); }
 Ok(String::from_utf8_lossy(&o.stdout).into())
}
${naming}
${rename}
fn main() {
 let a: Vec<String> = std::env::args().collect();
 if let Err(e) = stash_rename(a[1].clone(), a[2].clone(), a[3].clone(), a[4].clone()) {
  eprint!("{e}");
  std::process::exit(1);
 }
}`;
const source = path.join(dir, 'rename.rs');
const exe = path.join(dir, process.platform === 'win32' ? 'rename.exe' : 'rename');
fs.writeFileSync(source, rust);
run('rustc', ['--edition=2021', source, '-o', exe]);

const fixture = path.join(dir, 'repo');
fs.mkdirSync(fixture);
const git = (...args) => run('git', args, fixture);
const listAt = (repo) =>
  run('git', ['stash', 'list', '--format=%gd%x1f%H%x1f%ct%x1f%gs'], repo)
    .trim()
    .split('\n')
    .map((l) => l.split('\x1f'));
const list = () => listAt(fixture);
const rnAt = (repo, selector, hash, message) => {
  const r = cp.spawnSync(exe, [repo, selector, hash, message], { cwd: dir, env, encoding: 'utf8' });
  return { ok: r.status === 0, err: r.stderr };
};
const rn = (selector, hash, message) => rnAt(fixture, selector, hash, message);

git('init', '-b', 'main');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'Test');
fs.writeFileSync(path.join(fixture, 'f.txt'), 'base\n');
git('add', '.'); git('commit', '-m', 'root');
for (const n of [1, 2, 3]) {
  fs.writeFileSync(path.join(fixture, 'f.txt'), `change ${n}\n`);
  git('stash', 'push', '-m', `work ${n}`);
}
const before = list();
assert.deepEqual(before.map((e) => e[3]), ['On main: work 3', 'On main: work 2', 'On main: work 1']);

// rename the middle one: everything but its message must stay put
assert.ok(rn('stash@{1}', before[1][1], 'On main: the important one').ok);
const after = list();
assert.deepEqual(after.map((e) => e[0]), before.map((e) => e[0]), 'selectors keep their order');
assert.deepEqual(after.map((e) => e[1]), before.map((e) => e[1]), 'stash commits are untouched');
assert.deepEqual(after.map((e) => e[2]), before.map((e) => e[2]), 'stash times are untouched');
assert.deepEqual(after.map((e) => e[3]), [
  'On main: work 3',
  'On main: the important one',
  'On main: work 1',
]);
console.log('PASS: a rename changes one name and leaves order, commits and times alone');

// the renamed stash is still a working stash
git('stash', 'pop', 'stash@{1}');
assert.equal(fs.readFileSync(path.join(fixture, 'f.txt'), 'utf8'), 'change 2\n');
git('checkout', '--', 'f.txt');
assert.equal(list().length, 2);
console.log('PASS: the renamed stash still applies');

// quotes, separators and non-ASCII survive the round trip
const awkward = 'On main: "fix" — 50% of a\\path, done';
assert.ok(rn('stash@{0}', list()[0][1], awkward).ok);
assert.equal(list()[0][3], awkward);
// a pasted multi-line name is cut down to one reflog line
assert.ok(rn('stash@{0}', list()[0][1], '  \n  first line \nsecond line').ok);
assert.equal(list()[0][3], 'first line');
console.log('PASS: awkward names survive and a pasted one is cut to a single line');

// refusals leave the log exactly as it was
const logPath = path.join(fixture, '.git', 'logs', 'refs', 'stash');
const raw = fs.readFileSync(logPath, 'utf8');
const stale = rn('stash@{0}', 'd'.repeat(40), 'from a list that moved');
assert.equal(stale.ok, false);
assert.match(stale.err, /list has changed/);
const gone = rn('stash@{7}', list()[0][1], 'out of range');
assert.equal(gone.ok, false);
assert.match(gone.err, /no longer in the list/);
const unnamed = rn('stash@{0}', list()[0][1], '   ');
assert.equal(unnamed.ok, false);
assert.match(unnamed.err, /needs a name/);
assert.equal(fs.readFileSync(logPath, 'utf8'), raw, 'a refused rename writes nothing');
assert.equal(fs.readdirSync(path.dirname(logPath)).filter((f) => f.includes('jkt-')).length, 0, 'no leftovers');
console.log('PASS: a moved list, a missing stash and an empty name are refused without touching the log');

// A linked worktree shares the main repo's stash, and its own .git is only a
// file — the log has to be found through git, not beside the worktree.
const tree = path.join(dir, 'side');
git('worktree', 'add', '-q', tree, '-b', 'side');
fs.writeFileSync(path.join(tree, 'f.txt'), 'worktree work\n');
run('git', ['stash', 'push', '-m', 'from the worktree'], tree);
const fromTree = listAt(tree);
assert.equal(fromTree[0][3], 'On side: from the worktree');
assert.ok(rnAt(tree, 'stash@{0}', fromTree[0][1], 'On side: renamed inside the worktree').ok);
assert.equal(listAt(tree)[0][3], 'On side: renamed inside the worktree');
// the main repo sees the same stash list, so it sees the new name too
assert.equal(list()[0][3], 'On side: renamed inside the worktree');
console.log('PASS: renaming works from a linked worktree, where the stash log lives in the main repo');

// What the rename dialog offers to edit, and what it puts back
const vm = require('vm');
const ts = require('typescript');
const ui = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  ts.transpile(
    ui.slice(ui.indexOf('// A stash message carries where it came from'), ui.indexOf('function stashMenu(')),
    { target: ts.ScriptTarget.ES2020 }
  ),
  ctx
);
const split = (message) => JSON.parse(JSON.stringify(ctx.splitStashName(message)));
assert.deepEqual(split('On main: fix the parser'), { prefix: 'On main: ', name: 'fix the parser' });
// an unnamed stash offers git's own wording to overwrite, and comes back named
assert.deepEqual(split('WIP on main: 1a2b3c tidy up'), { prefix: 'On main: ', name: '1a2b3c tidy up' });
assert.deepEqual(split('On feature/side-quest: half done'), {
  prefix: 'On feature/side-quest: ',
  name: 'half done',
});
// only the first colon ends the branch, and a name of its own stays whole
assert.deepEqual(split('On main: On main: nested'), { prefix: 'On main: ', name: 'On main: nested' });
assert.deepEqual(split('renamed by hand'), { prefix: '', name: 'renamed by hand' });
console.log('PASS: the dialog edits the name and keeps the branch the stash came from');
