import './minidom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, cleanSVG, brandAssets } from '../build.mjs';
import { extractPayload, embedPayload, buildPayload, resolveBoot, payloadStamp } from '../src/io/standalone.js';
import { normalizePlan, serializePlan, parsePlanJSON } from '../src/model/plan.js';
import { normHistory, decodeSnapshot, makeVersion, appendVersion } from '../src/io/versions.js';
import { createStorage, memoryStore, migrateLegacyStorage, LEGACY_PREFIX } from '../src/io/storage.js';
import { withLegacyKV } from '../src/io/idb.js';
import { createHandleRegistry, diskConflict } from '../src/io/filesave.js';

// Saved by planboard 1.4.0 (commit 96f624b): sample plan, two versions, gzip snapshots.
// The bundled 1.4 CSS/JS were stripped from the fixture; head, data block and markup are verbatim.
const FILE_14 = readFileSync(new URL('./fixtures/planboard-1.4-saved.html', import.meta.url), 'utf8');
const plain = (p) => JSON.parse(serializePlan(p, false));

// ---- planboard 1.4 files ---------------------------------------------------

test('1.4 file: payload is read from the pb-data block and opens editable', () => {
  const payload = extractPayload(FILE_14);
  assert.equal(payload.app, 'planboard');
  const plan = normalizePlan(payload.plan);
  const r = resolveBoot({ ...payload, plan }, null);
  assert.deepEqual([r.source, r.readOnly, r.presenter], ['file', false, false]);
  assert.equal(plan.id, 'pb14fixture');
  assert.equal(plan.name, 'Planboard 1.4 saved plan');
  assert.ok(plan.rows.length > 20);
  assert.equal(plan.rows.find((x) => x.name === 'Kick-off meeting').status, 'Done');
  assert.equal(payloadStamp(payload), '2026-10-07T10:30:00.000Z');
});

test('1.4 file: version history and its gzip snapshots load', async () => {
  const hist = normHistory(extractPayload(FILE_14).history);
  assert.deepEqual(hist.map((v) => [v.n, v.author]), [[1, 'Ana'], [2, 'Ana']]);
  const snap = await decodeSnapshot(hist[1].snapshot);
  assert.equal(snap.id, 'pb14fixture');
  assert.equal(snap.rows.find((x) => x.name === 'Kick-off meeting').progress, 100);
});

test('1.4 file: saving in PLANkton keeps the plan and every version, now marked plankton', async () => {
  const payload = extractPayload(FILE_14);
  const plan = plain(normalizePlan(payload.plan));
  let hist = normHistory(payload.history);
  plan.name = 'Renamed in PLANkton';
  hist = appendVersion(hist, await makeVersion(hist, plan, plain(normalizePlan(payload.plan)), { author: 'Ben', at: '2026-10-09T09:00:00.000Z' }));
  const saved = embedPayload(build(), buildPayload(plan, { at: '2026-10-09T09:00:00.000Z', history: hist }));
  const back = extractPayload(saved);
  assert.equal(back.app, 'plankton');
  assert.equal(back.plan.app, 'plankton');
  assert.equal(back.plan.id, 'pb14fixture');
  assert.equal(back.plan.name, 'Renamed in PLANkton');
  assert.deepEqual(back.plan.rows, plan.rows);
  assert.deepEqual(back.history.map((v) => v.n), [1, 2, 3]);
  assert.match(back.history[2].changes.join(' '), /Renamed in PLANkton/);
  // the 1.4 file itself can be written over too (Save to a connected old file)
  assert.equal(extractPayload(embedPayload(FILE_14, back)).plan.name, 'Renamed in PLANkton');
});

test('1.4 file: connecting Save to it is not a conflict when its stamp is known', () => {
  const stamp = payloadStamp(extractPayload(FILE_14));
  assert.equal(diskConflict(FILE_14, 'pb14fixture', new Set([stamp])), null);
  assert.equal(diskConflict(FILE_14, 'pb14fixture', new Set()).kind, 'changed');
});

