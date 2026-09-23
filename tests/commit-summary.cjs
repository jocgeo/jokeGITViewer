const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert/strict');

// the summary counter and the stash name it hands over
const source = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
const snippet = source.slice(
  source.indexOf('const SUMMARY_SOFT'),
  source.indexOf('function updateCommitEnabled()')
);
const input = { value: '' };
const marks = new Set();
const label = {
  textContent: '',
  classList: { toggle: (name, on) => (on ? marks.add(name) : marks.delete(name)) },
};
const ctx = { $: (id) => (id === 'c-summary' ? input : label) };
vm.createContext(ctx);
vm.runInContext(ts.transpile(snippet, { target: ts.ScriptTarget.ES2020 }), ctx);

const count = (text) => {
  input.value = text;
  ctx.updateSummaryCount();
  return { text: label.textContent, marks: [...marks].sort() };
};
const x = (n) => 'x'.repeat(n);

assert.deepEqual(count(''), { text: '50 left', marks: [] });
assert.deepEqual(count(x(30)), { text: '20 left', marks: [] });
// the last character that still fits the convention
assert.deepEqual(count(x(50)), { text: '0 left', marks: [] });
// past it the counter turns around rather than going negative
assert.deepEqual(count(x(51)), { text: '1 over', marks: ['warn'] });
// 72 is the last width every tool still shows in full
assert.deepEqual(count(x(72)), { text: '22 over', marks: ['warn'] });
assert.deepEqual(count(x(73)), { text: '23 over', marks: ['bad'] });
// and it comes all the way back
assert.deepEqual(count('a short one'), { text: '39 left', marks: [] });
console.log('PASS: summary counter counts down to 50, then up, and warns again past 72');

input.value = '  fix the parser  ';
assert.equal(ctx.stashMessage(), 'fix the parser');
input.value = '   ';
assert.equal(ctx.stashMessage(), null, 'blank summary leaves the stash unnamed');
input.value = '';
assert.equal(ctx.stashMessage(), null);
console.log('PASS: the stash takes the typed summary, trimmed, and nothing when it is blank');
