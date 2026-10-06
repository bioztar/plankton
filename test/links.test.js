import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinkToken, parseLinkList, formatLink, earliestStart } from '../src/schedule/links.js';
import { toISO } from '../src/schedule/calendar.js';
import { d } from './helpers.js';

test('parses link text', () => {
  assert.deepEqual(parseLinkToken('4'), { ref: '4', type: 'FS', lag: 0 });
  assert.deepEqual(parseLinkToken('1.2FS+2d'), { ref: '1.2', type: 'FS', lag: 2 });
  assert.deepEqual(parseLinkToken('7SS-1d'), { ref: '7', type: 'SS', lag: -1 });
  assert.deepEqual(parseLinkToken('#7ss-1'), { ref: '#7', type: 'SS', lag: -1 });
  assert.deepEqual(parseLinkToken('3 FF + 1w'), { ref: '3', type: 'FF', lag: 5 });
  assert.deepEqual(parseLinkToken('2SF'), { ref: '2', type: 'SF', lag: 0 });
  assert.equal(parseLinkToken('abc'), null);
  assert.equal(parseLinkToken('4XX'), null);
  const { items, errors } = parseLinkList('1, 2SS+1d; nope');
  assert.equal(items.length, 2);
  assert.equal(errors.length, 1);
  assert.equal(formatLink(4, 'FS', 0), '4');
  assert.equal(formatLink(4, 'FS', 2), '4FS+2d');
  assert.equal(formatLink('1.2', 'SS', -1), '1.2SS-1d');
});

// predecessor Mon 2026-10-05 .. Fri 2026-10-09; successor is 3 days long
const pred = { start: d('2026-10-05'), finish: d('2026-10-09') };
const succ = { duration: 3, milestone: false };
const es = (type, lag) => toISO(earliestStart(pred, succ, { type, lag }));

test('FS with positive / negative lag', () => {
  assert.equal(es('FS', 0), '2026-10-12');
  assert.equal(es('FS', 2), '2026-10-14');
  assert.equal(es('FS', -1), '2026-10-09');
  assert.equal(es('FS', -3), '2026-10-07');
});

test('SS with positive / negative lag', () => {
  assert.equal(es('SS', 0), '2026-10-05');
  assert.equal(es('SS', 2), '2026-10-07');
  assert.equal(es('SS', 5), '2026-10-12');
  assert.equal(es('SS', -1), '2026-10-02');
});

test('FF with positive / negative lag (successor finish ≥ predecessor finish + lag)', () => {
  assert.equal(es('FF', 0), '2026-10-07'); // finishes Fri 10-09
  assert.equal(es('FF', 2), '2026-10-09'); // finishes Tue 10-13
  assert.equal(es('FF', -1), '2026-10-06'); // finishes Thu 10-08
});

test('SF with positive / negative lag (successor finish ≥ predecessor start + lag)', () => {
  assert.equal(es('SF', 0), '2026-09-30'); // finishes Fri 10-02, the day before pred starts
  assert.equal(es('SF', 2), '2026-10-02'); // finishes Tue 10-06
  assert.equal(es('SF', -1), '2026-09-29'); // finishes Thu 10-01
});

test('milestone successor of FS sits on the predecessor finish day', () => {
  assert.equal(toISO(earliestStart(pred, { duration: 0, milestone: true }, { type: 'FS', lag: 0 })), '2026-10-09');
});
