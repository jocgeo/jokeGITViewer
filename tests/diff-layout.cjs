const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const vm = require('vm');
const assert = require('assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const modules = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (modules.has(filename)) return modules.get(filename);
  const module = { exports: {} };
  modules.set(filename, module.exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, {
    module, exports: module.exports,
    require: name => name.endsWith('.css') ? {} : name.startsWith('.')
      ? load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')))
      : require(name),
  });
  return module.exports;
}
const { renderUnifiedDiff } = load('src/diff/render.ts');
const diff = ['diff --git a/demo.c b/demo.c', '--- a/demo.c', '+++ b/demo.c'];
for (let h = 0; h < 4; h++) {
  diff.push(`@@ -${h * 100 + 1},0 +${h * 100 + 1},30 @@ hunk ${h}`);
  for (let i = 0; i < 30; i++) diff.push('+' + (i === 3 ? 'very_long_line_' + 'content '.repeat(50) : `added_line_${i}`));
}
diff.push('@@ -500,3 +620,0 @@ deleted lines', '-removed one', '-removed two', '-removed three');
const html = renderUnifiedDiff(diff.join('\n'), null);
assert.equal((html.match(/<section class="diff-hunk">/g) || []).length, 5);
assert.equal((html.match(/<\/section>/g) || []).length, 5);
assert.equal(renderUnifiedDiff('', null), '');
const chrome = process.env.CHROME_BIN || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
if (!chrome) throw new Error('Set CHROME_BIN to a Chromium browser to run the layout regression.');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jkt-diff-layout-'));
const fixture = path.join(dir, 'fixture.html');
const screenshot = path.join(dir, 'layout.png');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8');
const functions = [
  main.slice(main.indexOf('function showDiffText('), main.indexOf('function isImage(')),
  main.slice(main.indexOf('function decorateHunkRows('), main.indexOf('// add a stage/unstage button')),
  main.slice(main.indexOf('function buildMinimap('), main.indexOf('function updateCommitEnabled(')),
].join('\n');
const browserFunctions = ts.transpileModule(functions, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
fs.writeFileSync(fixture, `<!doctype html><style>${css}
#diffview-body { width: 760px; height: 480px; flex: none; margin: 20px; }
</style><div id="diffview-title"></div><div id="diffview-body">${html}</div><div id="diff-minimap"></div><pre id="result">pending</pre><script>
const body = document.getElementById('diffview-body');
const rendered = body.innerHTML;
const $ = id => document.getElementById(id);
let hlLang = null;
const diffCtx = null, wipFull = false, wipDiffCtx = { diff: '' };
const renderUnifiedDiff = () => rendered;
const splitHunkPatches = () => Array.from({length: 5}, () => ({patch: ''}));
function showDiffView() {}
function decorateStageableRows() {}
${browserFunctions}
showDiffText('Unstaged changes', '', false);
const errors = [];
function check(ok, message) { if (!ok) errors.push(message); }
check(body.querySelectorAll('.hunk-btns').length === 5, 'hunk actions missing');
const changedRows = [...body.querySelectorAll('.dl.add, .dl.del')];
const marks = [...document.querySelectorAll('#diff-minimap .mm')];
check(marks.length === changedRows.length, 'changed-line markers missing');
marks.forEach((mark, i) => {
  const expected = changedRows[i].offsetTop / body.scrollHeight * 100;
  check(Math.abs(parseFloat(mark.style.top) - expected) < 0.001, 'marker measured before final hunk height');
});
const sections = [...body.querySelectorAll('.diff-hunk')];
check(body.scrollWidth > body.clientWidth * 2, 'fixture must overflow horizontally');
for (const x of [0, 400, body.scrollWidth - body.clientWidth]) {
  body.scrollLeft = x;
  for (const section of sections) {
    const header = section.querySelector('.hunk');
    body.scrollTop = section.offsetTop + 80;
    const viewport = body.getBoundingClientRect();
    for (const row of body.querySelectorAll('.dl.add, .dl.del')) {
      const rect = row.getBoundingClientRect();
      check(rect.right >= viewport.left + body.clientWidth - 1, 'background does not reach right edge at ' + x);
    }
    const target = header.getBoundingClientRect();
    for (const prior of sections.slice(0, sections.indexOf(section))) {
      check(prior.querySelector('.hunk').getBoundingClientRect().bottom <= target.top + 1, 'previous sticky header overlaps current header');
    }
    const buttons = header.querySelector('.hunk-btns').getBoundingClientRect();
    check(buttons.right <= viewport.left + body.clientWidth + 1 && buttons.left >= viewport.left, 'hunk actions leave viewport');
  }
}
body.scrollLeft = 400;
body.scrollTop = sections[2].offsetTop + 120;
check(body.querySelector('.dl.add').offsetParent === body, 'minimap row offsets changed');
document.getElementById('result').textContent = errors.length ? 'FAIL: ' + [...new Set(errors)].join('; ') : 'PASS: horizontal backgrounds, bounded sticky headers, visible actions, minimap offsets';
</script>`);
const result = cp.spawnSync(chrome, [
  '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--allow-file-access-from-files', '--window-size=900,650',
  '--user-data-dir=' + path.join(dir, 'profile'), '--screenshot=' + screenshot,
  '--dump-dom', 'file:///' + fixture.replaceAll('\\', '/'),
], { encoding: 'utf8', timeout: 30000, windowsHide: true });
assert.equal(result.status, 0, result.stderr || String(result.error));
const report = result.stdout.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
assert.match(report || '', /^PASS:/, report || result.stderr);
console.log(report);
console.log('Screenshot: ' + screenshot);
