import './minidom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { clickAction, keyAction } from '../src/ui/grid/edittrigger.js';
import { dropZone, edgeSpeed, applyRowMove } from '../src/ui/grid/rowdrag.js';
import { createStore } from '../src/ui/state.js';
import { createPlan, createTask, normalizePlan } from '../src/model/plan.js';

test('one click on an editable select cell (Status / Priority / single-select) edits', () => {
  assert.equal(clickAction({ detail: 1, editable: true, editKind: 'select' }), 'edit');
  assert.equal(clickAction({ detail: 2, editable: true, editKind: 'select' }), 'edit');
  assert.equal(clickAction({ detail: 1, editable: true, editKind: 'text' }), 'select', 'text cells still need a double-click');
  assert.equal(clickAction({ detail: 1, editable: true, editKind: 'date' }), 'select');
  assert.equal(clickAction({ detail: 1, editable: true }), 'select');
  assert.equal(clickAction({ detail: 1, editable: false, editKind: 'select' }), 'select', 'read-only / rolled-up status');
  assert.equal(clickAction({ detail: 1, editable: true, editKind: 'select', extend: true }), 'select', 'Shift / Cmd+click extends the selection');
  assert.equal(clickAction({ detail: 1, editable: true, editKind: 'select', section: true }), 'select');
});

test('Enter or Space on a select cell opens it; letters are left to the open list', () => {
  assert.equal(keyAction({ key: 'Enter', col: 'status', editable: true, editKind: 'select' }), 'edit');
  assert.equal(keyAction({ key: ' ', col: 'status', editable: true, editKind: 'select' }), 'edit');
  assert.equal(keyAction({ key: ' ', col: 'status', editable: false, editKind: 'select' }), null);
  assert.equal(keyAction({ key: ' ', col: 'status', editable: true, editKind: 'select', mod: true }), null);
  assert.equal(keyAction({ key: 'a', col: 'status', editable: true, editKind: 'select' }), null);
});

test('dropZone: before / inside / after bands, sections never nest', () => {
  const nest = () => true;
  assert.deepEqual(dropZone(2, 30, 5, nest), { i: 0, zone: 'before' });
  assert.deepEqual(dropZone(15, 30, 5, nest), { i: 0, zone: 'inside' });
  assert.deepEqual(dropZone(28, 30, 5, nest), { i: 0, zone: 'after' });
  assert.deepEqual(dropZone(15, 30, 5, () => false), { i: 0, zone: 'after' });
  assert.deepEqual(dropZone(-50, 30, 5, nest), { i: 0, zone: 'before' }, 'clamped above');
  assert.deepEqual(dropZone(9999, 30, 5, nest), { i: 4, zone: 'after' }, 'clamped below');
  assert.equal(dropZone(10, 30, 0, nest), null);
});

test('dropZone keeps the previous zone near a boundary (no flicker)', () => {
  const nest = () => true;
  const inside = dropZone(15, 30, 5, nest);
  assert.equal(dropZone(21.5, 30, 5, nest, inside), inside, 'just past 0.7 stays inside');
  assert.equal(dropZone(8, 30, 5, nest, inside), inside, 'just before 0.3 stays inside');
  assert.deepEqual(dropZone(27, 30, 5, nest, inside), { i: 0, zone: 'after' }, 'well past the boundary switches');
  const after = dropZone(28, 30, 5, nest);
  assert.equal(dropZone(31, 30, 5, nest, after), after, 'crossing into the next row by a few px keeps "after"');
  assert.deepEqual(dropZone(36, 30, 5, nest, after), { i: 1, zone: 'before' });
  const same = dropZone(15, 30, 5, nest);
  assert.equal(dropZone(16, 30, 5, nest, same), same);
});

test('edgeSpeed ramps up towards the edges and is 0 in the middle', () => {
  assert.equal(edgeSpeed(500, 100, 900), 0);
  assert.ok(edgeSpeed(130, 100, 900) < 0 && edgeSpeed(130, 100, 900) > edgeSpeed(105, 100, 900));
  assert.ok(edgeSpeed(880, 100, 900) > 0 && edgeSpeed(880, 100, 900) < edgeSpeed(899, 100, 900));
  assert.equal(edgeSpeed(-200, 100, 900), -22, 'capped beyond the edge');
  assert.equal(edgeSpeed(5000, 100, 900), 22);
});

function storeWith(names) {
  const p = createPlan({ name: 'Drag', start: '2026-10-05' });
  for (const name of names) p.rows.push(createTask(p, { name, start: '2026-10-05', duration: 1 }));
  return createStore({ plan: normalizePlan(p), storage: null });
}

test('dropping rows back onto their own position adds no undo entry', () => {
  const store = storeWith(['a', 'b', 'c']);
  const [a, b, c] = store.plan.rows;
  const order = () => store.plan.rows.map((r) => r.name).join('');
  assert.equal(store.commit('Move rows', (plan) => applyRowMove(plan, [b.id], a.id, 'after')), false);
  assert.equal(store.commit('Move rows', (plan) => applyRowMove(plan, [b.id], c.id, 'before')), false);
  assert.equal(store.undoStack.length, 0);
  assert.equal(order(), 'abc');
  assert.equal(store.commit('Move rows', (plan) => applyRowMove(plan, [a.id], c.id, 'after')), true);
  assert.equal(order(), 'bca');
  assert.equal(store.undoStack.length, 1);
});

test('dropping a row inside the row above is a real move (level changes)', () => {
  const store = storeWith(['a', 'b']);
  const [a, b] = store.plan.rows;
  assert.equal(store.commit('Move rows', (plan) => applyRowMove(plan, [b.id], a.id, 'inside')), true);
  assert.deepEqual(store.plan.rows.map((r) => r.level), [0, 1]);
  assert.equal(store.undoStack.length, 1);
  assert.equal(store.commit('Move rows', (plan) => applyRowMove(plan, [b.id], a.id, 'firstchild')), false, 'already its first child');
  assert.equal(store.undoStack.length, 1);
  assert.equal(store.commit('Move rows', (plan) => applyRowMove(plan, [a.id], a.id, 'after')), false, 'onto itself');
});