test('1.x JSON exports (app: planboard) still import', () => {
  const plan = { app: 'planboard', schema: 1, id: 'old1', name: 'Old', rows: [] };
  assert.equal(parsePlanJSON(JSON.stringify(plan)).id, 'old1');
  assert.equal(parsePlanJSON(JSON.stringify({ app: 'planboard', plan })).name, 'Old');
});

// ---- localStorage migration ------------------------------------------------

function legacyStore() {
  const s = memoryStore();
  const plan = normalizePlan(extractPayload(FILE_14).plan);
  s.setItem('planboard:plan:pb14fixture', serializePlan(plan, false));
  s.setItem('planboard:index', JSON.stringify({ current: 'pb14fixture', plans: [{ id: 'pb14fixture', name: plan.name, updatedAt: plan.updatedAt }] }));
  s.setItem('planboard:prefs', JSON.stringify({ theme: 'dark', author: 'Ana', hintDismissed: true, cardWidth: 640 }));
  s.setItem('other-app:key', 'x');
  return s;
}

test('storage: planboard:* keys are migrated to plankton:* when PLANkton has none', () => {
  const s = legacyStore();
  const st = createStorage(s);
  assert.equal(st.index().current, 'pb14fixture');
  assert.equal(st.load('pb14fixture').name, 'Planboard 1.4 saved plan');
  assert.deepEqual(st.prefs(), { theme: 'dark', author: 'Ana', hintDismissed: true, cardWidth: 640 });
  assert.ok(s.getItem('plankton:index') && s.getItem('plankton:plan:pb14fixture') && s.getItem('plankton:prefs'));
  // old keys stay for planboard 1.x files still in use; unrelated keys untouched
  assert.ok(s.getItem('planboard:index') && s.getItem('planboard:plan:pb14fixture'));
  assert.equal(s.getItem('plankton:key'), null);
});

test('storage: migration runs once and never overwrites PLANkton data', () => {
  const s = legacyStore();
  const st = createStorage(s);
  st.setPrefs({ theme: 'light' });
  s.setItem('planboard:prefs', JSON.stringify({ theme: 'auto', author: 'Old' }));
  assert.equal(migrateLegacyStorage(s), 0);
  assert.equal(createStorage(s).prefs().theme, 'light');
  assert.equal(createStorage(s).prefs().author, 'Ana');
});

test('storage: fresh browser (no legacy keys) migrates nothing', () => {
  const s = memoryStore();
  assert.equal(migrateLegacyStorage(s), 0);
  assert.deepEqual(createStorage(s).index(), { current: null, plans: [] });
});

test('storage: store without key()/length migrates via the legacy index', () => {
  const m = legacyStore();
  const s = { getItem: m.getItem, setItem: m.setItem, removeItem: m.removeItem };
  assert.equal(migrateLegacyStorage(s), 3);
  assert.equal(createStorage(s).load('pb14fixture').id, 'pb14fixture');
});

test('storage: when full, a key is moved instead of copied; nothing is lost', () => {
  const m = legacyStore();
  const used = () => [...Array(m.length).keys()].reduce((n, i) => n + m.key(i).length + m.getItem(m.key(i)).length, 0);
  const limit = used() + 2000; // room for the small keys, not for a second copy of the plan
  const s = {
    ...m,
    key: m.key,
    get length() {
      return m.length;
    },
    setItem(k, v) {
      const before = m.getItem(k);
      m.setItem(k, v);
      if (used() > limit) {
        if (before == null) m.removeItem(k);
        else m.setItem(k, before);
        throw new Error('QuotaExceededError');
      }
    },
  };
  createStorage(s);
  assert.equal(m.getItem('planboard:plan:pb14fixture'), null);
  assert.equal(createStorage(s).load('pb14fixture').name, 'Planboard 1.4 saved plan');
  assert.ok(m.getItem('planboard:index'), 'small keys are copied');
  assert.equal(createStorage(s).prefs().author, 'Ana');
});

