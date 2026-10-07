import './minidom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isISODate, fromYMD, toISO, parseISO, applyDateEdit, MAX_DURATION, MAX_LAG } from '../src/schedule/calendar.js';
import { parseLinkToken } from '../src/schedule/links.js';
import { addLink, setTaskField } from '../src/model/edit.js';
import { normalizePlan } from '../src/model/plan.js';
import { parseDate } from '../src/io/paste.js';
import { task } from './helpers.js';

test('isISODate only accepts years 1900..2200', () => {
  assert.equal(isISODate('1899-12-31'), false);
  assert.equal(isISODate('1900-01-01'), true);
  assert.equal(isISODate('2200-12-31'), true);
  assert.equal(isISODate('2201-01-01'), false);
  assert.equal(isISODate('0026-03-01'), false);
});

test('fromYMD does not map two-digit years to the 1900s', () => {
  assert.equal(toISO(fromYMD(26, 3, 1)), '0026-03-01');
  assert.equal(toISO(fromYMD(1999, 12, 31)), '1999-12-31');
  assert.equal(toISO(parseISO('2026-03-01')), '2026-03-01');
  assert.notEqual(parseISO('0026-03-01'), parseISO('1926-03-01'));
});

test('duration is clamped to 0..10000 working days', () => {
  const t = task({ start: '2026-10-05', duration: 3 });
  const r = applyDateEdit(t, 'duration', 1e15);
  assert.equal(r.duration, MAX_DURATION);
  assert.ok(isISODate(r.finish), r.finish);
  assert.equal(applyDateEdit(t, 'duration', -5).duration, 0);

  const t2 = task({ start: '2026-10-05', duration: 3 });
  assert.equal(setTaskField(t2, 'duration', '1000000000000000'), null);
  assert.equal(t2.duration, MAX_DURATION);
  assert.ok(isISODate(t2.finish), t2.finish);
});

test('normalizePlan clamps absurd durations and lags', () => {
  const p = normalizePlan({
    start: '2026-10-05',
    rows: [
      { id: 1, name: 'a', start: '2026-10-05', duration: 1e15 },
      { id: 2, name: 'b', start: '2026-10-05', finish: '2200-12-31' },
      { id: 3, name: 'c', start: '2026-10-05', duration: 1, preds: [{ id: 1, type: 'FS', lag: 1e15 }, { id: 2, type: 'SS', lag: -1e15 }] },
    ],
  });
  const [a, b, c] = p.rows;
  assert.equal(a.duration, MAX_DURATION);
  assert.ok(isISODate(a.finish), a.finish);
  assert.equal(b.duration, MAX_DURATION);
  assert.ok(isISODate(b.finish), b.finish);
  assert.deepEqual(c.preds.map((l) => l.lag), [MAX_LAG, -MAX_LAG]);
});

test('lag is clamped to -10000..10000 in parsing and addLink', () => {
  assert.equal(parseLinkToken('3FS+1000000000000000d').lag, MAX_LAG);
  assert.equal(parseLinkToken('3SS-99999999d').lag, -MAX_LAG);
  assert.equal(parseLinkToken('3FS+5000w').lag, MAX_LAG);
  assert.equal(parseLinkToken('3FF+2d').lag, 2);
  const rows = [task({ id: 1 }), task({ id: 2 })];
  assert.equal(addLink(rows, 1, 2, 'FS', 1e15), null);
  assert.equal(rows[1].preds[0].lag, MAX_LAG);
  assert.equal(addLink(rows, 1, 2, 'FS', -1e15), null);
  assert.equal(rows[1].preds[0].lag, -MAX_LAG);
});

test('paste dates outside 1900..2200 are rejected', () => {
  assert.equal(parseDate('1850-01-01'), null);
  assert.equal(parseDate('3/1/2201'), null);
  assert.equal(parseDate('2026-03-01'), '2026-03-01');
  assert.equal(parseDate('3/1/26'), '2026-03-01');
});
