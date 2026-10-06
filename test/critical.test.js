import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criticalPath } from '../src/schedule/critical.js';
import { autoSchedule } from '../src/schedule/engine.js';
import { task } from './helpers.js';

//      ┌─ B (2d) ─┐
//  A (3d)          D (1d)        A→C→D is the longest path (9 days); B has 3 days float.
//      └─ C (5d) ─┘
function network() {
  const rows = [
    task({ id: 1, name: 'A', duration: 3 }),
    task({ id: 2, name: 'B', duration: 2, preds: [{ id: 1, type: 'FS', lag: 0 }] }),
    task({ id: 3, name: 'C', duration: 5, preds: [{ id: 1, type: 'FS', lag: 0 }] }),
    task({ id: 4, name: 'D', duration: 1, preds: [{ id: 2, type: 'FS', lag: 0 }, { id: 3, type: 'FS', lag: 0 }] }),
  ];
  autoSchedule(rows);
  return rows;
}

test('critical path on a small known network', () => {
  const rows = network();
  assert.deepEqual(rows.map((r) => r.finish), ['2026-10-07', '2026-10-09', '2026-10-14', '2026-10-15']);
  const cp = criticalPath(rows);
  assert.deepEqual([...cp.tasks].sort(), [1, 3, 4]);
  assert.deepEqual([...cp.links].sort(), ['1>3', '3>4']);
  assert.equal(cp.float.get(2), 3);
  assert.equal(cp.float.get(3), 0);
});

test('critical path follows lag and SS / FF links', () => {
  const rows = network();
  // add a long SS-linked task E that finishes after D → E becomes the critical end
  rows.push(task({ id: 5, name: 'E', duration: 8, preds: [{ id: 3, type: 'SS', lag: 2 }] }));
  autoSchedule(rows);
  const cp = criticalPath(rows);
  assert.ok(cp.tasks.has(5));
  assert.ok(cp.tasks.has(3));
  assert.ok(cp.tasks.has(1));
  assert.ok(!cp.tasks.has(4));
  assert.ok(cp.links.has('3>5'));
});

test('no critical path for an empty plan', () => {
  assert.equal(criticalPath([]).tasks.size, 0);
});
