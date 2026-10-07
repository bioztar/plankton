import './minidom.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, createTask, serializePlan, parsePlanJSON } from '../src/model/plan.js';
import { computeTree } from '../src/model/tree.js';
import {
  addField, renameField, setFieldOptions, deleteField, setFieldValue, coerceValue, customKeyUsage, promoteCustomKey, fieldKey, formatValue,
} from '../src/model/fields.js';
import { columnState, columnOrder, visibleColumns, moveColumn, moveColumnTo, setColumnVisible, resetColumns } from '../src/ui/grid/columns.js';
import { toCSV } from '../src/io/csv.js';
import { parseDelimited, detectColumns, importTable } from '../src/io/paste.js';
import { matchTasks } from '../src/model/stats.js';
import { clickAction, keyAction } from '../src/ui/grid/edittrigger.js';

function plan3() {
  const p = createPlan({ start: '2026-10-05' });
  p.rows.push(createTask(p, { name: 'Alpha', start: '2026-10-05', duration: 2 }));
  p.rows.push(createTask(p, { name: 'Beta', start: '2026-10-07', duration: 3 }));
  p.rows.push(createTask(p, { name: 'Gamma', start: '2026-10-12', duration: 1 }));
  return p;
}

test('custom column CRUD with typed values', () => {
  const p = plan3();
  const cost = addField(p, { name: 'Cost', type: 'number' }).field;
  const env = addField(p, { name: 'Env', type: 'select', options: ['Dev', 'Prod', 'dev', ' '] }).field;
  assert.deepEqual(env.options, ['Dev', 'Prod']);
  assert.equal(cost.id, 'f1');
  assert.equal(env.id, 'f2');
  assert.match(addField(p, { name: 'cost' }).error, /already/);
  assert.match(addField(p, { name: 'Owner' }).error, /built-in/);
  assert.match(addField(p, { name: '  ' }).error, /name/);
  assert.match(addField(p, { name: 'X', type: 'weird' }).error, /type/);

  const [a, b] = p.rows;
  assert.equal(setFieldValue(a, cost, '1,250.5'), null);
  assert.equal(a.values.f1, 1250.5);
  assert.match(setFieldValue(a, cost, 'lots'), /number/);
  assert.equal(setFieldValue(a, env, 'prod'), null);
  assert.equal(a.values.f2, 'Prod');
  assert.match(setFieldValue(b, env, 'QA'), /choose one of/);
  assert.equal(setFieldValue(b, env, 'Dev'), null);

  assert.equal(renameField(p, 'f1', 'Budget'), null);
  assert.equal(p.fields[0].name, 'Budget');
  assert.match(renameField(p, 'f1', 'env'), /already/);

  assert.equal(setFieldOptions(p, 'f2', ['Prod', 'Staging']), null);
  assert.equal(a.values.f2, 'Prod');
  assert.equal(b.values.f2, undefined, 'values no longer offered are cleared');

  p.settings.columns = { [fieldKey(cost)]: { width: 99 } };
  p.settings.columnOrder = ['owner', fieldKey(cost), 'start'];
  assert.equal(deleteField(p, 'f1'), true);
  assert.deepEqual(p.fields.map((f) => f.id), ['f2']);
  assert.equal('f1' in a.values, false);
  assert.equal(p.settings.columns.cf_f1, undefined);
  assert.deepEqual(p.settings.columnOrder, ['owner', 'start']);
  assert.equal(addField(p, { name: 'Next' }).field.id, 'f3', 'ids are not reused');
});

test('value coercion per type', () => {
  const f = (type, options) => ({ id: 'f1', name: 'F', type, options: options || [] });
  assert.deepEqual(coerceValue(f('checkbox'), 'Yes'), { value: true });
  assert.deepEqual(coerceValue(f('checkbox'), ''), { value: null });
  assert.deepEqual(coerceValue(f('checkbox'), true), { value: true });
  assert.ok(coerceValue(f('checkbox'), 'maybe').error);
  assert.deepEqual(coerceValue(f('date'), '2026-10-09'), { value: '2026-10-09' });
  assert.ok(coerceValue(f('date'), '9 Oct').error);
  assert.deepEqual(coerceValue(f('url'), 'example.com/x'), { value: 'https://example.com/x' });
  assert.deepEqual(coerceValue(f('url'), 'mailto:a@b.example'), { value: 'mailto:a@b.example' });
  assert.ok(coerceValue(f('url'), 'javascript:alert(1)').error);
  assert.deepEqual(coerceValue(f('number'), '3,5'), { value: 3.5 });
  assert.deepEqual(coerceValue(f('number'), '-12'), { value: -12 });
  assert.deepEqual(coerceValue(f('person'), '  Ana  '), { value: 'Ana' });
  assert.equal(formatValue(f('checkbox'), true), 'Yes');
});

