const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert/strict');

// the part of Ctrl+Click that decides WHICH name was clicked
const source = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
const snippet = source.slice(
  source.indexOf('// ---- mark a word, see everywhere else it appears ----'),
  source.indexOf('let diffFull = false;')
);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(ts.transpile(snippet, { target: ts.ScriptTarget.ES2020 }), ctx);
const word = (text, at) => {
  const found = ctx.wordAround(text, at);
  return found && { word: found.word, start: found.start };
};

const line = '    pThis->count = gpThisAnalog->value;';
// anywhere inside a name finds the whole name, not the part after the caret
for (const at of [4, 6, 9]) assert.deepEqual(word(line, at), { word: 'pThis', start: 4 });
// the offset a click lands on is where the caret goes, so both edges count
assert.deepEqual(word(line, 11), { word: 'count', start: 11 });
assert.deepEqual(word(line, 16), { word: 'count', start: 11 });
assert.deepEqual(word(line, 19), { word: 'gpThisAnalog', start: 19 });
// punctuation between names belongs to neither
assert.equal(word(line, 10), null, 'the arrow is not a name');
assert.equal(word('  x = 1;', 6), null, 'a bare number is not a name to look up');
// names with digits, underscores and non-ASCII letters hold together
assert.deepEqual(word('uint16_t raw2 = 0;', 10), { word: 'raw2', start: 9 });
assert.deepEqual(word('const größe = 1;', 8), { word: 'größe', start: 6 });
// the caret may sit just past the last letter — clicking its right half does
// exactly that — but an offset beyond the text is not a click on anything
assert.deepEqual(word('abc', 3), { word: 'abc', start: 0 });
assert.equal(word('abc', 99), null);
assert.equal(word('', 0), null);
console.log('PASS: a click resolves to the whole name under it, or to nothing');

// the same rule the highlighter uses, so what lights up is what a click follows
assert.equal(ctx.WORD_CHAR === undefined, true, 'WORD_CHAR stays private to the module');
assert.deepEqual(word('a.b', 0), { word: 'a', start: 0 }, 'a member access is two names');
assert.deepEqual(word('a.b', 2), { word: 'b', start: 2 });
console.log('PASS: names break on punctuation the same way the highlighter breaks them');
