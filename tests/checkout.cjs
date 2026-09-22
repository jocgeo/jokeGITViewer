const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const assert = require('assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jkt-checkout-'));
const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, 'config'), GIT_CONFIG_NOSYSTEM: '1' };
fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
function run(cmd, args, cwd = root, fail = false) {
  const r = cp.spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (fail) assert.notEqual(r.status, 0); else assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout;
}
const lib = fs.readFileSync(path.join(__dirname, '../src-tauri/src/lib.rs'), 'utf8');
const checkout = lib.slice(lib.indexOf('async fn checkout('), lib.indexOf('// Cheap signature of repo state')).replace('async fn checkout', 'fn checkout');
fs.writeFileSync(path.join(root, 'test.rs'), `
fn git(path: &str, args: &[&str]) -> Result<String, String> {
 let o = std::process::Command::new("git").arg("-C").arg(path).args(args).output().unwrap();
 if !o.status.success() { return Err(String::from_utf8_lossy(&o.stderr).into()); }
 Ok(String::from_utf8_lossy(&o.stdout).into())
}
${checkout}
fn main() {
 let a: Vec<String> = std::env::args().collect();
 match checkout(a[1].clone(), a[2].clone(), None) {
 Ok(saved) => println!("{saved}"), Err(e) => { eprintln!("{e}"); std::process::exit(1); }
 }
}`);
const exe = path.join(root, 'test' + (process.platform === 'win32' ? '.exe' : ''));
run('rustc', ['--edition=2021', path.join(root, 'test.rs'), '-o', exe]);
const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
const git = (...args) => run('git', args, repo);
git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
fs.writeFileSync(path.join(repo, 'tracked'), 'base'); git('add', '.'); git('commit', '-m', 'base');
git('checkout', '-b', 'other');
fs.writeFileSync(path.join(repo, 'collision'), 'branch file'); git('add', '.'); git('commit', '-m', 'other');
git('checkout', 'main');
fs.mkdirSync(path.join(repo, 'nested')); run('git', ['init'], path.join(repo, 'nested'));
fs.writeFileSync(path.join(repo, 'build.exe'), 'local build');
fs.writeFileSync(path.join(repo, 'tracked'), 'staged'); git('add', 'tracked');
fs.writeFileSync(path.join(repo, 'tracked'), 'unstaged');
assert.equal(run(exe, [repo, 'other']).trim(), 'true');
assert.equal(git('show', 'stash@{0}:tracked'), 'unstaged');
assert.equal(git('show', 'stash@{0}^2:tracked'), 'staged');
assert.equal(fs.readFileSync(path.join(repo, 'build.exe'), 'utf8'), 'local build');
assert(fs.existsSync(path.join(repo, 'nested/.git')));
assert.equal(run(exe, [repo, 'main']).trim(), 'false');
fs.writeFileSync(path.join(repo, 'collision'), 'local file');
run(exe, [repo, 'other'], root, true);
assert.equal(fs.readFileSync(path.join(repo, 'collision'), 'utf8'), 'local file');
fs.writeFileSync(path.join(repo, '.git/info/exclude'), 'collision\n');
run(exe, [repo, 'other'], root, true);
assert.equal(fs.readFileSync(path.join(repo, 'collision'), 'utf8'), 'local file');
assert.equal(git('branch', '--show-current').trim(), 'main');
console.log('PASS: checkout stashes tracked edits, retains builds and nested repositories, and protects untracked/ignored collisions');
