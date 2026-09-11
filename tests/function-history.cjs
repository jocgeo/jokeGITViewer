const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const os = require('os');
const vm = require('vm');
const assert = require('assert/strict');
const ts = require('typescript');
const sourceRoot = path.resolve(__dirname, '..');
const rust = fs.readFileSync(path.join(sourceRoot, 'src-tauri/src/lib.rs'), 'utf8');
const source = fs.readFileSync(path.join(sourceRoot, 'src/main.ts'), 'utf8');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jkt-function-history-'));
const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
function ok(result) {
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
function git(...args) {
  return ok(cp.spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env }));
}
// Compile and run the actual production range builder and history reader.
const structs = rust.slice(rust.indexOf('pub struct HistEntry'), rust.indexOf('// commits that touched a single file'));
const rangeBuilder = rust.slice(rust.indexOf('fn function_history_range'), rust.indexOf('#[tauri::command]', rust.indexOf('fn function_history_range')));
const reader = rust.slice(rust.indexOf('fn range_history('), rust.indexOf('// per-line blame'));
const harness = path.join(root, 'history.rs');
const exe = path.join(root, process.platform === 'win32' ? 'history.exe' : 'history');
fs.writeFileSync(harness, `
const US: char = '\\x1f';
fn git(path: &str, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("git").arg("-C").arg(path).args(args).output().map_err(|e| e.to_string())?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).to_string()); }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}
${structs}
${rangeBuilder}
${reader}
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let result = function_history_range(&a[2], &a[3]).and_then(|r| range_history(&a[1], r, &a[4], true));
    match result {
        Ok(entries) => for e in entries {
            println!("{}", e.summary);
            if a.len() > 5 { print!("{}", e.diff.unwrap_or_default()); }
        },
        Err(e) => { eprintln!("{e}"); std::process::exit(1); }
    }
}
`);
ok(cp.spawnSync('rustc', ['--edition=2021', harness, '-o', exe], { encoding: 'utf8' }));
git('init', '-q');
git('config', 'user.name', 'Test');
git('config', 'user.email', 'test@example.invalid');
const file = 'space name.c';
function content(value, neighbor = 1, prefix = '', name = 'read') {
  return `${prefix}int read_all(void)\n{\n    return 99;\n}\n\nint ${name}(void)\n{\n    return ${value};\n}\n\nint neighbor(void)\n{\n    return ${neighbor};\n}\n`;
}
function commit(text, message) {
  fs.writeFileSync(path.join(root, file), text);
  git('add', '--', file);
  git('commit', '-qm', message);
  return git('rev-parse', 'HEAD');
}
const original = commit(content(1), 'create functions');
commit(content(2), 'change read body');
commit(content(2, 3), 'change neighbor only');
commit(content(2, 3, '// header\n// moves functions down\n'), 'move line numbers');
function history(name, rev = '') {
  return cp.spawnSync(exe, [root, file, name, rev], { encoding: 'utf8', env });
}
assert.deepEqual(ok(history('read')).split(/\r?\n/), ['change read body', 'create functions']);
assert.equal(ok(history('read', original)), 'create functions');
assert.equal(ok(history('read_all')), 'create functions');
commit(content(2, 3, '', 'read_renamed'), 'rename function');
assert.deepEqual(ok(history('read_renamed')).split(/\r?\n/), ['rename function', 'change read body', 'create functions']);
const patches = ok(cp.spawnSync(exe, [root, file, 'read_renamed', '', 'patches'], { encoding: 'utf8', env }));
assert(patches.includes('+int read_renamed(void)'));
assert(patches.includes('-int read(void)'));
assert(patches.includes(' return 2;'));
assert(patches.includes(' return 1;'));
assert(!patches.includes('read_all'));
assert(!patches.includes('neighbor(void)'));
assert(!patches.includes('return 99'));
console.log('PASS: history patches contain only the tracked function, including its earlier name');
fs.writeFileSync(path.join(root, file), content(2, 3, '', 'uncommitted'));
assert.notEqual(history('uncommitted').status, 0);
for (const invalid of ['', 'read()', 'read:other.c', '.*', 'Class::read']) {
  assert.notEqual(history(invalid).status, 0);
}
assert.notEqual(history('read_renamed', '--all').status, 0);
console.log('PASS: function history follows body edits, line shifts and renames; excludes neighbors; anchors revisions and validates names');

