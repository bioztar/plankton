import './minidom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, createTask, createSection, normalizePlan } from '../src/model/plan.js';
import { computeTree } from '../src/model/tree.js';
import { addField, fieldKey } from '../src/model/fields.js';
import { setTaskField } from '../src/model/edit.js';
import { parseTSV, toTSV, pasteTargets, fillDownTargets, fillHandleTargets, applyCellEdits, skipSummary, normRange } from '../src/model/cells.js';
import { revealCell, columnBox, pinnedWidth } from '../src/ui/grid/reveal.js';
import { statusNames, priorityNames, isComplete, addOption, renameOption, deleteOption, moveOption, setOptionColor, setOptionComplete, applyOptionList, getOptionList, optionColor } from '../src/model/options.js';
import { sanitizeHtml, cleanDescHtml, repairEscapedHtml } from '../src/util/sanitize.js';
import { needsFormulaGuard, toCSV } from '../src/io/csv.js';
import { appendVersion, makeVersion, decodeSnapshot, encodeSnapshot, summarizeChanges, replacePlanContents, historyBytes, normHistory } from '../src/io/versions.js';
import { createStore } from '../src/ui/state.js';

const COLS = ['num', 'name', 'owner', 'status', 'start', 'duration', 'progress'];

function planWith(n = 4) {
  const p = createPlan({ name: 'P', start: '2026-10-05' });
  for (let i = 0; i < n; i++) p.rows.push(createTask(p, { name: `T${i}`, start: '2026-10-05', duration: 2 }));
  return normalizePlan(p);
}
const editsFor = (p, block, sel) => pasteTargets(block, sel, p.rows.length, COLS.length).cells.map((t) => ({ id: p.rows[t.r].id, col: COLS[t.c], value: t.value }));

// ---- range copy / paste / fill ---------------------------------------------