test('per-task custom fields promote to a column ("Show as column")', () => {
  const p = plan3();
  p.rows[0].custom = [{ key: 'Cost centre', value: 'CC-42' }, { key: 'Budget', value: '100' }];
  p.rows[1].custom = [{ key: 'cost centre', value: 'CC-7' }];
  p.rows[2].custom = [{ key: 'Budget', value: 'n/a' }, { key: 'Budget', value: '5' }];
  assert.deepEqual(customKeyUsage(p), [{ key: 'Budget', count: 2 }, { key: 'Cost centre', count: 2 }]);

  const r1 = promoteCustomKey(p, 'Cost centre');
  assert.equal(r1.field.type, 'text');
  assert.equal(r1.moved, 2);
  assert.equal(p.rows[0].values[r1.field.id], 'CC-42');
  assert.equal(p.rows[1].values[r1.field.id], 'CC-7');
  assert.deepEqual(p.rows[1].custom, []);

  const r2 = promoteCustomKey(p, 'Budget');
  assert.equal(r2.field.type, 'text', 'mixed values → text');
  assert.equal(p.rows[2].values[r2.field.id], 'n/a');
  assert.deepEqual(p.rows[2].custom, [{ key: 'Budget', value: '5' }], 'second value of the same key is kept, not lost');
  assert.equal(r2.kept, 1);

  const q = plan3();
  q.rows[0].custom = [{ key: 'Points', value: '3' }];
  q.rows[1].custom = [{ key: 'Points', value: '5' }];
  const r3 = promoteCustomKey(q, 'Points');
  assert.equal(r3.field.type, 'number');
  assert.equal(q.rows[1].values[r3.field.id], 5);
  // promoting onto an existing typed column keeps values that do not fit
  q.rows[2].custom = [{ key: 'points', value: 'many' }];
  const r4 = promoteCustomKey(q, 'points');
  assert.equal(r4.field.id, r3.field.id);
  assert.equal(r4.kept, 1);
  assert.deepEqual(q.rows[2].custom, [{ key: 'points', value: 'many' }]);
  assert.match(promoteCustomKey(q, 'Owner').error, /built-in/);
});