test('storage: interrupted migration (no new index yet) is completed on the next load', () => {
  const s = legacyStore();
  s.setItem('plankton:prefs', JSON.stringify({ theme: 'light' }));
  const st = createStorage(s);
  assert.equal(st.prefs().theme, 'light');
  assert.equal(st.index().current, 'pb14fixture');
  assert.ok(LEGACY_PREFIX === 'planboard:');
});

// ---- IndexedDB file handles ------------------------------------------------

function mapKV(fail = false) {
  const m = new Map();
  const guard = () => (fail ? Promise.reject(new Error('blocked')) : null);
  return {
    m,
    get: (k) => guard() || Promise.resolve(m.get(k)),
    set: (k, v) => guard() || Promise.resolve(void m.set(k, v)),
    del: (k) => guard() || Promise.resolve(void m.delete(k)),
  };
}

test('handles: a Save file handle remembered by planboard 1.x is found and copied over', async () => {
  const oldKV = mapKV();
  const newKV = mapKV();
  const handle = { name: 'Q4 plan.html', kind: 'file' };
  await createHandleRegistry(oldKV).put('p1', 'file:///C:/plans/Q4%20plan.html', handle, 'stamp1');
  const reg = createHandleRegistry(withLegacyKV(newKV, oldKV));
  const rec = await reg.get('p1', 'file:///C:/plans/Q4%20plan.html');
  assert.equal(rec.handle, handle);
  assert.equal(rec.stamp, 'stamp1');
  assert.equal(newKV.m.size, 1, 'copied into the PLANkton database');
  await reg.forget('p1', 'file:///C:/plans/Q4%20plan.html');
  assert.equal(await reg.get('p1', 'file:///C:/plans/Q4%20plan.html'), null, 'forgotten handles do not come back from the old database');
  assert.equal(oldKV.m.size, 0);
});

test('handles: new database wins; a missing or broken legacy database is ignored', async () => {
  const newKV = mapKV();
  await newKV.set('k', 'new');
  const oldKV = mapKV();
  await oldKV.set('k', 'old');
  assert.equal(await withLegacyKV(newKV, oldKV).get('k'), 'new');
  const kv = withLegacyKV(mapKV(), mapKV(true));
  assert.equal(await kv.get('x'), undefined);
  await kv.set('x', 1);
  assert.equal(await kv.get('x'), 1);
  await kv.del('x');
  assert.equal(await kv.get('x'), undefined);
});

// ---- build: name and brand slots --------------------------------------------

test('build: PLANkton title, generator, favicon and header mark from docs/brand/', () => {
  const html = build();
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.match(html, /<title>PLANkton<\/title>/);
  assert.match(html, new RegExp(`<meta name="generator" content="PLANkton ${version.replace(/\./g, '\\.')}">`));
  const brand = brandAssets();
  assert.ok(html.includes(`<link rel="icon" type="image/svg+xml" href="${brand.favicon}">`));
  assert.ok(brand.favicon.startsWith('data:image/svg+xml,%3Csvg'));
  assert.ok(html.includes(`<template id="brand-mark">${brand.mark}</template>`));
  assert.ok(html.includes('id="pb-data">null</script>'), 'data block id unchanged for 1.x compatibility');
  assert.doesNotMatch(html, /Planboard/);
  assert.equal(extractPayload(html), null);
});

test('build: brand SVGs are cleaned and must be plain artwork', () => {
  assert.equal(cleanSVG('<?xml version="1.0"?>\n<!DOCTYPE svg>\n<!-- art -->\n<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>\n'), '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>');
  assert.throws(() => cleanSVG('<svg><script>alert(1)</script></svg>'));
  assert.throws(() => cleanSVG('<svg onload="x()"></svg>'));
  assert.throws(() => cleanSVG('<svg><image href="https://example.com/a.png"/></svg>'));
  assert.throws(() => cleanSVG('<p>no</p>'));
  assert.equal(cleanSVG('<svg><use href="#a"/></svg>'), '<svg><use href="#a"/></svg>');
  for (const f of ['plankton-logo.svg', 'plankton-mark.svg', 'favicon.svg']) cleanSVG(readFileSync(new URL(`../docs/brand/${f}`, import.meta.url), 'utf8'));
});
