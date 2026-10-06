import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited, detectDelimiter, detectColumns, detectDateOrder, parseDate, parseDuration, importTable, looksLikeHeader } from '../src/io/paste.js';
import { createPlan } from '../src/model/plan.js';
import { computeTree, isValidTree } from '../src/model/tree.js';

test('delimited parsing handles TSV, CSV quotes and embedded newlines', () => {
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.equal(detectDelimiter('a;b;c'), ';');
  assert.deepEqual(parseDelimited('a\tb\r\n1\t2\r\n\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseDelimited('name,notes\n"Task, one","line1\nline2 ""q"""', ','), [['name', 'notes'], ['Task, one', 'line1\nline2 "q"']]);
});

test('column auto-detection', () => {
  const map = detectColumns(['ID', 'Task Name', 'Duration', 'Start', 'Finish', 'Predecessors', 'Resource Names', 'Outline Level', 'Bucket', 'Notes', '% Complete']);
  assert.deepEqual(map, { id: 0, name: 1, duration: 2, start: 3, finish: 4, preds: 5, owner: 6, level: 7, section: 8, notes: 9, progress: 10 });
  assert.equal(looksLikeHeader(['Task', 'Start']), true);
  assert.equal(looksLikeHeader(['Write spec', '2026-10-05']), false);
});

test('dates in ISO, M/D/YYYY and D/M/YYYY', () => {
  assert.equal(parseDate('2026-10-05'), '2026-10-05');
  assert.equal(parseDate('03/04/2026', 'mdy'), '2026-03-04');
  assert.equal(parseDate('03/04/2026', 'dmy'), '2026-04-03');
  assert.equal(parseDate('3.4.26', 'dmy'), '2026-04-03');
  assert.equal(parseDate('2/30/2026', 'mdy'), null);
  assert.equal(parseDate('10/5/2026 9:00 AM', 'mdy'), '2026-10-05');
  assert.equal(detectDateOrder(['03/04/2026', '05/06/2026']), 'ambiguous');
  assert.equal(detectDateOrder(['03/04/2026', '13/04/2026']), 'dmy');
  assert.equal(detectDateOrder(['12/31/2026', '1/2/2027']), 'mdy');
  assert.equal(detectDateOrder(['2026-10-05']), 'iso');
  assert.equal(detectDateOrder(['n/a', '']), 'none');
  assert.equal(parseDuration('5'), 5);
  assert.equal(parseDuration('5 days'), 5);
  assert.equal(parseDuration('2w'), 10);
  assert.equal(parseDuration('3d?'), 3);
  assert.equal(parseDuration('0'), 0);
  assert.equal(parseDuration('soon'), null);
});

const TSV = [
  'ID\tName\tStart\tFinish\tDuration\tOwner\tPredecessors\tOutline level\tBucket\tNotes',
  '1\tPrepare\t\t\t\t\t\t1\tPlan\t',
  '2\tWrite brief\t03/02/2026\t04/02/2026\t\tAlex R\t\t2\tPlan\tfirst draft',
  '3\tReview brief\t05/02/2026\t\t2\tSam\t2FS+1d\t2\tPlan\t',
  '4\tLaunch\t\t\t0\t\t3\t1\tGo-live\t',
].join('\n');

test('TSV paste with outline levels, sections and D/M/YYYY dates', () => {
  const table = parseDelimited(TSV);
  const mapping = detectColumns(table[0]);
  const order = detectDateOrder(table.slice(1).flatMap((r) => [r[mapping.start], r[mapping.finish]]));
  assert.equal(order, 'ambiguous');
  const plan = createPlan({ start: '2026-01-05' });
  const { rows, warnings } = importTable(plan, table, { mapping, hasHeader: true, dateOrder: 'dmy' });
  assert.deepEqual(warnings, []);
  assert.deepEqual(rows.map((r) => r.kind === 'section' ? `[${r.name}]` : r.name), ['[Plan]', 'Prepare', 'Write brief', 'Review brief', '[Go-live]', 'Launch']);
  assert.ok(isValidTree(rows));
  const tree = computeTree(rows);
  const byName = Object.fromEntries(rows.filter((r) => r.kind !== 'section').map((r) => [r.name, r]));
  assert.equal(tree.outline.get(byName['Review brief'].id), '1.2');
  assert.equal(byName['Write brief'].start, '2026-02-03');
  assert.equal(byName['Write brief'].finish, '2026-02-04');
  assert.equal(byName['Write brief'].duration, 2);
  assert.equal(byName['Write brief'].owner, 'Alex R');
  assert.equal(byName['Write brief'].notes, 'first draft');
  assert.equal(byName['Review brief'].start, '2026-02-05');
  assert.equal(byName['Review brief'].finish, '2026-02-06');
  assert.deepEqual(byName['Review brief'].preds, [{ id: byName['Write brief'].id, type: 'FS', lag: 1 }]);
  assert.deepEqual(byName['Launch'].preds, [{ id: byName['Review brief'].id, type: 'FS', lag: 0 }]);
  assert.equal(byName['Launch'].milestone, true);
});

test('same paste read as M/D/YYYY', () => {
  const table = parseDelimited(TSV);
  const plan = createPlan({ start: '2026-01-05' });
  const { rows } = importTable(plan, table, { mapping: detectColumns(table[0]), hasHeader: true, dateOrder: 'mdy' });
  const wb = rows.find((r) => r.name === 'Write brief');
  assert.equal(wb.start, '2026-03-02');
  assert.equal(wb.finish, '2026-04-02');
  assert.equal(wb.duration, 24);
});

test('indent via leading spaces and outline numbers, predecessors by row number', () => {
  const text = 'Task\tStart\tDur\tDepends on\nPhase 1\t2026-10-05\t\t\n  Design\t2026-10-05\t3\t\n  Build\t2026-10-08\t5\t2\n    Unit tests\t2026-10-12\t2\t3SS+1d\nPhase 2\t2026-10-20\t1\t1.2';
  const table = parseDelimited(text);
  const mapping = detectColumns(table[0]);
  assert.equal(mapping.duration, 2);
  const plan = createPlan();
  const { rows, warnings } = importTable(plan, table, { mapping, hasHeader: true, dateOrder: 'mdy' });
  assert.deepEqual(warnings, []);
  assert.deepEqual(rows.map((r) => r.level), [0, 1, 1, 2, 0]);
  const [, design, build, unit, p2] = rows;
  assert.deepEqual(build.preds, [{ id: design.id, type: 'FS', lag: 0 }]);
  assert.deepEqual(unit.preds, [{ id: build.id, type: 'SS', lag: 1 }]);
  assert.deepEqual(p2.preds, [{ id: build.id, type: 'FS', lag: 0 }]);
  assert.equal(design.finish, '2026-10-07');

  const outlined = parseDelimited('WBS\tName\n1\tA\n1.1\tB\n1.1.1\tC\n2\tD');
  const r2 = importTable(createPlan(), outlined, { mapping: detectColumns(outlined[0]), hasHeader: true }).rows;
  assert.deepEqual(r2.map((r) => r.level), [0, 1, 2, 0]);
});

test('bad values produce warnings, not crashes', () => {
  const table = parseDelimited('Name\tStart\tPredecessors\nA\tnot a date\t9\nB\t2026-10-05\t1FS+x');
  const { rows, warnings } = importTable(createPlan(), table, { mapping: detectColumns(table[0]), hasHeader: true });
  assert.equal(rows.length, 2);
  assert.equal(warnings.length, 3);
});
