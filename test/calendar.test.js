import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cal from '../src/schedule/calendar.js';
import { d } from './helpers.js';

// 2026-10-05 is a Monday.
test('ISO parsing is timezone-free and validates', () => {
  for (const iso of ['2026-03-29', '2026-11-01', '2028-02-29', '1999-12-31', '2026-10-05']) {
    assert.equal(cal.toISO(cal.parseISO(iso)), iso);
  }
  assert.equal(cal.isISODate('2026-02-29'), false);
  assert.equal(cal.isISODate('2028-02-29'), true);
  assert.equal(cal.isISODate('2026-13-01'), false);
  assert.equal(cal.isISODate('10/05/2026'), false);
  assert.ok(Number.isNaN(cal.parseISO('nope')));
  assert.equal(cal.parseISO('1970-01-01'), 0);
});

test('todayISO uses the local calendar date', () => {
  assert.equal(cal.todayISO(new Date(2026, 0, 31, 23, 59)), '2026-01-31');
  assert.equal(cal.todayISO(new Date(2026, 0, 1, 0, 1)), '2026-01-01');
});

test('weekday and working-day checks', () => {
  assert.equal(cal.weekday(d('2026-10-05')), 0);
  assert.equal(cal.weekday(d('2026-10-11')), 6);
  assert.equal(cal.isWorkday(d('2026-10-09')), true);
  assert.equal(cal.isWorkday(d('2026-10-10')), false);
  assert.equal(cal.toISO(cal.nextWorkday(d('2026-10-10'))), '2026-10-12');
  assert.equal(cal.toISO(cal.prevWorkday(d('2026-10-11'))), '2026-10-09');
  assert.equal(cal.toISO(cal.mondayOf(d('2026-10-08'))), '2026-10-05');
});

test('adding working days skips weekends', () => {
  const iso = (x) => cal.toISO(x);
  assert.equal(iso(cal.addWorkdays(d('2026-10-09'), 1)), '2026-10-12');
  assert.equal(iso(cal.addWorkdays(d('2026-10-12'), -1)), '2026-10-09');
  assert.equal(iso(cal.addWorkdays(d('2026-10-05'), 10)), '2026-10-19');
  assert.equal(iso(cal.addWorkdays(d('2026-10-10'), 0)), '2026-10-12');
  assert.equal(iso(cal.addWorkdays(d('2026-10-07'), -7)), '2026-09-28');
  assert.equal(cal.addWorkdaysISO('2026-12-31', 1), '2027-01-01');
  assert.equal(cal.addWorkdaysISO('2027-01-01', 1), '2027-01-04');
});

test('working-day counting and differences', () => {
  assert.equal(cal.workdaysInclusive(d('2026-10-05'), d('2026-10-09')), 5);
  assert.equal(cal.workdaysInclusive(d('2026-10-05'), d('2026-10-12')), 6);
  assert.equal(cal.workdaysInclusive(d('2026-10-10'), d('2026-10-11')), 0);
  assert.equal(cal.workdaysInclusive(d('2026-10-09'), d('2026-10-05')), 0);
  assert.equal(cal.workdayDiff(d('2026-10-09'), d('2026-10-12')), 1);
  assert.equal(cal.workdayDiff(d('2026-10-12'), d('2026-10-05')), -5);
});

test('duration <-> dates', () => {
  const iso = (x) => cal.toISO(x);
  assert.equal(iso(cal.finishFromDuration(d('2026-10-05'), 5)), '2026-10-09');
  assert.equal(iso(cal.finishFromDuration(d('2026-10-05'), 6)), '2026-10-12');
  assert.equal(iso(cal.finishFromDuration(d('2026-10-05'), 1)), '2026-10-05');
  assert.equal(iso(cal.finishFromDuration(d('2026-10-05'), 0)), '2026-10-05');
  assert.equal(iso(cal.finishFromDuration(d('2026-10-10'), 2)), '2026-10-13');
  assert.equal(iso(cal.startFromDuration(d('2026-10-13'), 3)), '2026-10-09');
  assert.equal(cal.durationFromDates(d('2026-10-05'), d('2026-10-16')), 10);
  for (let dur = 1; dur <= 30; dur++) {
    const f = cal.finishFromDuration(d('2026-10-07'), dur);
    assert.equal(cal.durationFromDates(d('2026-10-07'), f), dur);
    assert.equal(cal.startFromDuration(f, dur), d('2026-10-07'));
  }
});

test('editing any two of start/finish/duration recomputes the third', () => {
  const t = { start: '2026-10-05', finish: '2026-10-09', duration: 5 };
  assert.deepEqual(cal.applyDateEdit(t, 'duration', 3), { start: '2026-10-05', finish: '2026-10-07', duration: 3 });
  assert.deepEqual(cal.applyDateEdit(t, 'finish', '2026-10-14'), { start: '2026-10-05', finish: '2026-10-14', duration: 8 });
  assert.deepEqual(cal.applyDateEdit(t, 'start', '2026-10-12'), { start: '2026-10-12', finish: '2026-10-16', duration: 5 });
  // start edited while finish is pinned → duration recomputed
  assert.deepEqual(cal.applyDateEdit(t, 'start', '2026-10-07', 'finish'), { start: '2026-10-07', finish: '2026-10-09', duration: 3 });
  // duration edited while finish is pinned → start recomputed
  assert.deepEqual(cal.applyDateEdit(t, 'duration', 2, 'finish'), { start: '2026-10-08', finish: '2026-10-09', duration: 2 });
  // weekend start snaps to Monday
  assert.equal(cal.applyDateEdit(t, 'start', '2026-10-10').start, '2026-10-12');
});