test('column order, visibility and widths persist in the plan JSON', () => {
  const p = plan3();
  const risk = addField(p, { name: 'Risk', type: 'select', options: ['Low', 'High'] }).field;
  const keys = () => visibleColumns(p).map((c) => c.key);
  assert.deepEqual(keys().slice(0, 2), ['num', 'name']);
  assert.equal(keys().at(-1), 'cf_f1', 'new custom columns are visible, at the end');

  assert.equal(moveColumn(p, 'owner', -1), true);
  assert.deepEqual(keys().slice(0, 8), ['num', 'name', 'start', 'finish', 'duration', 'owner', 'progress', 'preds']);
  assert.equal(moveColumnTo(p, 'cf_f1', 'start'), true);
  assert.deepEqual(keys().slice(0, 4), ['num', 'name', 'cf_f1', 'start']);
  assert.equal(moveColumn(p, 'cf_f1', -1), false, 'task name stays first');
  assert.equal(moveColumnTo(p, 'name', 'start'), false, 'pinned columns do not move');
  // moving skips hidden columns: priority/workstream are hidden by default
  assert.equal(moveColumn(p, 'status', 1), false, 'already the last visible column');
  assert.equal(moveColumn(p, 'preds', 1), true);
  assert.equal(keys().indexOf('preds'), keys().length - 1);

  setColumnVisible(p, 'owner', false);
  setColumnVisible(p, 'priority', true);
  p.settings.columns.cf_f1 = { ...(p.settings.columns.cf_f1 || {}), width: 150 };
  const back = parsePlanJSON(serializePlan(p));
  assert.deepEqual(back.settings.columnOrder, p.settings.columnOrder);
  assert.deepEqual(visibleColumns(back).map((c) => [c.key, c.width]), visibleColumns(p).map((c) => [c.key, c.width]));
  assert.ok(!keys().includes('owner'));
  assert.ok(keys().includes('priority'));
  assert.deepEqual(back.fields, [{ id: 'f1', name: 'Risk', type: 'select', options: ['Low', 'High'] }]);

  // a saved order missing newer columns still shows them in their natural place
  back.settings.columnOrder = ['finish', 'start'];
  assert.deepEqual(columnOrder(back).slice(0, 4), ['finish', 'start', 'duration', 'progress']);
  assert.equal(columnState(back).length, 13 + 1);
  resetColumns(back);
  assert.deepEqual(columnOrder(back), columnOrder(plan3()).concat('cf_f1'));
  // hostile settings are dropped
  const bad = JSON.parse(serializePlan(p));
  bad.settings.columnOrder = ['owner', '<img>', 5, 'owner'];
  bad.fields.push({ id: 'x"', name: 'Bad' }, { id: 'f9', name: 'risk' }, { id: 'f8', name: 'Ok', type: 'evil' });
  bad.rows[0].values = { f1: 'Nope', f8: 'fine', zz: 1 };
  const nb = parsePlanJSON(JSON.stringify(bad));
  assert.deepEqual(nb.settings.columnOrder, ['owner']);
  assert.deepEqual(nb.fields.map((f) => [f.id, f.type]), [['f1', 'select'], ['f8', 'text']]);
  assert.deepEqual(nb.rows[0].values, { f8: 'fine' });
});

test('CSV export → paste import round-trip with custom columns', () => {
  const p = plan3();
  const cost = addField(p, { name: 'Cost', type: 'number' }).field;
  const env = addField(p, { name: 'Env', type: 'select', options: ['Dev', 'Prod'] }).field;
  const ok = addField(p, { name: 'Signed off', type: 'checkbox' }).field;
  const due = addField(p, { name: 'Review date', type: 'date' }).field;
  const link = addField(p, { name: 'Ticket', type: 'url' }).field;
  const who = addField(p, { name: 'Reviewer', type: 'person' }).field;
  const [a, b] = p.rows;
  setFieldValue(a, cost, '-12.5');
  setFieldValue(a, env, 'Prod');
  setFieldValue(a, ok, 'yes');
  setFieldValue(a, due, '2026-10-20');
  setFieldValue(a, link, 'https://jira.example/T-1?a=1,2');
  setFieldValue(a, who, 'Ana, "QA"');
  setFieldValue(b, cost, '7');
  a.descHtml = '<h2>Scope</h2><p>Line one<br>line two</p><ul><li>bullet</li></ul>';
  const csv = toCSV(p, computeTree(p.rows));
  const header = csv.slice(1).split('\r\n')[0];
  assert.ok(header.endsWith(',Description,Cost,Env,Signed off,Review date,Ticket,Reviewer'), header);

  const target = plan3();
  target.rows = [];
  for (const f of p.fields) addField(target, f);
  const table = parseDelimited(csv.replace(/^\uFEFF/, ''));
  const mapping = detectColumns(table[0], target.fields);
  assert.equal(mapping.cf_f1, table[0].indexOf('Cost'));
  assert.equal(mapping.desc, table[0].indexOf('Description'));
  assert.equal(mapping.notes, table[0].indexOf('Notes'));
  const { rows, warnings } = importTable(target, table, { mapping, hasHeader: true, dateOrder: 'mdy' });
  assert.deepEqual(warnings, []);
  const tasks = rows.filter((r) => r.kind !== 'section');
  assert.deepEqual(tasks.map((t) => t.values), p.rows.map((t) => t.values));
  assert.equal(tasks[0].descHtml, '<p>Scope<br>Line one<br>line two</p><ul><li>bullet</li></ul>');
  // re-export gives the same custom cells
  target.rows = rows;
  const again = toCSV(target, computeTree(rows)).split('\r\n').map((l) => l.split(',').slice(-6).join(','));
  assert.deepEqual(again, csv.split('\r\n').map((l) => l.split(',').slice(-6).join(',')));
  // unknown select option is reported, not silently stored
  const bad = importTable(target, [['Name', 'Env'], ['X', 'Moon']], { mapping: detectColumns(['Name', 'Env'], target.fields), hasHeader: true });
  assert.equal(bad.warnings.length, 1);
});

