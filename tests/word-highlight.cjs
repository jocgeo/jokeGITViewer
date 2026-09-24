const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert/strict');

// the matching half of "mark a word, see everywhere else it appears"
const source = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
const snippet = source.slice(
  source.indexOf('// ---- mark a word, see everywhere else it appears ----'),
  source.indexOf('let diffFull = false;')
);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(ts.transpile(snippet, { target: ts.ScriptTarget.ES2020 }), ctx);
const spans = (text, query) => [...ctx.wordSpans(text, query)];

assert.deepEqual(spans('const count = count + 1;', 'count'), [6, 14]);
assert.deepEqual(spans('nothing here', 'count'), []);
// offsets are into the original text, so a range lands on the word itself
const line = 'if (indexOf(x)) { indexOf(y) }';
for (const at of spans(line, 'indexOf')) assert.equal(line.slice(at, at + 7), 'indexOf');
assert.equal(spans(line, 'indexOf').length, 2);
console.log('PASS: word search finds every occurrence and reports true offsets');

// the whole point: a name inside a longer name is a different name
assert.deepEqual(spans('gpThisAnalog = pThis;', 'pThis'), [15]);
assert.deepEqual(spans('count += counter + recount;', 'count'), [0]);
assert.deepEqual(spans('a_count count_b _count_ count', 'count'), [24]);
// digits and non-ASCII letters belong to a name too
assert.deepEqual(spans('count2 = count;', 'count'), [9]);
assert.deepEqual(spans('größe = gr;', 'gr'), [8]);
console.log('PASS: a hit inside a longer name is left alone, digits and letters included');

// exact means the same characters, not a case-folded approximation
assert.deepEqual(spans('COUNT = count;', 'count'), [8]);
assert.deepEqual(spans('Total = TOTAL;', 'total'), []);
console.log('PASS: case has to match too — COUNT is not count');

// punctuation at an edge of the selection has nothing to guard
assert.deepEqual(spans('a->b; c->b; ab', '->b'), [1, 7]);
assert.deepEqual(spans('pThis->x; gpThisAnalog->x;', 'pThis->'), [0]);
// a rejected hit must not hide a real one right behind it
assert.deepEqual(spans('xx x', 'x'), [3]);
console.log('PASS: an edge that is not part of a name has nothing to guard');

// the selection has to be a word, not a paragraph or a stray character
// (the caller trims before asking, which is what the browser test covers)
assert.equal(ctx.isMarkableWord('x'), false, 'one character would light up half the file');
assert.equal(ctx.isMarkableWord('count'), true);
assert.equal(ctx.isMarkableWord('one\ntwo'), false, 'a multi-line selection is not a word');
assert.equal(ctx.isMarkableWord('x'.repeat(300)), false);
console.log('PASS: only a single-line selection of sensible length lights anything up');
