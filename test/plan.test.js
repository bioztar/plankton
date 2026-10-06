import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, normalizePlan, serializePlan, parsePlanJSON, saveBaseline } from '../src/model/plan.js';
import { samplePlan } from '../src/model/sample.js';
import { computeTree, isValidTree } from '../src/model/tree.js';
import { hasCycle, findConflicts } from '../src/schedule/engine.js';
import { planStats, matchTasks, variance } from '../src/model/stats.js';
import { createStorage } from '../src/io/storage.js';
import { toCSV } from '../src/io/csv.js';
import { parseDelimited } from '../src/io/paste.js';

const NOW = new Date(2026, 9, 6, 12);

test('sample plan matches the brief', () => {
  const plan = samplePlan(NOW);
  const tree = computeTree(plan.rows);
  const tasks = tree.tasks;
  assert.ok(tasks.length >= 25 && tasks.length <= 32, `tasks: ${tasks.length}`);
  assert.equal(plan.rows.filter((r) => r.kind === 'section').length, 4);
  assert.equal(Math.max(...tasks.map((t) => t.level)), 2);
  assert.equal(tasks.filter((t) => t.milestone).length, 2);
  const links = tasks.flatMap((t) => t.preds);
  assert.ok(links.some((l) => l.type === 'SS' && l.lag !== 0));
  assert.ok(links.some((l) => l.type === 'FF' && l.lag !== 0));
  assert.ok(links.some((l) => l.lag < 0));
  assert.ok(isValidTree(plan.rows));
  assert.equal(hasCycle(plan.rows), false);
  assert.equal(findConflicts(plan.rows).length, 0);
});

test('JSON round-trip preserves the plan exactly', () => {
  const plan = samplePlan(NOW);
  saveBaseline(plan);
  plan.rows[2].custom = [{ key: 'Cost centre', value: 'CC-42' }];
  plan.rows[2].tags = ['a', 'b'];
  plan.settings.columns = { owner: { visible: false, width: 120 } };
  const text = serializePlan(plan);
  const back = parsePlanJSON(text);
  assert.deepEqual(back, JSON.parse(text));
  assert.equal(serializePlan(back), text);
  // also accepts an export wrapper { plan: … }
  assert.deepEqual(parsePlanJSON(JSON.stringify({ app: 'planboard', plan })), back);
});

test('normalisation repairs untrusted input', () => {
  assert.throws(() => parsePlanJSON('{nope'), /JSON/);
  assert.throws(() => parsePlanJSON('{"a":1}'), /plan/);
  const p = normalizePlan({
    name: '<b>x</b>',
    rows: [
      { id: 1, name: 'A', start: '2026-10-05', finish: '2026-10-09', level: 4, status: 'weird', progress: 400, preds: [{ id: 9 }, { id: 2, type: 'ss', lag: '2' }] },
      { id: 2, name: 'B', start: 'bad', duration: 3 },
      { id: 2, name: 'dup' },
      { id: 3, kind: 'section', color: 'javascript:alert(1)' },
      null,
    ],
  });
  assert.equal(p.rows.length, 3);
  assert.equal(p.rows[0].level, 0);
  assert.equal(p.rows[0].duration, 5);
  assert.equal(p.rows[0].status, 'Not started');
  assert.equal(p.rows[0].progress, 100);
  assert.deepEqual(p.rows[0].preds, [{ id: 2, type: 'SS', lag: 2 }]);
  assert.equal(p.rows[1].start, p.start);
  assert.equal(p.rows[1].duration, 3);
  assert.equal(p.rows[2].color, '#3b82f6');
  assert.equal(p.nextId, 4);
  assert.equal(p.name, '<b>x</b>'); // kept as text; escaped at render time
});

test('stats, filter and variance', () => {
  const plan = samplePlan(NOW);
  const tree = computeTree(plan.rows);
  const s = planStats(plan, tree, NOW);
  assert.equal(s.tasks, tree.tasks.filter((t) => !tree.isSummary(t.id)).length);
  assert.ok(s.percent > 0 && s.percent < 100);
  assert.ok(s.finish > plan.start);
  plan.statusDate = '2026-12-31';
  assert.ok(planStats(plan, tree).overdue > 0);
  const m = matchTasks(plan, tree, { text: 'pilot' });
  assert.ok(m.size >= 3);
  assert.equal(matchTasks(plan, tree, {}), null);
  const t = { start: '2026-10-05', finish: '2026-10-12', baseline: { start: '2026-10-05', finish: '2026-10-08' } };
  assert.equal(variance(t), 2);
});

test('storage keeps several named plans', () => {
  const st = createStorage();
  const a = createPlan({ name: 'A' });
  const b = createPlan({ name: 'B' });
  st.save(a);
  st.save(b);
  assert.deepEqual(st.list().map((p) => p.name), ['A', 'B']);
  assert.equal(st.index().current, b.id);
  assert.equal(st.load(a.id).name, 'A');
  st.remove(b.id);
  assert.equal(st.index().current, a.id);
  assert.equal(st.load(b.id), null);
});

test('CSV export is flat with outline level and guards formulas', () => {
  const plan = samplePlan(NOW);
  plan.rows[1].name = '=HYPERLINK("x")';
  const csv = toCSV(plan, computeTree(plan.rows));
  const rows = parseDelimited(csv.replace(/^\uFEFF/, ''), ',');
  assert.equal(rows[0][2], 'Outline level');
  assert.equal(rows.length - 1, computeTree(plan.rows).tasks.length);
  assert.equal(rows[1][4], "'=HYPERLINK(\"x\")");
  assert.ok(rows.some((r) => r[1] === '2.2.1' && r[2] === '3'));
});
