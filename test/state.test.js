import './minidom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/ui/state.js';
import { createHistory } from '../src/model/history.js';
import { createPlan, createTask, normalizePlan } from '../src/model/plan.js';
import { hasCycle } from '../src/schedule/engine.js';
import { renderMarkdown } from '../src/util/markdown.js';

function bigPlan(n) {
  const p = createPlan({ name: 'Big', start: '2026-10-05' });
  for (let i = 0; i < n; i++) {
    const t = createTask(p, { name: `Task ${i}`, start: '2026-10-05', duration: 2, desc: 'Some description text '.repeat(10) });
    if (i) t.preds = [{ id: p.rows[i - 1].id, type: 'FS', lag: 0 }];
    p.rows.push(t);
  }
  return p;
}

test('normalizePlan removes links that form a cycle and reports them', () => {
  const report = {};
  const p = normalizePlan({
    start: '2026-10-05',
    rows: [
      { id: 1, name: 'a', start: '2026-10-05', duration: 1, preds: [{ id: 3 }] },
      { id: 2, name: 'b', start: '2026-10-05', duration: 1, preds: [{ id: 1 }] },
      { id: 3, name: 'c', start: '2026-10-05', duration: 1, preds: [{ id: 2 }] },
    ],
  }, report);
  assert.equal(report.droppedLinks.length, 1);
  assert.equal(hasCycle(p.rows), false);
  assert.equal(p.rows.reduce((n, r) => n + r.preds.length, 0), 2);
});

test('store warns when a commit introduces a cycle and the link is dropped', () => {
  const store = createStore({ plan: normalizePlan(bigPlan(3)), storage: null });
  const events = [];
  store.on((kind, data) => events.push([kind, data]));
  const [a, , c] = store.plan.rows;
  store.commit('Force cycle', (plan) => {
    plan.rows[0].preds.push({ id: c.id, type: 'FS', lag: 0 });
  });
  const warn = events.find((e) => e[0] === 'warn');
  assert.ok(warn, 'no warn event');
  assert.match(warn[1], /^1 circular link removed/);
  assert.equal(hasCycle(store.plan.rows), false);
  assert.ok(store.plan.rows.find((r) => r.id === a.id));
});

test('undo history shares unchanged rows: 150 edits on 500 tasks stay small and undo fully', () => {
  const plan = normalizePlan(bigPlan(500));
  const planBytes = JSON.stringify(plan).length * 2;
  const store = createStore({ plan, storage: null });
  const original = store.plan.rows.map((r) => r.name);
  for (let i = 0; i < 150; i++) {
    store.commit('Rename', (p) => {
      p.rows[i].name = `Renamed ${i}`;
    }, { schedule: false });
  }
  assert.equal(store.undoStack.length, 150);
  // One full plan for the first snapshot, then per step one changed row plus a pointer per
  // row: a few plan-sizes in total instead of 150 full copies.
  assert.ok(store.historyBytes() < planBytes * 5, `${store.historyBytes()} vs plan ${planBytes}`);
  for (let i = 0; i < 150; i++) assert.ok(store.undo());
  assert.deepEqual(store.plan.rows.map((r) => r.name), original);
  for (let i = 0; i < 150; i++) assert.ok(store.redo());
  assert.equal(store.plan.rows[149].name, 'Renamed 149');
});

test('history push trims by step count and by bytes', () => {
  const h = createHistory({ maxSteps: 5, maxBytes: 1e9 });
  const stack = [];
  for (let i = 0; i < 9; i++) h.push(stack, h.snap({ name: `p${i}`, rows: [{ id: 1, v: i }] }));
  assert.equal(stack.length, 5);
  assert.equal(h.restore(stack[0]).name, 'p4');
  const hb = createHistory({ maxSteps: 100, maxBytes: 2000 });
  const s2 = [];
  for (let i = 0; i < 50; i++) hb.push(s2, hb.snap({ name: 'x'.repeat(100), rows: [{ id: 1, v: i }] }));
  assert.ok(hb.bytes(s2) <= 2000 && s2.length >= 1);
  assert.ok(s2.length < 50);
});

test('markdown strips control characters (placeholder bytes cannot inject stashed HTML)', () => {
  const out = renderMarkdown('a\u00000\u0000 b\u00010\u0001 [x](https://example.com) c\u0007');
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(out), JSON.stringify(out));
  assert.equal((out.match(/<a /g) || []).length, 1);
  assert.match(out, /^<p>a0 b0 <a href="https:\/\/example.com"/);
});
