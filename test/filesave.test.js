import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSaveState, saveReducer, hasUnsaved, saveStatusText, pageKey, handleKey, suggestedFileName, createHandleRegistry, diskConflict, createFileSaver } from '../src/io/filesave.js';
import { buildPayload, embedPayload } from '../src/io/standalone.js';

const run = (s, ...types) => types.reduce((st, t) => saveReducer(st, typeof t === 'string' ? { type: t } : t), s);
const TPL = '<html><script type="application/json" id="pb-data">null</script></html>';
const fileHtml = (plan, at) => embedPayload(TPL, buildPayload(plan, { at }));
const PLAN = { id: 'p1', name: 'Plan', rows: [], updatedAt: '2026-10-01T00:00:00.000Z' };

test('save state: clean -> dirty -> saving -> saved', () => {
  let s = initialSaveState();
  assert.equal(s.status, 'clean');
  assert.equal(hasUnsaved(s), false);
  s = run(s, 'edit');
  assert.deepEqual([s.status, hasUnsaved(s)], ['dirty', true]);
  s = run(s, 'start');
  assert.deepEqual([s.status, hasUnsaved(s)], ['saving', true]);
  s = run(s, { type: 'success', at: 1, target: 'file' });
  assert.deepEqual([s.status, hasUnsaved(s), s.savedAt, s.target], ['saved', false, 1, 'file']);
  assert.equal(saveStatusText(s, () => '14:32'), 'Saved to file 14:32');
  s = run(s, 'edit');
  assert.equal(saveStatusText(s), 'Unsaved changes');
});

test('save state: edits during a save stay dirty; failure and cancel keep edits unsaved', () => {
  let s = run(initialSaveState(), 'edit', 'start', 'edit');
  assert.equal(s.status, 'saving');
  s = run(s, { type: 'success', at: 2 });
  assert.deepEqual([s.status, hasUnsaved(s)], ['dirty', true]);
  s = run(s, 'start', { type: 'fail', error: 'disk full' });
  assert.deepEqual([s.status, hasUnsaved(s), s.error], ['failed', true, 'disk full']);
  assert.equal(saveStatusText(s), 'Save failed');
  s = run(s, 'start', 'cancel');
  assert.equal(s.status, 'dirty');
  assert.equal(run(initialSaveState(), 'start', 'cancel').status, 'clean');
  assert.equal(run(initialSaveState(), 'edit', 'start', { type: 'success', at: 3 }, 'start', 'cancel').status, 'saved');
});

test('save state: starts dirty when the shown plan is newer than the file; reset and download target', () => {
  const s = initialSaveState(true);
  assert.deepEqual([s.status, hasUnsaved(s)], ['dirty', true]);
  assert.equal(run(s, { type: 'reset' }).status, 'clean');
  const d = run(s, 'start', { type: 'success', at: 0, target: 'download' });
  assert.equal(saveStatusText(d, () => '09:05'), 'Downloaded 09:05');
  assert.equal(saveStatusText(initialSaveState()), 'No unsaved changes');
});

test('handle keying: per plan id and opened file, ignoring query and hash', () => {
  assert.equal(pageKey('file:///C:/OneDrive/plan.html?x=1#top'), 'file:///C:/OneDrive/plan.html');
  assert.equal(handleKey('p1', 'file:///a/plan.html#x'), handleKey('p1', 'file:///a/plan.html'));
  assert.notEqual(handleKey('p1', 'file:///a/plan.html'), handleKey('p2', 'file:///a/plan.html'));
  assert.notEqual(handleKey('p1', 'file:///a/plan.html'), handleKey('p1', 'file:///b/plan.html'));
});

test('suggestedFileName: the opened file name, else the fallback', () => {
  assert.equal(suggestedFileName('file:///C:/Users/me/OneDrive/Q4%20plan.html', 'x.html'), 'Q4 plan.html');
  assert.equal(suggestedFileName('https://host/dir/planboard.htm?a#b', 'x.html'), 'planboard.htm');
  assert.equal(suggestedFileName('https://host/dir/', 'x.html'), 'x.html');
  assert.equal(suggestedFileName('about:blank', 'x.html'), 'x.html');
  assert.equal(suggestedFileName('not a url', 'x.html'), 'x.html');
});

function memKV() {
  const m = new Map();
  return { m, get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), del: async (k) => void m.delete(k) };
}

