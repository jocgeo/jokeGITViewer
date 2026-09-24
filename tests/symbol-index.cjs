const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const assert = require('assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jkt-symbols-'));
const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'config'), GIT_CONFIG_NOSYSTEM: '1' };
fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
function run(cmd, args, cwd = dir) {
  const r = cp.spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout;
}

// The indexer itself, with serde and tauri stripped off and git wired to the
// real thing, so this exercises the module the app loads — not a copy of it.
const module_ = fs.readFileSync(path.join(__dirname, '../src-tauri/src/symbols.rs'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace('use crate::git_ro;', `
fn git_ro(repo: &str, args: &[&str]) -> Result<String, String> {
 let o = std::process::Command::new("git").arg("-C").arg(repo).args(args).output().unwrap();
 if !o.status.success() { return Err(String::from_utf8_lossy(&o.stderr).trim().to_string()); }
 Ok(String::from_utf8_lossy(&o.stdout).into())
}`)
  .replace('use serde::Serialize;\n', '')
  .replace(/#\[derive\(([^)]*)\)\]/g, (_m, list) =>
    `#[derive(${list.split(',').map((s) => s.trim()).filter((s) => s !== 'Serialize').join(', ')})]`)
  .replace(/^\s*#\[serde\([^\]]*\)\]\n/gm, '')
  .replace(/#\[tauri::command\]\n/g, '')
  .replace(/pub async fn /g, 'pub fn ');
const rust = `#![allow(dead_code)]
mod symbols {
${module_}
}
fn show(list: Vec<symbols::Symbol>) {
 for s in list {
  println!("{}\\t{:?}\\t{}\\t{}\\t{}\\t{}\\t{}", s.name, s.kind, s.file, s.line, s.scope, s.scope_start, s.scope_end);
 }
}
fn main() {
 let a: Vec<String> = std::env::args().collect();
 match a[1].as_str() {
  "parse" => show(symbols::parse(&a[3], &std::fs::read_to_string(&a[2]).unwrap())),
  // several passes in ONE process, since the index is kept in memory:
  // index <repo> <passes> [file to touch between passes]
  "index" => {
   let passes: usize = a.get(3).map(|s| s.parse().unwrap()).unwrap_or(1);
   for n in 0..passes {
    if n > 0 {
     if let Some(f) = a.get(4) {
      let p = std::path::Path::new(&a[2]).join(f);
      let mut text = std::fs::read_to_string(&p).unwrap();
      text.push_str("\nint touched_later = 1;\n");
      std::fs::write(&p, text).unwrap();
     }
    }
    let s = symbols::symbol_index(a[2].clone()).unwrap();
    println!("{} {} {}", s.files, s.symbols, s.parsed);
   }
  }
  "lookup" => show(symbols::symbol_lookup(a[2].clone(), a[3].clone(), a[4].clone(), a[5].parse().unwrap()).unwrap()),
  other => panic!("unknown command {other}"),
 }
}`;
const source = path.join(dir, 'index.rs');
const exe = path.join(dir, process.platform === 'win32' ? 'index.exe' : 'index');
fs.writeFileSync(source, rust);
run('rustc', ['--edition=2021', source, '-o', exe]);

const repo = path.join(dir, 'repo');
fs.mkdirSync(repo);
const write = (name, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
  fs.writeFileSync(path.join(repo, name), text);
};
const rows = (out) =>
  out.trim().split('\n').filter(Boolean).map((l) => {
    const [name, kind, file, line, scope, start, end] = l.split('\t');
    return { name, kind, file, line: +line, scope, start: +start, end: +end };
  });
const parse = (name) => {
  const list = rows(run(exe, ['parse', path.join(repo, name), name]));
  if (process.env.DUMP) console.error(name, list); // DUMP=1 to see what a file yielded
  return list;
};
const lookup = (name, file, line) => rows(run(exe, ['lookup', repo, name, file, String(line)]));
const at = (list, name, kind) => list.find((s) => s.name === name && (!kind || s.kind === kind));

// ---- a realistic C pair: header declares, source implements ----
write('src/sensor.h', `#ifndef SENSOR_H
#define SENSOR_H

#define SENSOR_MAX 32

typedef struct {
    unsigned short count;
    char name[16];
} Sensor;

typedef void (*sensor_cb_t)(Sensor *pThis);

extern Sensor *gpThisAnalog;

void sensor_init(Sensor *pThis);
unsigned short sensor_read(Sensor *pThis, int channel);

#endif
`);
write('src/sensor.c', `#include "sensor.h"

Sensor *gpThisAnalog = 0;

static int calibration = 3;

void sensor_init(Sensor *pThis)
{
    int count = 0;              /* shadows the field of the same name */
    pThis->count = count;
    for (int i = 0; i < SENSOR_MAX; i++) {
        calibration += i;
    }
}

unsigned short sensor_read(Sensor *pThis, int channel)
{
    unsigned short raw = 0;
    raw = read_adc(channel);
    if (raw > 10) return raw;   // "return raw" is not a declaration
    return raw + calibration;
}
`);

const header = parse('src/sensor.h');
assert.ok(at(header, 'SENSOR_MAX', 'Macro'), 'a #define is a macro');
assert.ok(at(header, 'Sensor', 'Type'), 'an anonymous typedef struct gets its trailing name');
assert.ok(at(header, 'count', 'Field'), 'struct members are fields');
assert.ok(at(header, 'sensor_cb_t', 'Type'), 'a function-pointer typedef names the pointer');
assert.ok(at(header, 'gpThisAnalog', 'Variable'), 'an extern declaration is a variable');
assert.equal(at(header, 'sensor_init').kind, 'Prototype', 'no body means a prototype');
assert.equal(at(header, 'sensor_read').kind, 'Prototype');

const impl = parse('src/sensor.c');
// the brace sits on the next line, which still makes this the implementation
assert.equal(at(impl, 'sensor_init').kind, 'Function');
assert.equal(at(impl, 'sensor_read').kind, 'Function');
assert.ok(at(impl, 'calibration', 'Variable'), 'a file-scope static is a variable');
assert.ok(at(impl, 'channel', 'Param'), 'parameters are indexed');
const local = at(impl, 'count', 'Local');
assert.ok(local, 'a local inside a body is a local');
assert.ok(local.start <= 9 && local.end >= 13, `the local knows its function spans ${local.start}-${local.end}`);
assert.ok(at(impl, 'i', 'Local'), 'a for-loop init declares a local too');
// lines that only look like declarations must not become symbols
assert.equal(impl.filter((s) => s.name === 'raw' && s.kind === 'Local').length, 1, 'raw is declared once, assigned twice');
assert.ok(!at(impl, 'read_adc'), 'a call is not a declaration');
assert.ok(!impl.some((s) => s.name === 'shadows' || s.name === 'field'), 'comment text is not code');
console.log('PASS: C files index functions, prototypes, types, fields, globals, params and locals');

run('git', ['init', '-b', 'main'], repo);
run('git', ['config', 'user.email', 'test@example.com'], repo);
run('git', ['config', 'user.name', 'Test'], repo);
run('git', ['add', '.'], repo);
run('git', ['commit', '-m', 'fixture'], repo);

// ---- what a Ctrl+Click lands on ----
// standing on the implementation jumps to the declaration
const fromImpl = lookup('sensor_init', 'src/sensor.c', 7);
assert.equal(fromImpl[0].kind, 'Prototype');
assert.equal(fromImpl[0].file, 'src/sensor.h');
// and standing on the declaration jumps to the implementation
const fromDecl = lookup('sensor_init', 'src/sensor.h', 15);
assert.equal(fromDecl[0].kind, 'Function');
assert.equal(fromDecl[0].file, 'src/sensor.c');
// from anywhere else, the implementation is the answer
const fromUse = lookup('sensor_read', 'src/sensor.c', 12);
assert.equal(fromUse[0].kind, 'Function');
assert.equal(fromUse[0].file, 'src/sensor.c');
console.log('PASS: a function toggles between its implementation and its declaration');

// a local beats a struct field of the same name, but only inside its function
const inside = lookup('count', 'src/sensor.c', 10);
assert.equal(inside[0].kind, 'Local');
assert.equal(inside[0].line, 9);
const outside = lookup('count', 'src/sensor.c', 3);
assert.equal(outside[0].kind, 'Field', 'outside the function the local is not in scope');
// a parameter is in scope for the whole body, not just its own line
const param = lookup('pThis', 'src/sensor.c', 10);
assert.equal(param[0].kind, 'Param');
assert.equal(param[0].line, 7, 'the parameter of the function the click sits in');
assert.equal(lookup('pThis', 'src/sensor.c', 18)[0].line, 16, 'and the next function has its own');
// a macro used in the .c resolves to the header next to it
assert.equal(lookup('SENSOR_MAX', 'src/sensor.c', 11)[0].file, 'src/sensor.h');
// a global defined in the .c and declared extern in the .h: standing on one
// finds the other rather than itself
assert.equal(lookup('gpThisAnalog', 'src/sensor.c', 3)[0].file, 'src/sensor.h');
console.log('PASS: scope, header pairing and standing-where-you-click all steer the result');

// ---- other languages get the same treatment ----
write('app/main.rs', `pub struct Config { pub retries: u32 }

pub fn load(name: &str) -> Config {
    let retries = 3;
    Config { retries }
}
`);
write('app/ui.ts', `export interface Point { x: number }

export function distance(from: Point, to: Point): number {
  const dx = to.x - from.x;
  return dx;
}
`);
write('app/tool.py', `class Loader:
    def read(self, name):
        data = name
        return data
`);
const rs = parse('app/main.rs');
assert.equal(at(rs, 'load').kind, 'Function');
assert.ok(at(rs, 'Config', 'Type') && at(rs, 'retries', 'Local') && at(rs, 'name', 'Param'));
const tsx = parse('app/ui.ts');
assert.equal(at(tsx, 'distance').kind, 'Function');
assert.ok(at(tsx, 'Point', 'Type') && at(tsx, 'dx', 'Local') && at(tsx, 'from', 'Param'));
const py = parse('app/tool.py');
assert.equal(at(py, 'read').kind, 'Function');
assert.ok(at(py, 'Loader', 'Type') && at(py, 'data', 'Local'));
console.log('PASS: Rust, TypeScript and Python are indexed by the same rules');

// ---- the index only re-reads what changed ----
run('git', ['add', '.'], repo);
run('git', ['commit', '-m', 'more'], repo);
const passes = run(exe, ['index', repo, '3', 'src/sensor.c'])
  .trim()
  .split('\n')
  .map((l) => l.split(' ').map(Number));
assert.equal(passes[0][0], 5, 'five source files');
assert.ok(passes[0][1] > 20, 'and a useful number of symbols');
assert.equal(passes[0][2], 5, 'the first pass reads them all');
assert.equal(passes[1][2], 1, 'after one file is touched, one file is re-read');
assert.equal(passes[2][2], 1, 'and again after the next touch');
assert.equal(passes[1][0], 5, 'the file count is unchanged');
console.log('PASS: indexing is incremental — only files that changed are read again');

// a file that is not tracked is not indexed, and a deleted one drops out
write('src/scratch.c', 'void scratch_only(void) {}\n');
assert.equal(lookup('scratch_only', 'src/sensor.c', 1).length, 0, 'untracked files stay out');
run('git', ['add', 'src/scratch.c'], repo);
assert.equal(lookup('scratch_only', 'src/sensor.c', 1).length, 1, 'tracking it brings it in');
fs.rmSync(path.join(repo, 'src/scratch.c'));
run('git', ['rm', '-q', '--cached', 'src/scratch.c'], repo);
assert.equal(lookup('scratch_only', 'src/sensor.c', 1).length, 0, 'and removing it takes it out again');
console.log('PASS: the index follows what git tracks');