async function uiTest(stale, cancel = false) {
  const tab = { repo: { path: 'repo' } };
  const context = { path: 'repo', file: 'code.c', hash: 'abc' };
  const calls = [];
  const hist = [{ hash: '123', added: 0, deleted: 0 }];
  const ctx = {
    diffCtx: context, cur: () => tab,
    $: id => {
      assert.equal(id, 'detail');
      return { classList: { add: name => {
        assert.equal(name, 'collapsed');
        calls.push('collapse');
      } } };
    },
    promptModal: async () => cancel ? null : 'read',
    invoke: async (command, args) => {
      assert.equal(command, 'file_function_history');
      assert.equal(args.rev, 'abc');
      assert.equal(args.name, 'read');
      if (stale) ctx.diffCtx = { ...context, file: 'other.c' };
      return hist;
    },
    setStatus: () => {}, errorModal: message => assert.fail(message),
    showDiffView: () => calls.push('view'), renderGraph: () => calls.push('graph'),
    renderHistPanel: (file, entries) => { assert.equal(file, 'code.c'); assert.equal(entries, hist); calls.push('panel'); },
  };
  vm.createContext(ctx);
  vm.runInContext(ts.transpile(source.slice(source.indexOf('async function showFunctionHistory('), source.indexOf('// left-of-graph column'))), ctx);
  await ctx.showFunctionHistory('read');
  assert.deepEqual(calls, stale || cancel ? [] : ['collapse', 'view', 'graph', 'panel']);
  if (!stale && !cancel) {
    assert.equal(ctx.histFunctionName, 'read');
    assert.equal(ctx.histLineRange, null);
    assert(ctx.fileHistoryHL.has('123'));
  }
}
Promise.all([uiTest(false), uiTest(true), uiTest(false, true)])
  .then(() => console.log('PASS: function history reuses the panel and ignores canceled or stale requests'))
  .catch(error => { console.error(error); process.exitCode = 1; });

async function functionViewTest() {
  const calls = [];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { classList: { remove() {} }, textContent: '', innerHTML: '' });
    return elements.get(id);
  };
  const ctx = {
    $: element, setBlameBtn() {}, setPlainBtn() {}, setEditBtn() {}, setPickButtons() {},
    isImage: () => false, showDiffView() {}, escapeHtml: String, diffFull: true,
    showDiffText: (_title, diff) => calls.push(diff),
    invoke: async (command, args) => {
      assert.equal(command, 'commit_diff');
      assert.equal(args.full, true);
      return 'whole file';
    },
  };
  vm.createContext(ctx);
  vm.runInContext(ts.transpile(source.slice(source.indexOf('async function openDiff('), source.indexOf('// ---- line-level staging ----'))), ctx);
  const scope = { name: 'read', diff: 'function patch' };
  await ctx.openDiff('test', 'repo', 'test.c', 'abc', true, scope);
  assert.deepEqual(calls, ['function patch']);
  assert.equal(element('diffview-whole').textContent, 'Whole file');
  await ctx.openDiff('test', 'repo', 'test.c', 'abc', true, { ...scope, whole: true });
  assert.equal(calls.at(-1), 'whole file');
  assert.equal(element('diffview-whole').textContent, 'Function only');
  await ctx.openDiff('older', 'repo', 'test.c', 'old', true, scope);
  assert.equal(calls.at(-1), 'function patch');
  ctx.lastView();
  assert.equal(calls.at(-1), 'function patch');
  console.log('PASS: function entries default to function code regardless of whole-file preference; explicit expansion and return work');
}
functionViewTest().catch(error => { console.error(error); process.exitCode = 1; });

async function worktreeViewTest() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        innerHTML: '', textContent: '',
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      });
    }
    return elements.get(id);
  };
  let resolve;
  const ctx = {
    $: element, diffCtx: { path: 'repo', file: 'test.c', hash: 'historical' }, alignWorktreeScroll: null,
    isImage: () => false, langForFile: () => 'c', hlLines: lines => lines,
    escapeHtml: text => text.replaceAll('<', '&lt;'),
    invoke: (command, args) => {
      assert.equal(command, 'file_at_commit');
      assert.equal(args.hash, '');
      assert.equal(args.path, 'repo');
      return new Promise(r => { resolve = r; });
    },
  };
  vm.createContext(ctx);
  vm.runInContext(ts.transpile(source.slice(source.indexOf('let worktreeView:'), source.indexOf('let diffCtx:'))), ctx);
  let pending = ctx.openCurrentWorktree();
  resolve('current code\n');
  await pending;
  assert(element('worktree-body').innerHTML.includes('current code'));
  assert.equal(ctx.diffCtx.hash, 'historical');
  assert(element('diff-main').classList.contains('with-worktree'));
  pending = ctx.openCurrentWorktree();
  ctx.closeWorktreeView();
  resolve('stale code');
  await pending;
  assert(!element('worktree-body').innerHTML.includes('stale code'));
  assert(element('worktree-view').classList.contains('hidden'));
  pending = ctx.openCurrentWorktree();
  ctx.diffCtx = { ...ctx.diffCtx, file: 'another.c' };
  ctx.syncWorktreeView(true);
  resolve('wrong file');
  await pending;
  assert(!element('worktree-body').innerHTML.includes('wrong file'));
  assert(!element('diff-main').classList.contains('with-worktree'));
  console.log('PASS: current worktree opens beside history and ignores closed or superseded reads');
}
worktreeViewTest().catch(error => { console.error(error); process.exitCode = 1; });