test('handle registry: put/get/forget by plan + page; failures never throw', async () => {
  const kv = memKV();
  const reg = createHandleRegistry(kv);
  const h = { name: 'plan.html' };
  assert.equal(await reg.get('p1', 'file:///a/plan.html'), null);
  assert.equal(await reg.put('p1', 'file:///a/plan.html', h, 'S1'), true);
  const r = await reg.get('p1', 'file:///a/plan.html#frag');
  assert.equal(r.handle, h);
  assert.deepEqual([r.planId, r.name, r.stamp, r.page], ['p1', 'plan.html', 'S1', 'file:///a/plan.html']);
  assert.equal(await reg.get('p2', 'file:///a/plan.html'), null);
  assert.equal(await reg.get('p1', 'file:///b/plan.html'), null);
  await reg.forget('p1', 'file:///a/plan.html');
  assert.equal(await reg.get('p1', 'file:///a/plan.html'), null);
  const broken = createHandleRegistry({ get: async () => { throw new Error('x'); }, set: async () => { throw new Error('x'); }, del: async () => { throw new Error('x'); } });
  assert.equal(await broken.get('p1', 'u'), null);
  assert.equal(await broken.put('p1', 'u', h, 'S'), false);
  await broken.forget('p1', 'u');
  const hung = createHandleRegistry({ get: () => new Promise(() => {}), set: () => new Promise(() => {}), del: () => new Promise(() => {}) }, 20);
  assert.equal(await hung.get('p1', 'u'), null);
  assert.equal(await hung.put('p1', 'u', h, 'S'), false);
});

test('diskConflict: safe for empty or known versions, flags foreign or changed files', () => {
  const known = new Set(['S1']);
  assert.equal(diskConflict('', 'p1', known), null);
  assert.equal(diskConflict(fileHtml(PLAN, 'S1'), 'p1', known), null);
  assert.deepEqual(diskConflict(fileHtml(PLAN, 'S2'), 'p1', known), { kind: 'changed', name: 'Plan', stamp: 'S2' });
  assert.deepEqual(diskConflict(fileHtml({ ...PLAN, id: 'other', name: 'Other' }, 'S1'), 'p1', known), { kind: 'other', name: 'Other' });
  assert.deepEqual(diskConflict('<html>hello</html>', 'p1', known), { kind: 'other', name: '' });
});

// Fake File System Access handle backed by a string.
function fakeHandle(name, content = '', perm = 'granted', opts = {}) {
  const h = {
    name,
    content,
    writes: 0,
    perm,
    async queryPermission() {
      return h.perm === 'ask' ? 'prompt' : h.perm;
    },
    async requestPermission() {
      return h.grantOnRequest ? (h.perm = 'granted') : 'denied';
    },
    async getFile() {
      if (opts.missing) throw Object.assign(new Error('gone'), { name: 'NotFoundError' });
      return { text: async () => h.content };
    },
    async createWritable() {
      if (opts.writeError) throw Object.assign(new Error(opts.writeError), { name: 'InvalidStateError' });
      let buf = '';
      return { write: async (d) => void (buf += d), close: async () => { h.content = buf; h.writes++; } };
    },
  };
  return h;
}

function setup({ picker, confirm = async () => 'overwrite', kv = memKV(), href = 'file:///a/plan.html' } = {}) {
  const downloads = [];
  const calls = { picker: 0, confirm: [] };
  const saver = createFileSaver({
    showSaveFilePicker: picker === null ? null : async (o) => {
      calls.picker++;
      calls.pickerOpts = o;
      return picker(o);
    },
    registry: createHandleRegistry(kv),
    href,
    download: (n, t) => downloads.push([n, t]),
    confirm: async (c) => {
      calls.confirm.push(c);
      return confirm(c);
    },
  });
  return { saver, downloads, calls, kv };
}
const req = (stamp, extra = {}) => ({ planId: 'p1', html: fileHtml(PLAN, stamp), stamp, suggestedName: 'plan.html', downloadName: 'Plan.html', ...extra });

test('saver: no File System Access API -> downloads <plan-name>.html', async () => {
  const { saver, downloads } = setup({ picker: null });
  assert.equal(saver.supported, false);
  saver.bind('p1', null);
  const r = await saver.save(req('S1'));
  assert.deepEqual([r.status, r.reason], ['downloaded', 'unsupported']);
  assert.equal(downloads[0][0], 'Plan.html');
});

test('saver: first Save asks once with the current file name, later Saves overwrite the same handle', async () => {
  const h = fakeHandle('plan.html');
  const { saver, calls, kv } = setup({ picker: async () => h });
  await saver.bind('p1', null);
  assert.equal((await saver.save(req('S1'))).status, 'saved');
  assert.equal(calls.picker, 1);
  assert.equal(calls.pickerOpts.suggestedName, 'plan.html');
  assert.equal((await saver.save(req('S2'))).status, 'saved');
  assert.equal(calls.picker, 1, 'second Save reuses the handle');
  assert.equal(h.writes, 2);
  assert.match(h.content, /"savedAt":"S2"/);
  assert.equal(calls.confirm.length, 0, 'own previous write is not a conflict');
  assert.equal([...kv.m.values()][0].stamp, 'S2');
  assert.equal(saver.fileName, 'plan.html');
});

