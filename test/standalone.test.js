import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBoot, embedPayload, extractPayload, buildPayload, isPresenterCopy, payloadStamp } from '../src/io/standalone.js';

const plan = (updatedAt, id = 'p1') => ({ id, name: 'P', rows: [], updatedAt });
const FILE = plan('2026-10-01T10:00:00.000Z');

test('resolveBoot: no embedded plan -> null', () => {
  assert.equal(resolveBoot(null, null), null);
  assert.equal(resolveBoot({ app: 'planboard' }, null), null);
});

test('resolveBoot: embedded copies open editable, including v1 standalone copies (readOnly:true, no mode)', () => {
  for (const payload of [{ plan: FILE }, { plan: FILE, readOnly: false, presenter: false }, { app: 'planboard', readOnly: true, presenter: true, exportedAt: 'x', plan: FILE }, { plan: FILE, mode: 'edit', readOnly: true }]) {
    const r = resolveBoot(payload, null);
    assert.deepEqual([r.source, r.plan, r.readOnly, r.presenter], ['file', FILE, false, false], JSON.stringify(payload));
  }
});

test('resolveBoot: only an explicit presenter copy opens read-only; readOnly:false always wins', () => {
  const r = resolveBoot({ plan: FILE, mode: 'presenter', readOnly: true, presenter: true }, null);
  assert.deepEqual([r.readOnly, r.presenter], [true, true]);
  const r2 = resolveBoot({ plan: FILE, mode: 'presenter', readOnly: true, presenter: false }, null);
  assert.deepEqual([r2.readOnly, r2.presenter], [true, false]);
  const r3 = resolveBoot({ plan: FILE, mode: 'presenter', readOnly: false, presenter: true }, null);
  assert.deepEqual([r3.readOnly, r3.presenter], [false, false]);
});

test('resolveBoot: newer saved edits of the same plan win and open editable', () => {
  const saved = plan('2026-10-02T09:00:00.000Z');
  const r = resolveBoot({ plan: FILE, mode: 'presenter', readOnly: true, presenter: true }, saved);
  assert.equal(r.source, 'saved');
  assert.equal(r.plan, saved);
  assert.deepEqual([r.readOnly, r.presenter], [false, false]);
  assert.equal(r.file.plan, FILE);
  assert.deepEqual([r.file.readOnly, r.file.presenter], [true, true]);
});

test('resolveBoot: older, equal or other-id saved plans do not win', () => {
  for (const saved of [plan('2026-09-30T00:00:00.000Z'), plan(FILE.updatedAt), plan('2027-01-01T00:00:00.000Z', 'other'), plan('garbage')]) {
    const r = resolveBoot({ plan: FILE, readOnly: false, presenter: false }, saved);
    assert.equal(r.source, 'file');
    assert.equal(r.plan, FILE);
  }
});

test('embedPayload / extractPayload round-trip, escaping </script>', () => {
  const html = '<html><script type="application/json" id="pb-data">null</script></html>';
  const payload = { readOnly: false, presenter: false, plan: { ...FILE, name: '</script><b>x' } };
  const out = embedPayload(html, payload);
  assert.equal((out.match(/<\/script>/g) || []).length, 1);
  assert.deepEqual(extractPayload(out), payload);
});

test('buildPayload: saves are editable, presenter copies are marked read-only', () => {
  const p = { ...FILE, rows: [{ id: 1, name: 'a' }] };
  const e = buildPayload(p, { at: '2026-10-07T08:00:00.000Z' });
  assert.deepEqual([e.mode, e.readOnly, e.presenter, e.savedAt], ['edit', false, false, '2026-10-07T08:00:00.000Z']);
  assert.deepEqual(e.plan, p);
  assert.notEqual(e.plan, p, 'payload holds a copy');
  assert.equal(isPresenterCopy(e), false);
  assert.equal(payloadStamp(e), '2026-10-07T08:00:00.000Z');
  const v = buildPayload(p, { presenter: true, at: 'T' });
  assert.deepEqual([v.mode, v.readOnly, v.presenter, v.exportedAt], ['presenter', true, true, 'T']);
  assert.equal(isPresenterCopy(v), true);
  assert.equal(payloadStamp(v), 'T');
  const r = resolveBoot(extractPayload(embedPayload('<script type="application/json" id="pb-data">null</script>', e)), null);
  assert.deepEqual([r.readOnly, r.presenter, r.file.stamp], [false, false, e.savedAt]);
});