test('TSV parse/serialize round-trips quotes, tabs, newlines and CRLF', () => {
  assert.deepEqual(parseTSV('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseTSV('"x\ty"\t"he said ""hi"""\n"multi\nline"\tz'), [['x\ty', 'he said "hi"'], ['multi\nline', 'z']]);
  const m = [['a\tb', 'q"'], ['line\nbreak', '']];
  assert.deepEqual(parseTSV(toTSV(m)), m);
});

test('one copied value fills every cell of the selected range', () => {
  const p = planWith(4);
  const edits = editsFor(p, [['Vitaly']], normRange({ r: 0, c: 2 }, { r: 3, c: 2 }));
  assert.equal(edits.length, 4);
  const r = applyCellEdits(p, edits);
  assert.equal(r.applied, 4);
  assert.deepEqual(p.rows.map((t) => t.owner), ['Vitaly', 'Vitaly', 'Vitaly', 'Vitaly']);
});

test('a TSV block pastes from the active cell down/right and clips at the edge', () => {
  const p = planWith(3);
  const block = parseTSV('Ann\tDone\nBob\tIn progress\nCyd\tBlocked\nDan\tDone');
  const edits = editsFor(p, block, normRange({ r: 1, c: 2 }));
  assert.equal(edits.length, 4); // rows 1–2 only
  applyCellEdits(p, edits);
  assert.deepEqual(p.rows.map((t) => [t.owner, t.status]), [['', 'Not started'], ['Ann', 'Done'], ['Bob', 'In progress']].map(([o, s], i) => [i ? o : p.rows[0].owner, s]));
});

test('pasted values are coerced per column, invalid cells skipped with one summary', () => {
  const p = planWith(3);
  const { field: f } = addField(p, { name: 'Budget', type: 'number' });
  const fk = fieldKey(f);
  const cols = ['progress', 'status', 'start', fk];
  const block = parseTSV('55%\tdone\t2026-10-12\t1,500\nabc\tNope\tnot a date\tx');
  const edits = pasteTargets(block, normRange({ r: 0, c: 0 }), 3, 4).cells.map((t) => ({ id: p.rows[t.r].id, col: cols[t.c], value: t.value }));
  const r = applyCellEdits(p, edits, { progress: 'Progress', status: 'Status', start: 'Start', [fk]: 'Budget' });
  const t = p.rows[0];
  assert.equal(t.status, 'Done');
  assert.equal(t.progress, 100); // complete status wins
  assert.equal(t.start, '2026-10-12');
  assert.equal(t.values[f.id], 1500);
  assert.equal(r.skipped.length, 4);
  assert.equal(p.rows[1].status, 'Not started');
  const msg = skipSummary(r.skipped, { progress: 'Progress', status: 'Status', start: 'Start', [fk]: 'Budget' });
  assert.match(msg, /^4 cells skipped: 4 invalid/);
});

test('summary rows skip rolled-up columns, sections skip all but name, read-only columns skipped', () => {
  const p = createPlan({ name: 'P', start: '2026-10-05' });
  const sec = createSection(p, { name: 'Sec' });
  const sum = createTask(p, { name: 'Sum', start: '2026-10-05' });
  const kid = createTask(p, { name: 'Kid', start: '2026-10-05', level: 1 });
  p.rows.push(sec, sum, kid);
  const before = JSON.stringify(sum);
  const r = applyCellEdits(normalizePlan(p) && p, [
    { id: sec.id, col: 'start', value: '2026-10-20' },
    { id: sec.id, col: 'name', value: 'Renamed' },
    { id: sum.id, col: 'start', value: '2026-10-20' },
    { id: sum.id, col: 'duration', value: '9' },
    { id: kid.id, col: 'num', value: '7' },
    { id: kid.id, col: 'start', value: '2026-10-20' },
  ]);
  assert.equal(sec.name, 'Renamed');
  assert.equal(JSON.stringify(sum), before);
  assert.equal(kid.start, '2026-10-20');
  assert.deepEqual(r.skipped.map((s) => s.kind), ['section', 'rollup', 'rollup', 'readonly']);
  assert.match(skipSummary(r.skipped), /4 cells skipped/);
});

test('fill down and the fill handle copy the top row of the range downwards', () => {
  const g = normRange({ r: 2, c: 1 }, { r: 5, c: 2 });
  const f = fillDownTargets(g);
  assert.deepEqual(f.map((t) => [t.r, t.c, t.from.r, t.from.c]), [[3, 1, 2, 1], [3, 2, 2, 2], [4, 1, 2, 1], [4, 2, 2, 2], [5, 1, 2, 1], [5, 2, 2, 2]]);
  assert.deepEqual(fillDownTargets(normRange({ r: 3, c: 1 })).map((t) => [t.r, t.from.r]), [[3, 2]]); // one row: copy from above
  const h = fillHandleTargets(normRange({ r: 0, c: 1 }), 3);
  assert.deepEqual(h.map((t) => [t.r, t.from.r]), [[1, 0], [2, 0], [3, 0]]);
});

test('a whole paste is one undo step', () => {
  const p = planWith(4);
  const store = createStore({ plan: p, storage: null });
  const ids = store.plan.rows.map((r) => r.id);
  const depth = store.undoStack.length;
  store.commit('Paste', (plan) => {
    applyCellEdits(plan, ids.map((id) => ({ id, col: 'owner', value: 'Zed' })));
  });
  assert.equal(store.undoStack.length, depth + 1);
  assert.ok(store.plan.rows.every((r) => r.owner === 'Zed'));
  store.undo();
  assert.ok(store.plan.rows.every((r) => r.owner !== 'Zed'));
});

// ---- scroll into view --------------------------------------------------------

test('reveal: horizontal scroll accounts for the pinned columns and the sticky header', () => {
  const widths = [40, 260, 120, 120, 120, 120];
  const pin = pinnedWidth(widths, 2);
  assert.equal(pin, 300);
  const view = { top: 0, left: 0, width: 500, height: 300 };
  const col5 = columnBox(widths, 5);
  assert.deepEqual(col5, { left: 660, width: 120 });
  // off to the right → scroll so its right edge meets the viewport edge
  assert.equal(revealCell(view, { top: 0, height: 28, ...col5 }, { top: 32, left: pin }).left, 280);
  // scrolled too far: column 2 is hidden behind the pinned columns
  const c2 = columnBox(widths, 2);
  assert.equal(revealCell({ ...view, left: 200 }, { top: 0, height: 28, ...c2 }, { top: 32, left: pin }).left, 0);
  const c3 = columnBox(widths, 3);
  assert.equal(revealCell({ ...view, left: 250 }, { top: 0, height: 28, ...c3 }, { top: 32, left: pin }).left, 120);
  // pinned cells never scroll horizontally
  assert.equal(revealCell({ ...view, left: 250 }, { top: 0, height: 28, left: 40, width: 260 }, { top: 32, left: pin, pinned: true }).left, 250);
  // vertical: above (under the sticky header) and below
  assert.equal(revealCell({ ...view, top: 200 }, { top: 210, height: 28, ...c3 }, { top: 32, left: pin }).top, 178);
  assert.equal(revealCell(view, { top: 400, height: 28, ...c3 }, { top: 32, left: pin }).top, 128);
  // already fully visible: no change
  assert.deepEqual(revealCell({ ...view, left: 0 }, { top: 60, height: 28, ...c2 }, { top: 32, left: pin }), { top: 0, left: 0 });
});

// ---- editable options --------------------------------------------------------

test('old plans get default option lists; add / rename / reorder / colour / delete', () => {
  const p = normalizePlan({ name: 'Old', start: '2026-10-05', rows: [{ id: 1, name: 'a', start: '2026-10-05', duration: 1, status: 'In progress', priority: 'High' }] });
  assert.deepEqual(statusNames(p), ['Not started', 'In progress', 'Blocked', 'Done']);
  assert.deepEqual(priorityNames(p), ['Low', 'Medium', 'High', 'Critical']);
  assert.ok(!addOption(p, 'status', 'Review').error);
  assert.ok(statusNames(p).includes('Review'));
  assert.ok(addOption(p, 'status', 'review').error); // duplicate (case-insensitive) rejected
  assert.ok(!renameOption(p, 'status', 'In progress', 'Doing').error);
  assert.equal(p.rows[0].status, 'Doing');
  assert.ok(!moveOption(p, 'status', 'Review', 0).error);
  assert.equal(statusNames(p)[0], 'Review');
  assert.ok(!setOptionColor(p, 'priority', 'High', '#7c3aed').error);
  assert.equal(optionColor(p, 'priority', 'High'), '#7c3aed');
  assert.ok(!deleteOption(p, 'priority', 'High', 'Low').error);
  assert.equal(p.rows[0].priority, 'Low');
  assert.ok(!priorityNames(p).includes('High'));
  const again = normalizePlan(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(getOptionList(again, 'status'), getOptionList(p, 'status'));
});

test('complete flag: at least one complete and one open status; flagging sets progress 100', () => {
  const p = planWith(1);
  setTaskField(p.rows[0], 'status', 'Blocked', undefined, p);
  assert.ok(setOptionComplete(p, 'Done', false).error); // would leave no complete status
  assert.ok(!setOptionComplete(p, 'Blocked', true).error);
  assert.ok(isComplete(p, 'Blocked'));
  assert.equal(p.rows[0].progress, 100);
  const all = getOptionList(p, 'status').map((o) => ({ ...o, complete: true }));
  assert.ok(applyOptionList(p, 'status', all).error); // needs one open status
  assert.ok(deleteOption(p, 'status', 'Blocked', 'Nope').error); // used by a task: must say where it moves
  assert.ok(!deleteOption(p, 'status', 'Blocked', 'In progress').error);
  assert.equal(p.rows[0].status, 'In progress');
  assert.equal(p.rows[0].progress, 90);
});

test('custom single-select options are edited through the same model', () => {
  const p = planWith(1);
  const { field: f } = addField(p, { name: 'Phase', type: 'select', options: ['A', 'B'] });
  p.rows[0].values = { [f.id]: 'A' };
  assert.ok(!renameOption(p, f.id, 'A', 'Alpha').error);
  assert.equal(p.rows[0].values[f.id], 'Alpha');
  assert.deepEqual(getOptionList(p, f.id).map((o) => o.name), ['Alpha', 'B']);
});

test('done → progress rule: complete status sets 100, progress 100 never changes status', () => {
  const p = planWith(1);
  const t = p.rows[0];
  setTaskField(t, 'status', 'In progress', undefined, p);
  setTaskField(t, 'progress', '100', undefined, p);
  assert.equal(t.status, 'In progress');
  assert.equal(t.progress, 100);
  setTaskField(t, 'progress', '40', undefined, p);
  setTaskField(t, 'status', 'Done', undefined, p);
  assert.equal(t.progress, 100);
  setTaskField(t, 'progress', '60', undefined, p);
  assert.equal(t.status, 'Done');
});

// ---- sanitizer ---------------------------------------------------------------

test('sanitize works without DOMParser and normalizePlan is idempotent in Node', () => {
  const saved = globalThis.DOMParser;
  delete globalThis.DOMParser;
  try {
    const p = createPlan({ name: 'P', start: '2026-10-05' });
    p.rows.push(createTask(p, { descHtml: '<p>x <b>y</b></p><script>bad()</script><ul><li onclick="z">i</li></ul>' }));
    const once = normalizePlan(p);
    const twice = normalizePlan(JSON.parse(JSON.stringify(once)));
    assert.equal(once.rows[0].descHtml, '<p>x <strong>y</strong></p><ul><li>i</li></ul>');
    assert.equal(twice.rows[0].descHtml, once.rows[0].descHtml);
    assert.equal(sanitizeHtml(sanitizeHtml('<h1>T</h1><p>a &amp; b &lt;c&gt;</p>')), '<h1>T</h1><p>a &amp; b &lt;c&gt;</p>');
  } finally {
    globalThis.DOMParser = saved;
  }
});

test('escaped descriptions are repaired on load, nested up to six levels', () => {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let s = '<p>x <b>y</b></p>';
  for (let i = 0; i < 4; i++) s = `<p>${esc(s)}</p>`;
  assert.deepEqual(repairEscapedHtml(s), { html: '<p>x <strong>y</strong></p>', levels: 4 });
  const rep = {};
  const p = normalizePlan({ name: 'P', start: '2026-10-05', rows: [{ id: 1, name: 'a', start: '2026-10-05', duration: 1, descHtml: s }] }, rep);
  assert.equal(p.rows[0].descHtml, '<p>x <strong>y</strong></p>');
  assert.equal(cleanDescHtml(`<p>${esc('<ul><li>one</li></ul>')}</p>`), '<ul><li>one</li></ul>');
  let deep = '<p>z</p>';
  for (let i = 0; i < 8; i++) deep = `<p>${esc(deep)}</p>`;
  assert.equal(repairEscapedHtml(deep).levels, 6);
});

test('plain text that mentions <CR> or a < b stays text', () => {
  for (const t of ['Press <CR> to continue', 'a < b and c > d', '<p> is a tag name']) {
    const html = sanitizeHtml(`<p>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`);
    assert.equal(cleanDescHtml(html), html);
  }
  assert.equal(cleanDescHtml('Press <CR> to continue'), sanitizeHtml('Press <CR> to continue'));
});

test('oversized descriptions are reported, empty inline cleanup has no regex state', () => {
  const rep = {};
  const out = sanitizeHtml(`<p>${'x'.repeat(250000)}</p>`, rep);
  assert.equal(rep.truncated, true);
  assert.ok(out.length <= 200000);
  for (let i = 0; i < 3; i++) assert.equal(sanitizeHtml('<p>a<b></b><i> </i>b</p>'), sanitizeHtml('<p>a<b></b><i> </i>b</p>'));
});

test('CSV guard keeps "- " bullets and negative numbers, guards formulas', () => {
  for (const s of ['- item', '+ item', '- buy milk, eggs', '-2', '+3.5', 'plain']) assert.equal(needsFormulaGuard(s), false, s);
  for (const s of ['=SUM(A1:A2)', '@cmd', '-2+3', '+cmd|x', '- =HYPERLINK("x")', '-SUM(A1)']) assert.equal(needsFormulaGuard(s), true, s);
  const p = planWith(1);
  p.rows[0].name = '- bullet';
  assert.ok(toCSV(p, computeTree(p.rows)).includes(',- bullet,'));
});

// ---- version history -----------------------------------------------------------

test('snapshots round-trip compressed and uncompressed', async () => {
  const p = planWith(2);
  const z = await encodeSnapshot(p);
  assert.equal(z.enc, 'gzip-base64');
  assert.deepEqual(await decodeSnapshot(z), JSON.parse(JSON.stringify(p)));
  const raw = await encodeSnapshot(p, { compress: false });
  assert.equal(raw.enc, 'json');
  assert.deepEqual(await decodeSnapshot(raw), JSON.parse(JSON.stringify(p)));
});

test('history append numbers versions and caps by count and by size, oldest first', async () => {
  let list = [];
  const p = planWith(1);
  let prev = null;
  for (let i = 0; i < 55; i++) {
    p.rows[0].progress = i;
    const data = JSON.parse(JSON.stringify(p));
    list = appendVersion(list, await makeVersion(list, data, prev, { author: 'V', at: new Date(Date.UTC(2026, 9, 7, 0, i)).toISOString(), compress: false }));
    prev = data;
  }
  assert.equal(list.length, 50);
  assert.equal(list[0].n, 6);
  assert.equal(list.at(-1).n, 55);
  assert.equal(list.at(-1).author, 'V');
  const small = appendVersion(list, list.at(-1), { maxBytes: historyBytes(list.slice(-3)) });
  assert.ok(small.length <= 3 && small.length >= 1);
  assert.equal(small.at(-1).n, 55);
  assert.deepEqual(normHistory(JSON.parse(JSON.stringify(list))).length, 50);
});

test('change summary lists edits in plain words', () => {
  const a = planWith(2);
  a.rows[0].name = 'Book steering';
  const b = JSON.parse(JSON.stringify(a));
  b.rows[0].status = 'Done';
  b.rows.push(createTask(b, { name: 'N1' }), createTask(b, { name: 'N2' }));
  const ch = summarizeChanges(a, b);
  assert.ok(ch.includes('“Book steering”: status Not started → Done'), ch.join(' | '));
  assert.ok(ch.some((c) => c.startsWith('+2 tasks')), ch.join(' | '));
  assert.match(summarizeChanges(null, a)[0], /First saved version/);
});

test('restoring a version replaces the plan in one undoable step', async () => {
  const p = planWith(2);
  const store = createStore({ plan: p, storage: null });
  const v = await makeVersion([], JSON.parse(JSON.stringify(store.plan)), null, { compress: true });
  store.commit('Edit', (plan) => {
    plan.rows[0].name = 'Changed';
    plan.rows.pop();
  });
  const snap = normalizePlan(await decodeSnapshot(v.snapshot));
  const id = store.plan.id;
  store.commit('Restore version 1', (cur) => {
    replacePlanContents(cur, snap);
  });
  assert.equal(store.plan.id, id);
  assert.equal(store.plan.rows.length, 2);
  assert.equal(store.plan.rows[0].name, 'T0');
  store.undo();
  assert.equal(store.plan.rows[0].name, 'Changed');
});
