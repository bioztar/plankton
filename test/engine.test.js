import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollup, autoSchedule, linkError, hasCycle, findConflicts, sanitizeLinks } from '../src/schedule/engine.js';
import { computeTree } from '../src/model/tree.js';
import { task, section } from './helpers.js';

const dates = (t) => [t.start, t.finish];

test('summary roll-up: min start, max finish, duration-weighted progress', () => {
  const rows = [
    task({ id: 1, name: 'Summary', level: 0 }),
    task({ id: 2, level: 1, start: '2026-10-07', finish: '2026-10-08', duration: 2, progress: 100 }),
    task({ id: 3, level: 1, start: '2026-10-12', finish: '2026-10-19', duration: 6, progress: 0 }),
    task({ id: 4, level: 1, name: 'Sub-summary' }),
    task({ id: 5, level: 2, start: '2026-10-05', finish: '2026-10-06', duration: 2, progress: 50 }),
    task({ id: 6, level: 2, start: '2026-10-06', finish: '2026-10-06', duration: 0, milestone: true, progress: 0 }),
  ];
  rollup(rows);
  assert.deepEqual(dates(rows[3]), ['2026-10-05', '2026-10-06']);
  assert.equal(rows[3].progress, 50);
  assert.deepEqual(dates(rows[0]), ['2026-10-05', '2026-10-19']);
  assert.equal(rows[0].duration, 11);
  // (2*100 + 6*0 + 2*50) / 10 = 30
  assert.equal(rows[0].progress, 30);
});

test('auto-schedule pushes a chain forward, skipping weekends', () => {
  const rows = [
    task({ id: 1, start: '2026-10-05', finish: '2026-10-09', duration: 5 }),
    task({ id: 2, start: '2026-10-05', finish: '2026-10-07', duration: 3, preds: [{ id: 1, type: 'FS', lag: 0 }] }),
    task({ id: 3, start: '2026-10-05', finish: '2026-10-06', duration: 2, preds: [{ id: 2, type: 'FS', lag: 1 }] }),
    task({ id: 4, start: '2026-10-05', finish: '2026-10-05', duration: 1, preds: [{ id: 3, type: 'SS', lag: -1 }] }),
  ];
  const changed = autoSchedule(rows);
  assert.deepEqual([...changed].sort(), [2, 3, 4]);
  assert.deepEqual(dates(rows[1]), ['2026-10-12', '2026-10-14']);
  assert.deepEqual(dates(rows[2]), ['2026-10-16', '2026-10-19']);
  assert.deepEqual(dates(rows[3]), ['2026-10-15', '2026-10-15']);
  // moving the first task later propagates through the whole chain
  Object.assign(rows[0], { start: '2026-10-07', finish: '2026-10-13' });
  autoSchedule(rows);
  assert.deepEqual(dates(rows[1]), ['2026-10-14', '2026-10-16']);
  assert.deepEqual(dates(rows[2]), ['2026-10-20', '2026-10-21']);
  assert.deepEqual(dates(rows[3]), ['2026-10-19', '2026-10-19']);
  assert.equal(findConflicts(rows).length, 0);
});

test('auto-schedule never pulls tasks earlier', () => {
  const rows = [
    task({ id: 1, start: '2026-10-05', finish: '2026-10-05', duration: 1 }),
    task({ id: 2, start: '2026-10-20', finish: '2026-10-20', duration: 1, preds: [{ id: 1, type: 'FS', lag: 0 }] }),
  ];
  assert.equal(autoSchedule(rows).size, 0);
  assert.equal(rows[1].start, '2026-10-20');
});

test('links to and from summaries move whole subtrees', () => {
  const rows = [
    task({ id: 1, start: '2026-10-05', finish: '2026-10-09', duration: 5 }),
    section({ id: 9 }),
    task({ id: 2, name: 'Summary', preds: [{ id: 1, type: 'FS', lag: 0 }] }),
    task({ id: 3, level: 1, start: '2026-10-05', finish: '2026-10-06', duration: 2 }),
    task({ id: 4, level: 1, start: '2026-10-07', finish: '2026-10-07', duration: 1 }),
    task({ id: 5, start: '2026-10-05', finish: '2026-10-05', duration: 1, preds: [{ id: 2, type: 'FS', lag: 0 }] }),
  ];
  autoSchedule(rows);
  assert.deepEqual(dates(rows[3]), ['2026-10-12', '2026-10-13']);
  assert.deepEqual(dates(rows[4]), ['2026-10-14', '2026-10-14']);
  assert.deepEqual(dates(rows[2]), ['2026-10-12', '2026-10-14']);
  assert.deepEqual(dates(rows[5]), ['2026-10-15', '2026-10-15']);
});

test('conflicts are reported when auto-schedule is off', () => {
  const rows = [
    task({ id: 1, start: '2026-10-05', finish: '2026-10-09', duration: 5 }),
    task({ id: 2, start: '2026-10-07', finish: '2026-10-07', duration: 1, preds: [{ id: 1, type: 'FS', lag: 0 }] }),
  ];
  const c = findConflicts(rows);
  assert.equal(c.length, 1);
  assert.equal(c[0].predId, 1);
  assert.equal(c[0].succId, 2);
  assert.equal(c[0].days, 3);
});

test('cycle detection refuses links that close a loop', () => {
  const rows = [
    task({ id: 1 }),
    task({ id: 2, preds: [{ id: 1, type: 'FS', lag: 0 }] }),
    task({ id: 3, preds: [{ id: 2, type: 'SS', lag: 0 }] }),
    task({ id: 4, name: 'Summary' }),
    task({ id: 5, level: 1 }),
  ];
  assert.equal(hasCycle(rows), false);
  assert.match(linkError(rows, 3, 1), /circular/);
  assert.match(linkError(rows, 1, 1), /itself/);
  assert.match(linkError(rows, 4, 5), /summary/i);
  assert.equal(linkError(rows, 1, 3), null);
  // a cycle through a summary: 5 → 1 while summary 4 depends on 3
  rows[3].preds = [{ id: 3, type: 'FS', lag: 0 }];
  assert.match(linkError(rows, 5, 1), /circular/);
  rows[0].preds = [{ id: 3, type: 'FS', lag: 0 }];
  assert.equal(hasCycle(rows), true);
  assert.throws(() => autoSchedule(rows), /cycle/i);
  const dropped = sanitizeLinks(rows);
  assert.equal(hasCycle(rows), false);
  assert.ok(dropped.length >= 1);
});

test('sanitizeLinks drops self, duplicate and dangling links', () => {
  const rows = [task({ id: 1, preds: [{ id: 1, type: 'FS', lag: 0 }] }), task({ id: 2, preds: [{ id: 1, type: 'FS', lag: 0 }, { id: 1, type: 'SS', lag: 0 }, { id: 99, type: 'FS', lag: 0 }] })];
  sanitizeLinks(rows);
  assert.deepEqual(rows[0].preds, []);
  assert.deepEqual(rows[1].preds, [{ id: 1, type: 'FS', lag: 0 }]);
  assert.ok(computeTree(rows));
});
