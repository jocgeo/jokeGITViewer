const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const assert = require('assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const ctx = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/function-source.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, ctx);
const { functionSourceRange, replaceSourceRange } = ctx.exports;
const source = 'int other(void) { return 0; }\r\n\r\nstatic int target(int a);\r\nstatic int\r\ntarget(int a)\r\n{\r\n  const char *s = "}"; /* { */\r\n  if (a) { return 1; }\r\n  return 2;\r\n}\r\n\r\nint after(void) { return 3; }\r\n';
const range = functionSourceRange(source, 'target');
assert.equal(source.slice(range.start, range.end), 'static int\r\ntarget(int a)\r\n{\r\n  const char *s = "}"; /* { */\r\n  if (a) { return 1; }\r\n  return 2;\r\n}');
const replacement = 'static int target(int a)\n{\n  return 9;\n}';
const edited = replaceSourceRange(source, range, replacement);
assert.equal(edited, source.slice(0, range.start) + replacement.replaceAll('\n', '\r\n') + source.slice(range.end));
assert.throws(() => functionSourceRange(source, 'missing'));
assert.throws(() => functionSourceRange('int foo() {}\nint foo(int a) {}', 'foo'));
assert.equal(functionSourceRange('int foo_all() {}\nint foo() {}', 'foo').start, 17);
console.log('PASS: function extraction handles prototypes, nested blocks, comments and strings; edits preserve surrounding text and CRLF');

// Exercise the production save implementation against a real file.
const temp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'jkt-scoped-save-'));
const rust = fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
const write = rust.slice(rust.indexOf('async fn write_file_worktree('), rust.indexOf('// ---- contributor avatars'))
  .replace('async fn write_file_worktree', 'fn write_file_worktree');
const harness = path.join(temp, 'save.rs');
const exe = path.join(temp, process.platform === 'win32' ? 'save.exe' : 'save');
fs.writeFileSync(harness, write + `
fn main() {
 let a: Vec<String> = std::env::args().collect();
 let expected = std::fs::read_to_string(&a[2]).unwrap();
 let content = std::fs::read_to_string(&a[3]).unwrap();
 if let Err(e) = write_file_worktree(a[1].clone(), "file.c".into(), content, Some(expected)) {
   eprintln!("{e}"); std::process::exit(1);
 }
}`);
const compiled = cp.spawnSync('rustc', ['--edition=2021', harness, '-o', exe], { encoding: 'utf8' });
assert.equal(compiled.status, 0, compiled.stderr);
const file = path.join(temp, 'file.c'), expected = path.join(temp, 'expected'), next = path.join(temp, 'next');
fs.writeFileSync(file, source); fs.writeFileSync(expected, source); fs.writeFileSync(next, edited);
let result = cp.spawnSync(exe, [temp, expected, next], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.readFileSync(file, 'utf8'), edited);
fs.writeFileSync(file, 'external edit');
result = cp.spawnSync(exe, [temp, expected, next], { encoding: 'utf8' });
assert.notEqual(result.status, 0);
assert.equal(fs.readFileSync(file, 'utf8'), 'external edit');
console.log('PASS: scoped save preserves exact content and refuses to overwrite external edits');
