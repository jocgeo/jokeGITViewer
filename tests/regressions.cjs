const fs = require('fs');
const cp = require('child_process');
const vm = require('vm');
const path = require('path');
const assert = require('assert/strict');
const sourceRoot = path.resolve(__dirname, '..');
const ts = require('typescript');
const source = fs.readFileSync(path.join(sourceRoot,'src/main.ts'),'utf8');
const rust = fs.readFileSync(path.join(sourceRoot,'src-tauri/src/lib.rs'),'utf8').replace(/\r\n/g,'\n');
const root=fs.mkdtempSync(path.join(require('os').tmpdir(),'jokegitviewer-tests-'));
const emptyConfig=path.join(root,'empty.gitconfig');
fs.writeFileSync(emptyConfig,'');
const env={...process.env,GIT_CONFIG_GLOBAL:emptyConfig,GIT_CONFIG_NOSYSTEM:'1'};
function git(repo,args,input) {
  return cp.spawnSync('git',['-C',repo,'-c','core.autocrlf=false',...args],{encoding:'utf8',input,env});
}
function ok(r) { assert.equal(r.status,0,r.stderr || r.error?.message); return r.stdout; }
function init(name, content, file='f.txt') {
  const p=path.join(root,name); fs.mkdirSync(p);ok(git(p,['init','-q']));
  ok(git(p,['config','user.name','Review']));ok(git(p,['config','user.email','review@example.invalid']));
  fs.writeFileSync(path.join(p,file),content);ok(git(p,['add','.']));ok(git(p,['commit','-qm','base']));return p;
}
const context={};vm.createContext(context);
vm.runInContext(ts.transpile(source.slice(source.indexOf('function buildLinePatch('),source.indexOf('async function stageSingleLine('))),context);
for (const trailing of ['', '\n']) {
  for(const reverse of [false,true]) {
    for(const kind of ['del','add']) {
      const p=init(`line-${trailing?'lf':'eof'}-${reverse}-${kind}`,'old'+trailing);
      fs.writeFileSync(path.join(p,'f.txt'),'new'+trailing);
      if(reverse) ok(git(p,['add','.']));
      const diff=ok(git(p,['diff',...(reverse?['--cached']:[]),'--','f.txt']));
      const built=context.buildLinePatch(diff,{kind,ln:1},reverse);
      assert(built);
      ok(git(p,['apply','--cached',...(reverse?['--reverse']:[]),'-'],built.patch));
      const result=ok(git(p,['show',':f.txt']));
      if ((!reverse && kind==='del') || (reverse && kind==='add')) assert.equal(result,'');
      else assert.equal(result,'old'+trailing+'new'+trailing);
    }
  }
}
console.log('PASS: eight stage/unstage cases, with and without final newlines');
const helpers=rust.slice(rust.indexOf('fn is_lock_busy('),rust.indexOf('// like git(), but pipes'));
const abort=rust.slice(rust.indexOf('async fn merge_abort('),rust.indexOf('// finish the operation once')).replace('async fn merge_abort','fn merge_abort');
const harness=path.join(root,'abort.rs');
const exe=path.join(root,'abort.exe');
fs.writeFileSync(harness,'use std::process::Command;\n'+helpers+abort+`\nfn main() { let p=std::env::args().nth(1).unwrap(); if let Err(e)=merge_abort(p,"apply".into()) { eprintln!("{e}"); std::process::exit(1); } }\n`);
ok(cp.spawnSync('rustc',['--edition=2021',harness,'-o',exe],{encoding:'utf8'}));
for(const staged of [false,true]) {
  const file='space name.txt';
  const p=init('abort-'+staged,'base\n',file);
  const base=ok(git(p,['rev-parse','HEAD'])).trim();
  fs.writeFileSync(path.join(p,file),'incoming\n');ok(git(p,['commit','-qam','incoming']));
  const patch=ok(git(p,['show','--format=','HEAD','--',file]));
  ok(git(p,['checkout','--detach',base]));
  const expected=staged?'my staged work\n':'my committed work\n';
  fs.writeFileSync(path.join(p,file),expected);ok(git(p,['add','.']));
  if(!staged)ok(git(p,['commit','-qm','ours']));
  const originalIndex=ok(git(p,['diff','--cached']));
  assert.notEqual(git(p,['apply','--3way','-'],patch).status,0);
  assert(ok(git(p,['ls-files','-u'])).length>0);
  ok(cp.spawnSync(exe,[p],{encoding:'utf8',env}));
  assert.equal(fs.readFileSync(path.join(p,file),'utf8'),expected);
  assert.equal(ok(git(p,['diff','--cached'])),originalIndex);
  assert.equal(ok(git(p,['ls-files','-u'])),'');
}
console.log('PASS: actual Rust abort preserves pre-existing staged and committed content');
const p=init('abort-deletion','base\n');
const blob=ok(git(p,['rev-parse','HEAD:f.txt'])).trim();
ok(git(p,['rm','f.txt']));
ok(git(p,['update-index','--index-info'],`100644 ${blob} 1\tf.txt\n100644 ${blob} 3\tf.txt\n`));
fs.writeFileSync(path.join(p,'f.txt'),'theirs\n');
ok(cp.spawnSync(exe,[p],{encoding:'utf8',env}));
assert(!fs.existsSync(path.join(p,'f.txt')));
assert.equal(ok(git(p,['ls-files','-u'])),'');
assert(ok(git(p,['diff','--cached','--name-status'])).startsWith('D'));
console.log('PASS: abort preserves a pre-existing deletion (no stage 2)');
async function raceTest(switchTabs) {
  const tab={repo:{path:'A'}};let active=tab;let resolve;const rendered=[];
  const ctx={cur:()=>active,invoke:()=>new Promise(r=>resolve=r),buildNodes:()=>[],renderSidebar:t=>rendered.push(t.repo.path),renderGraph:t=>rendered.push(t.repo.path),saveRepoCache:()=>{},console};
  vm.createContext(ctx);vm.runInContext(ts.transpile(source.slice(source.indexOf('async function reloadGraphOnly()'),source.indexOf('// One fetch right after'))),ctx);
  const pending=ctx.reloadGraphOnly();if(switchTabs)active={repo:{path:'B'}};
  resolve({path:'A',fingerprint:'updated'});await pending;
  assert.deepEqual(rendered,switchTabs?[]:['A','A']);assert.equal(tab.fingerprint,'updated');
}
Promise.all([raceTest(true),raceTest(false)]).then(()=>console.log('PASS: refresh updates cache and only renders the active tab')).catch(e=>{console.error(e);process.exitCode=1;});
