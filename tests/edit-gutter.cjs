const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert/strict');

// the pure half of the editor gutter: which lines differ from the commit
const source = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
const snippet = source.slice(
  source.indexOf('// ---- edit gutter: line numbers'),
  source.indexOf('function setupEditGutter(')
);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(ts.transpile(snippet, { target: ts.ScriptTarget.ES2020 }), ctx);

// marks/gaps come back across the vm boundary, so compare them as plain data
const diff = (base, now) => {
  const r = ctx.lineMarks(base, now);
  return JSON.parse(JSON.stringify({ marks: [...r.marks], gaps: [...r.gaps] }));
};
const file = (...lines) => lines;

const clean = file('one', 'two', 'three');
assert.deepEqual(diff(clean, clean), { marks: [], gaps: [] });

// a line changed in place
assert.deepEqual(diff(clean, file('one', 'TWO', 'three')), { marks: [[1, 'mod']], gaps: [] });

// lines inserted between untouched ones
assert.deepEqual(diff(clean, file('one', 'a', 'b', 'two', 'three')), {
  marks: [[1, 'add'], [2, 'add']],
  gaps: [],
});

// lines removed: nothing is left to colour, so the seam gets the notch
assert.deepEqual(diff(file('one', 'two', 'three', 'four'), file('one', 'four')), {
  marks: [],
  gaps: [1],
});

// removed at the end of the file — the notch cannot fall off it
assert.deepEqual(diff(clean, file('one')), { marks: [], gaps: [0] });

// a file the commit does not have at all
assert.deepEqual(diff([], file('one', 'two')), { marks: [[0, 'add'], [1, 'add']], gaps: [] });

// a replacement reads as changed lines, not as an add plus a delete
assert.deepEqual(diff(clean, file('one', 'TWO', 'THREE', 'four')), {
  marks: [[1, 'mod'], [2, 'mod'], [3, 'mod']],
  gaps: [],
});

// edit, insert and delete in the same pass
assert.deepEqual(
  diff(file('a', 'b', 'c', 'd', 'e'), file('a', 'B', 'c', 'new', 'e')),
  { marks: [[1, 'mod'], [3, 'mod']], gaps: [] }
);
console.log('PASS: gutter marks added, changed and removed lines and keeps the notch inside the file');

// Two edits far apart in a big file: too large for the exact pass, so it falls
// through to unique-line anchors. Those must keep it at two marks instead of
// painting everything between them.
const big = Array.from({ length: 1200 }, (_v, i) => `line ${i}`);
const edited = big.slice();
edited[10] = 'edited near the top';
edited[1100] = 'edited near the bottom';
assert.deepEqual(diff(big, edited), { marks: [[10, 'mod'], [1100, 'mod']], gaps: [] });
// and with a line inserted between them the rest still stays clean
const grown = edited.slice();
grown.splice(600, 0, 'brand new line');
assert.deepEqual(diff(big, grown), {
  marks: [[10, 'mod'], [600, 'add'], [1101, 'mod']],
  gaps: [],
});
console.log('PASS: distant edits in a large file stay separate marks');

// The rail draws one bar per run of neighbouring lines, so a block of changes
// reads as a block instead of a stack of ticks.
const bars = (pairs, total) => JSON.parse(JSON.stringify(ctx.changeRuns(new Map(pairs), total)));
assert.deepEqual(bars([], 10), []);
assert.deepEqual(bars([[3, 'add'], [4, 'add'], [5, 'add']], 10), [{ kind: 'add', from: 3, len: 3 }]);
// touching but different kinds stay two bars
assert.deepEqual(bars([[3, 'mod'], [4, 'add']], 10), [
  { kind: 'mod', from: 3, len: 1 },
  { kind: 'add', from: 4, len: 1 },
]);
// apart stays apart
assert.deepEqual(bars([[0, 'add'], [9, 'add']], 10), [
  { kind: 'add', from: 0, len: 1 },
  { kind: 'add', from: 9, len: 1 },
]);
// a run reaching the final line still gets closed
assert.deepEqual(bars([[8, 'mod'], [9, 'mod']], 10), [{ kind: 'mod', from: 8, len: 2 }]);
// end to end: a pasted block is one bar as long as the block
const pasted = big.slice();
pasted.splice(80, 0, ...Array.from({ length: 12 }, (_v, i) => `added ${i}`));
const pastedMarks = ctx.lineMarks(big, pasted);
assert.deepEqual(JSON.parse(JSON.stringify(ctx.changeRuns(pastedMarks.marks, pasted.length))), [
  { kind: 'add', from: 80, len: 12 },
]);
console.log('PASS: rail bars span whole runs of changed lines and keep unlike kinds apart');

// The committed file may be CRLF while a textarea only ever reports LF; without
// normalising, every single line would read as changed.
assert.deepEqual([...ctx.editLines('one\r\ntwo\r\n')], ['one', 'two', '']);
assert.deepEqual(diff(ctx.editLines('one\r\ntwo\r\n'), 'one\ntwo\n'.split('\n')), {
  marks: [],
  gaps: [],
});
console.log('PASS: a CRLF file in the commit does not mark the whole buffer');