test('saver: Save as always asks; user cancelling the picker changes nothing', async () => {
  const h1 = fakeHandle('a.html');
  const h2 = fakeHandle('b.html');
  let next = h1;
  const { saver, calls, downloads } = setup({ picker: async () => next });
  await saver.bind('p1', null);
  await saver.save(req('S1'));
  next = h2;
  assert.equal((await saver.save(req('S2', { saveAs: true }))).name, 'b.html');
  assert.equal(calls.picker, 2);
  assert.equal((await saver.save(req('S3'))).name, 'b.html', 'Save goes to the Save-as target');
  next = null;
  const abort = setup({ picker: async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }); } });
  await abort.saver.bind('p1', null);
  assert.equal((await abort.saver.save(req('S1'))).status, 'cancelled');
  assert.equal(abort.downloads.length + downloads.length, 0);
});

test('saver: remembered handle survives reload; permission prompt granted or denied', async () => {
  const kv = memKV();
  const h = fakeHandle('plan.html');
  const first = setup({ picker: async () => h, kv });
  await first.saver.bind('p1', null);
  await first.saver.save(req('S1'));

  h.perm = 'ask';
  h.grantOnRequest = true;
  const reload = setup({ picker: async () => assert.fail('no picker after reload'), kv });
  await reload.saver.bind('p1', 'S1');
  assert.equal((await reload.saver.save(req('S2'))).status, 'saved');
  assert.equal(h.writes, 2);

  h.perm = 'ask';
  h.grantOnRequest = false;
  const denied = setup({ picker: async () => assert.fail('no picker'), kv });
  await denied.saver.bind('p1', 'S2');
  const r = await denied.saver.save(req('S3'));
  assert.deepEqual([r.status, r.reason], ['downloaded', 'denied']);
  assert.equal(h.writes, 2);
  assert.equal(denied.downloads.length, 1);

  const otherPage = setup({ picker: async () => fakeHandle('new.html'), kv, href: 'file:///elsewhere/plan.html' });
  await otherPage.saver.bind('p1', null);
  await otherPage.saver.save(req('S4'));
  assert.equal(otherPage.calls.picker, 1, 'another copy of the file does not reuse the handle');
});

test('saver: file changed on disk by someone else -> confirm overwrite / save as / cancel', async () => {
  const kv = memKV();
  const h = fakeHandle('plan.html');
  const a = setup({ picker: async () => h, kv });
  await a.saver.bind('p1', null);
  await a.saver.save(req('S1'));
  h.content = fileHtml(PLAN, 'COLLEAGUE');

  let choice = 'cancel';
  const b = setup({ picker: async () => fakeHandle('copy.html'), kv, confirm: async () => choice });
  await b.saver.bind('p1', 'S1');
  assert.equal((await b.saver.save(req('S2'))).status, 'cancelled');
  assert.deepEqual(b.calls.confirm[0], { kind: 'changed', name: 'Plan', stamp: 'COLLEAGUE', fileName: 'plan.html' });
  assert.match(h.content, /COLLEAGUE/);
  choice = 'saveas';
  assert.equal((await b.saver.save(req('S3'))).name, 'copy.html');
  assert.match(h.content, /COLLEAGUE/);

  const c = setup({ picker: async () => assert.fail('no picker'), kv: memKV(), confirm: async () => 'overwrite' });
  await c.kv.set('p1@file:///a/plan.html', { handle: h, stamp: 'S1' });
  await c.saver.bind('p1', 'S1');
  assert.equal((await c.saver.save(req('S5'))).status, 'saved');
  assert.match(h.content, /S5/);
});

test('saver: missing file falls back to the picker; write errors fail without losing the handle', async () => {
  const kv = memKV();
  const gone = fakeHandle('plan.html', '', 'granted', { missing: true });
  await kv.set('p1@file:///a/plan.html', { handle: gone, stamp: 'S1' });
  const fresh = fakeHandle('plan.html');
  const s = setup({ picker: async () => fresh, kv });
  await s.saver.bind('p1', null);
  assert.equal((await s.saver.save(req('S2'))).status, 'saved');
  assert.equal(s.calls.picker, 1);
  assert.equal(fresh.writes, 1);

  const bad = fakeHandle('plan.html', '', 'granted', { writeError: 'disk full' });
  const f = setup({ picker: async () => bad });
  await f.saver.bind('p1', null);
  const r = await f.saver.save(req('S1'));
  assert.deepEqual([r.status, r.error], ['failed', 'disk full']);
});

test('saver: picker blocked (e.g. SecurityError in a sandbox) -> download', async () => {
  const s = setup({ picker: async () => { throw Object.assign(new Error('no'), { name: 'SecurityError' }); } });
  await s.saver.bind('p1', null);
  const r = await s.saver.save(req('S1'));
  assert.deepEqual([r.status, r.reason], ['downloaded', 'picker']);
});