test('search and filters include custom columns and description text', () => {
  const p = plan3();
  const env = addField(p, { name: 'Env', type: 'select', options: ['Dev', 'Prod'] }).field;
  setFieldValue(p.rows[1], env, 'Prod');
  p.rows[2].descHtml = '<p>Needs <strong>firewall</strong> change</p>';
  p.rows[0].custom = [{ key: 'Cost centre', value: 'CC-42' }];
  const tree = computeTree(p.rows);
  assert.deepEqual([...matchTasks(p, tree, { text: 'prod' })], [p.rows[1].id]);
  assert.deepEqual([...matchTasks(p, tree, { text: 'firewall' })], [p.rows[2].id]);
  assert.deepEqual([...matchTasks(p, tree, { text: 'cc-42' })], [p.rows[0].id]);
  assert.deepEqual([...matchTasks(p, tree, { field: { id: env.id, value: 'Prod' } })], [p.rows[1].id]);
  assert.deepEqual([...matchTasks(p, tree, { field: { id: env.id, value: '' } })], [p.rows[0].id, p.rows[2].id]);
  assert.equal(matchTasks(p, tree, { field: { id: 'f99', value: 'x' } }), null);
});

test('edit triggers: click count, keys', () => {
  assert.equal(clickAction({ detail: 1, editable: true }), 'select');
  assert.equal(clickAction({ detail: 2, editable: true }), 'edit', 'first double-click edits even after a re-render');
  assert.equal(clickAction({ detail: 2, editable: false }), 'open', 'read-only / rolled-up cell opens details');
  assert.equal(clickAction({ detail: 2, editable: false, section: true }), 'select');
  assert.equal(clickAction({ detail: 3, editable: true }), 'select', 'triple-click does not restart the editor');
  assert.equal(clickAction({ detail: 1, act: 'card' }), 'open');
  assert.equal(clickAction({ detail: 2, act: 'card' }), 'open');
  assert.equal(clickAction({ detail: 1, act: 'check', editable: true }), 'check');
  assert.equal(clickAction({ act: 'toggle' }), 'toggle');

  assert.equal(keyAction({ key: 'F2', col: 'name', editable: true }), 'edit');
  assert.equal(keyAction({ key: 'F2', col: 'variance', editable: false }), null);
  assert.equal(keyAction({ key: 'Enter', col: 'owner', editable: true }), 'edit');
  assert.equal(keyAction({ key: 'Enter', col: 'name', editable: true }), 'open');
  assert.equal(keyAction({ key: 'Enter', col: 'owner', editable: true, shift: true }), 'open');
  assert.equal(keyAction({ key: 'Enter', col: 'start', editable: false }), 'open');
  assert.equal(keyAction({ key: 'Enter', col: 'name', section: true, editable: true }), 'edit');
  assert.equal(keyAction({ key: 'Enter', mod: true }), null);
  assert.equal(keyAction({ key: 'a', col: 'name', editable: true }), 'type');
  assert.equal(keyAction({ key: '7', col: 'cf_f1', editable: true, editKind: 'text' }), 'type');
  assert.equal(keyAction({ key: 'a', col: 'status', editable: true, editKind: 'select' }), null);
  assert.equal(keyAction({ key: 'a', mod: true, editable: true }), null);
  assert.equal(keyAction({ key: 'a', editable: false }), null);
  assert.equal(keyAction({ key: ' ', col: 'cf_f2', editable: true, editKind: 'checkbox' }), 'toggle-check');
  assert.equal(keyAction({ key: 'Enter', col: 'cf_f2', editable: true, editKind: 'checkbox' }), 'toggle-check');
});
