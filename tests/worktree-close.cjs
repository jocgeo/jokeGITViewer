const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const assert = require('assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jkt-close-'));
const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, 'config'), GIT_CONFIG_NOSYSTEM: '1' };
fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
function run(command, args, cwd = root, success = true) {
  const r = cp.spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (success) assert.equal(r.status, 0, r.stderr || String(r.error));
  else assert.notEqual(r.status, 0);
  return r.stdout + (success ? '' : r.stderr);
}
const source = fs.readFileSync(path.join(__dirname, '../src-tauri/src/worktrees.rs'), 'utf8').replace(/\r\n/g, '\n');
const definitions = source.slice(source.indexOf('use std::path::Path;'), source.indexOf('#[tauri::command]')).replace('Default, Serialize', 'Default');
const helper = source.slice(source.indexOf('fn stash_and_close('), source.indexOf('#[tauri::command]\npub async fn worktree_stash_and_close'));
fs.writeFileSync(path.join(root, 'check.rs'), `
fn git(path: &str, args: &[&str]) -> Result<String, String> {
 let o = std::process::Command::new("git").arg("-C").arg(path).args(args).output().unwrap();
 if !o.status.success() { return Err(String::from_utf8_lossy(&o.stderr).into()); }
 Ok(String::from_utf8_lossy(&o.stdout).into())
}
fn git_ro(path: &str, args: &[&str]) -> Result<String, String> { git(path, args) }
${definitions}
${helper}
${source.slice(source.indexOf('fn apply_saved_work('), source.indexOf('#[tauri::command]\npub async fn worktree_apply_saved'))}
fn main() {
 let a: Vec<String> = std::env::args().collect();
 if a.get(3).map(String::as_str) == Some("apply") {
  if let Err(e) = apply_saved_work(&a[1], &a[2]) { eprintln!("{e}"); std::process::exit(1); }
  return;
 }
 match stash_and_close(&a[1], &a[2]) {
  Ok(hash) => println!("{}", hash.unwrap_or_default()),
  Err(e) => { eprintln!("{e}"); std::process::exit(1); }
 }
}`);
const exe = path.join(root, process.platform === 'win32' ? 'check.exe' : 'check');
run('rustc', ['--edition=2021', path.join(root, 'check.rs'), '-o', exe]);
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
const git = (...args) => run('git', args, repo);
git('init', '-b', 'main');
git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
fs.writeFileSync(path.join(repo, 'tracked'), 'base\n');
fs.writeFileSync(path.join(repo, '.gitignore'), '*.ignored\n');
git('add', '.'); git('commit', '-m', 'base');
const tree = path.join(root, 'saved work');
git('worktree', 'add', '-b', 'saved', tree);
fs.writeFileSync(path.join(tree, 'tracked'), 'staged\n');
run('git', ['add', 'tracked'], tree);
fs.writeFileSync(path.join(tree, 'tracked'), 'unstaged\n');
fs.writeFileSync(path.join(tree, 'new'), 'untracked\n');
fs.writeFileSync(path.join(tree, 'local.ignored'), 'ignored\n');
git('worktree', 'lock', tree);
assert.match(run(exe, [repo, tree], root, false), /locked/);
assert.equal(fs.readFileSync(path.join(tree, 'tracked'), 'utf8'), 'unstaged\n');
git('worktree', 'unlock', tree);
assert.match(run(exe, [tree, repo], root, false), /main checkout/);
assert.match(run(exe, [tree, tree], root, false), /Switch/);
const hash = run(exe, [repo, tree]).trim();
assert.match(hash, /^[a-f0-9]{40,64}$/);
assert.equal(fs.existsSync(tree), false);
assert.match(git('branch', '--list', 'saved'), /saved/);
assert.equal(git('show', `${hash}:tracked`), 'unstaged\n');
assert.equal(git('show', `${hash}^2:tracked`), 'staged\n');
assert.equal(git('show', `${hash}^3:new`), 'untracked\n');
assert.equal(git('show', `${hash}^3:local.ignored`), 'ignored\n');
git('worktree', 'add', tree, 'saved');
run('git', ['stash', 'apply', '--index', hash], tree);
assert.equal(fs.readFileSync(path.join(tree, 'local.ignored'), 'utf8'), 'ignored\n');
assert.match(run('git', ['status', '--porcelain'], tree), /MM tracked/);
// Conflicts must leave the worktree and its files in place.
run('git', ['reset', '--hard', 'HEAD'], tree);
const blob = git('rev-parse', 'HEAD:tracked').trim();
const conflict = cp.spawnSync('git', ['-C', tree, 'update-index', '--index-info'], {
 env, encoding: 'utf8', input: `0 ${'0'.repeat(40)}\ttracked\n100644 ${blob} 1\ttracked\n100644 ${blob} 2\ttracked\n100644 ${blob} 3\ttracked\n`,
});
assert.equal(conflict.status, 0, conflict.stderr);
assert.match(run(exe, [repo, tree], root, false), /retained/);
assert.equal(fs.existsSync(tree), true);
assert.equal(git('rev-parse', 'refs/stash').trim(), hash);
const clean = path.join(root, 'clean');
git('worktree', 'add', '-b', 'clean', clean);
assert.equal(run(exe, [repo, clean]).trim(), '');
assert.equal(fs.existsSync(clean), false);
assert.equal(git('rev-parse', 'refs/stash').trim(), hash);
const sub = path.join(root, 'submodule');
git('worktree', 'add', '-b', 'submodule', sub);
run('git', ['update-index', '--add', '--cacheinfo', `160000,${git('rev-parse', 'HEAD').trim()},nested`], sub);
assert.match(run(exe, [repo, sub], root, false), /submodules/);
assert.equal(fs.existsSync(sub), true);
// Applying copies saved work without clearing the source's files or index.
const applySource = path.join(root, 'apply-source');
git('worktree', 'add', '-b', 'apply-source', applySource);
fs.writeFileSync(path.join(applySource, 'tracked'), 'staged copy\n');
run('git', ['add', 'tracked'], applySource);
fs.writeFileSync(path.join(applySource, 'tracked'), 'working copy\n');
fs.writeFileSync(path.join(applySource, 'untracked'), 'new copy\n');
const sourceStatus = run('git', ['status', '--porcelain'], applySource);
fs.writeFileSync(path.join(repo, 'untracked'), 'keep local file\n');
assert.match(run(exe, [repo, applySource, 'apply'], root, false), /would be overwritten/);
assert.equal(fs.readFileSync(path.join(repo, 'untracked'), 'utf8'), 'keep local file\n');
fs.unlinkSync(path.join(repo, 'untracked'));
fs.writeFileSync(path.join(repo, 'tracked'), 'keep my edits\n');
assert.match(run(exe, [repo, applySource, 'apply'], root, false), /could not be fully applied/);
assert.equal(fs.readFileSync(path.join(repo, 'tracked'), 'utf8'), 'keep my edits\n');
git('restore', 'tracked');
run(exe, [repo, applySource, 'apply']);
assert.equal(fs.readFileSync(path.join(repo, 'tracked'), 'utf8'), 'working copy\n');
assert.equal(fs.readFileSync(path.join(repo, 'untracked'), 'utf8'), 'new copy\n');
assert.equal(run('git', ['status', '--porcelain'], applySource), sourceStatus);
assert.equal(run('git', ['show', ':tracked'], applySource), 'staged copy\n');
assert.equal(fs.readFileSync(path.join(applySource, 'tracked'), 'utf8'), 'working copy\n');
assert.equal(fs.readFileSync(path.join(applySource, 'untracked'), 'utf8'), 'new copy\n');
assert.match(run(exe, [repo, repo, 'apply'], root, false), /already/);
git('add', '.'); git('commit', '-m', 'Applied saved work');
fs.writeFileSync(path.join(repo, 'tracked'), 'divergent committed content\n');
git('add', 'tracked'); git('commit', '-m', 'Diverge');
assert.match(run(exe, [repo, applySource, 'apply'], root, false), /conflicts/);
assert.match(git('ls-files', '--unmerged'), /tracked/);
assert.equal(run('git', ['status', '--porcelain'], applySource), sourceStatus);
console.log('PASS: applying saved work copies tracked and untracked contents, preserves source staging and refuses to overwrite destination edits');
console.log('PASS: stash and close preserves staged, unstaged, untracked and ignored work; branches retained; main, active, locked and conflicted worktrees protected');
