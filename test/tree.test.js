import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTree, indent, outdent, moveRows, deleteRows, isValidTree, normalizeLevels, visibleRows, insertionPoint } from '../src/model/tree.js';
import { task, section, levels, names } from './helpers.js';

function sample() {
  return [
    section({ id: 100, name: 'S1' }),
    task({ id: 1, name: 'A', level: 0 }),
    task({ id: 2, name: 'A1', level: 1 }),
    task({ id: 3, name: 'A1a', level: 2 }),
    task({ id: 4, name: 'A2', level: 1 }),
    section({ id: 101, name: 'S2' }),
    task({ id: 5, name: 'B', level: 0 }),
    task({ id: 6, name: 'C', level: 0 }),
  ];
}

test('outline numbering and parents', () => {
  const tree = computeTree(sample());
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((id) => tree.outline.get(id)), ['1', '1.1', '1.1.1', '1.2', '2', '3']);
  assert.equal(tree.parent.get(3), 2);
  assert.equal(tree.isSummary(1), true);
  assert.equal(tree.isSummary(4), false);
  assert.equal(tree.byOutline.get('1.2'), 4);
  assert.equal(tree.sectionOf.get(4), 100);
  assert.equal(tree.sectionOf.get(6), 101);
});

test('indent / outdent keep a valid tree', () => {
  const rows = sample();
  assert.equal(indent(rows, [5]), true); // B under A
  assert.ok(isValidTree(rows));
  assert.equal(computeTree(rows).outline.get(5), '1.3');
  assert.equal(indent(rows, [1]), false); // first task cannot indent
  assert.equal(indent(rows, [2]), false); // A1 has no previous sibling
  indent(rows, [4]); // A2 under A1 (subtree moves with it)
  assert.deepEqual(levels(rows), [0, 0, 1, 2, 2, 0, 1, 0]);
  assert.ok(isValidTree(rows));
  outdent(rows, [2]); // A1 to top level, keeps children; following sibling B becomes its child
  assert.deepEqual(levels(rows), [0, 0, 0, 1, 1, 0, 1, 0]);
  assert.equal(computeTree(rows).parent.get(5), 2);
  assert.ok(isValidTree(rows));
  outdent(rows, [3, 4]);
  assert.ok(isValidTree(rows));
  assert.equal(outdent(rows, [1]), false);
  for (let i = 0; i < 50; i++) {
    const ids = rows.filter((r) => r.kind !== 'section').map((r) => r.id);
    const pick = ids[(i * 7) % ids.length];
    (i % 3 ? indent : outdent)(rows, [pick]);
    assert.ok(isValidTree(rows), `iteration ${i}`);
  }
});

test('indenting a parent moves its subtree', () => {
  const rows = sample();
  // put A after B so it can be indented under B
  const moved = moveRows(rows, [1], 5, 'after');
  assert.deepEqual(names(moved), ['S1', 'S2', 'B', 'A', 'A1', 'A1a', 'A2', 'C']);
  indent(moved, [1]);
  assert.deepEqual(levels(moved), [0, 0, 0, 1, 2, 3, 2, 0]);
  assert.ok(isValidTree(moved));
});

test('move before / after / inside, with subtrees', () => {
  let rows = sample();
  rows = moveRows(rows, [2], 6, 'inside'); // A1 (+A1a) becomes child of C
  assert.deepEqual(names(rows), ['S1', 'A', 'A2', 'S2', 'B', 'C', 'A1', 'A1a']);
  assert.deepEqual(levels(rows), [0, 0, 1, 0, 0, 0, 1, 2]);
  assert.ok(isValidTree(rows));
  rows = moveRows(rows, [6], 100, 'before'); // C (+subtree) to the very top
  assert.deepEqual(names(rows), ['C', 'A1', 'A1a', 'S1', 'A', 'A2', 'S2', 'B']);
  assert.ok(isValidTree(rows));
  rows = moveRows(rows, [101], 1, 'before'); // move a section
  assert.deepEqual(names(rows), ['C', 'A1', 'A1a', 'S1', 'S2', 'A', 'A2', 'B']);
  assert.equal(moveRows(rows, [6], 3, 'inside'), null); // cannot move into own subtree
  assert.equal(moveRows(rows, [6], 6, 'after'), null);
  rows = moveRows(rows, [5], 4, 'firstchild');
  assert.equal(computeTree(rows).parent.get(5), 4);
  assert.ok(isValidTree(rows));
});

test('delete removes subtrees, keeps tasks when a section is deleted, strips links', () => {
  const rows = sample();
  rows[6].preds = [{ id: 3, type: 'FS', lag: 0 }];
  const { rows: out } = deleteRows(rows, [2, 101]);
  assert.deepEqual(names(out), ['S1', 'A', 'A2', 'B', 'C']);
  assert.deepEqual(out[4].preds, []);
  assert.ok(isValidTree(out));
});

test('normalizeLevels repairs impossible jumps', () => {
  const rows = normalizeLevels([task({ level: 3 }), task({ level: 5 }), task({ level: 1 })]);
  assert.deepEqual(levels(rows), [0, 1, 1]);
});

test('visible rows honour collapse and filters', () => {
  const rows = sample();
  rows[1].collapsed = true;
  let tree = computeTree(rows);
  assert.deepEqual(names(visibleRows(rows, tree)), ['S1', 'A', 'S2', 'B', 'C']);
  rows[1].collapsed = false;
  rows[5].collapsed = true;
  assert.deepEqual(names(visibleRows(rows, tree)), ['S1', 'A', 'A1', 'A1a', 'A2', 'S2']);
  assert.deepEqual(names(visibleRows(rows, tree, new Set([3]))), ['S1', 'A', 'A1', 'A1a']);
  assert.deepEqual(insertionPoint(rows, 1), { at: 2, level: 1 });
  assert.deepEqual(insertionPoint(rows, 4), { at: 5, level: 1 });
});
