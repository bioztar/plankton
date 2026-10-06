import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBoot, embedPayload, extractPayload } from '../src/io/standalone.js';

const plan = (updatedAt, id = 'p1') => ({ id, name: 'P', rows: [], updatedAt });
const FILE = plan('2026-10-01T10:00:00.000Z');

test('resolveBoot: no embedded plan -> null', () => {
  assert.equal(resolveBoot(null, null), null);
  assert.equal(resolveBoot({ app: 'planboard' }, null), null);
});

test('resolveBoot: file plan opens read-only presenter by default', () => {
  const r = resolveBoot({ plan: FILE }, null);
  assert.equal(r.source, 'file');
  assert.equal(r.plan, FILE);
  assert.equal(r.readOnly, true);
  assert.equal(r.presenter, true);
});

test('resolveBoot: honours readOnly:false / presenter:false', () => {
  const r = resolveBoot({ plan: FILE, readOnly: false, presenter: false }, null);
  assert.deepEqual([r.source, r.readOnly, r.presenter], ['file', false, false]);
  const r2 = resolveBoot({ plan: FILE, readOnly: true, presenter: false }, null);
  assert.deepEqual([r2.readOnly, r2.presenter], [true, false]);
});

test('resolveBoot: newer saved edits of the same plan win and open editable', () => {
  const saved = plan('2026-10-02T09:00:00.000Z');
  const r = resolveBoot({ plan: FILE, readOnly: true, presenter: true }, saved);
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
