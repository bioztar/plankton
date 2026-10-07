// Version history embedded in a saved file (payload.history): each Save adds
// { n, savedAt, author, changes, snapshot }. Snapshots are the plan JSON,
// gzip-compressed and base64-encoded where CompressionStream exists. Pure
// apart from the (async) compression.
import { computeTree, isTask } from '../model/tree.js';

export const MAX_VERSIONS = 50;
export const MAX_HISTORY_BYTES = 5 * 1024 * 1024;
const MAX_CHANGES = 14;

// ---- snapshots -------------------------------------------------------------

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export const canCompress = () => typeof globalThis.CompressionStream === 'function' && typeof globalThis.Response === 'function' && typeof globalThis.Blob === 'function';

/** Plan → { enc: 'gzip-base64' | 'json', data }. */
export async function encodeSnapshot(plan, { compress = canCompress() } = {}) {
  const json = JSON.stringify(plan);
  if (compress) {
    try {
      return { enc: 'gzip-base64', data: toBase64(await pipe(new TextEncoder().encode(json), new CompressionStream('gzip'))) };
    } catch (e) {
      /* fall through */
    }
  }
  return { enc: 'json', data: json };
}

/** Snapshot → plan object (untrusted: normalise before use). Throws when unreadable. */
export async function decodeSnapshot(snap) {
  if (!snap || typeof snap.data !== 'string') throw new Error('This version has no snapshot.');
  if (snap.enc === 'json') return JSON.parse(snap.data);
  if (snap.enc === 'gzip-base64') {
    if (typeof globalThis.DecompressionStream !== 'function') throw new Error('This browser cannot read compressed versions.');
    return JSON.parse(new TextDecoder().decode(await pipe(fromBase64(snap.data), new DecompressionStream('gzip'))));
  }
  throw new Error(`Unknown snapshot format “${String(snap.enc).slice(0, 20)}”.`);
}

// ---- the history list ------------------------------------------------------

const str = (v, max) => (v == null ? '' : String(v).slice(0, max));

/** Validate a history list from a file; oldest first. */
export function normHistory(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const v of list) {
    if (!v || typeof v !== 'object' || !Number.isInteger(v.n) || v.n < 1 || !v.snapshot || typeof v.snapshot.data !== 'string') continue;
    out.push({
      n: v.n,
      savedAt: str(v.savedAt, 40),
      author: str(v.author, 80),
      changes: Array.isArray(v.changes) ? v.changes.slice(0, MAX_CHANGES + 1).map((c) => str(c, 300)) : [],
      snapshot: { enc: str(v.snapshot.enc, 20), data: v.snapshot.data },
    });
  }
  return out.sort((a, b) => a.n - b.n || (Date.parse(a.savedAt) || 0) - (Date.parse(b.savedAt) || 0));
}

const utf8Len = (s) => (typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : s.length);
export const historyBytes = (list) => utf8Len(JSON.stringify(list || []));
export const nextVersionNumber = (list) => (list && list.length ? Math.max(...list.map((v) => v.n)) : 0) + 1;

/**
 * Append a version and drop the oldest until at most `maxVersions` remain and
 * the list fits `maxBytes` (the newest version is always kept).
 */
export function appendVersion(list, entry, { maxVersions = MAX_VERSIONS, maxBytes = MAX_HISTORY_BYTES } = {}) {
  const out = [...(list || []), entry];
  while (out.length > maxVersions) out.shift();
  if (out.length > 1) {
    const sizes = out.map((v) => utf8Len(JSON.stringify(v)) + 1);
    let total = sizes.reduce((a, b) => a + b, 1);
    while (out.length > 1 && total > maxBytes) {
      total -= sizes.shift();
      out.shift();
    }
  }
  return out;
}

/** Union of two histories of the same file (e.g. this tab's and the one on disk). */
export function mergeHistories(a, b) {
  const m = new Map();
  for (const v of [...(a || []), ...(b || [])]) m.set(`${v.n}@${v.savedAt}`, v);
  return [...m.values()].sort((x, y) => (Date.parse(x.savedAt) || 0) - (Date.parse(y.savedAt) || 0) || x.n - y.n);
}

/** Build the next version entry for `plan` (prev = the last saved plan or null). */
export async function makeVersion(list, plan, prev, { author = '', at = new Date().toISOString(), compress } = {}) {
  return { n: nextVersionNumber(list), savedAt: at, author: str(author, 80), changes: summarizeChanges(prev, plan), snapshot: await encodeSnapshot(plan, { compress }) };
}

// ---- change summary --------------------------------------------------------

const q = (s) => `“${String(s || '').slice(0, 60) || '(untitled)'}”`;
const show = (v) => (v == null || v === '' ? '–' : String(v));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Short human list of what changed between two plans, e.g. ['“Book steering”: status Not started → Done', '+2 tasks']. */
export function summarizeChanges(prev, next) {
  const tasksOf = (p) => (p.rows || []).filter(isTask);
  if (!prev) return [`First saved version (${plural(tasksOf(next).length, 'task')})`];
  const out = [];
  if (prev.name !== next.name) out.push(`Plan renamed ${q(prev.name)} → ${q(next.name)}`);
  for (const k of ['start', 'owner', 'status', 'statusDate']) if (prev[k] !== next[k]) out.push(`Plan ${k === 'statusDate' ? 'status date' : k} ${show(prev[k])} → ${show(next[k])}`);
  const pt = new Map(tasksOf(prev).map((t) => [t.id, t]));
  const nt = new Map(tasksOf(next).map((t) => [t.id, t]));
  const added = [...nt.values()].filter((t) => !pt.has(t.id));
  const removed = [...pt.values()].filter((t) => !nt.has(t.id));
  const names = (list) => (list.length <= 3 ? `: ${list.map((t) => q(t.name)).join(', ')}` : '');
  if (added.length) out.push(`+${plural(added.length, 'task')}${names(added)}`);
  if (removed.length) out.push(`−${plural(removed.length, 'task')}${names(removed)}`);
  const tree = computeTree(next.rows || []);
  const fields = new Map((next.fields || []).map((f) => [f.id, f]));
  const ROLL = new Set(['start', 'finish', 'duration', 'progress', 'status']);
  let moved = 0;
  for (const t of nt.values()) {
    const o = pt.get(t.id);
    if (!o) continue;
    const sum = tree.isSummary(t.id);
    const d = [];
    if (o.name !== t.name) d.push(`renamed to ${q(t.name)}`);
    for (const [k, label, fmt] of [
      ['status', 'status', show],
      ['start', 'start', show],
      ['finish', 'finish', show],
      ['duration', 'duration', (v) => `${v}d`],
      ['progress', 'progress', (v) => `${v} %`],
      ['owner', 'owner', show],
      ['priority', 'priority', show],
      ['workstream', 'workstream', show],
    ]) {
      if (sum && ROLL.has(k)) continue;
      if (o[k] !== t[k]) d.push(`${label} ${fmt(o[k])} → ${fmt(t[k])}`);
    }
    if (!!o.milestone !== !!t.milestone && !sum) d.push(t.milestone ? 'now a milestone' : 'no longer a milestone');
    if (!same(o.preds, t.preds)) d.push('predecessors changed');
    if ((o.descHtml || '') !== (t.descHtml || '')) d.push('description edited');
    if ((o.notes || '') !== (t.notes || '')) d.push('notes edited');
    if (!same(o.tags, t.tags)) d.push('tags changed');
    if (!same(o.custom, t.custom)) d.push('custom fields changed');
    const keys = new Set([...Object.keys(o.values || {}), ...Object.keys(t.values || {})]);
    for (const k of keys) {
      const a = (o.values || {})[k];
      const b = (t.values || {})[k];
      if (a !== b && fields.has(k)) d.push(`${fields.get(k).name} ${show(a)} → ${show(b)}`);
    }
    if (o.level !== t.level) moved++;
    if (d.length) out.push(`${q(o.name)}: ${d.join(', ')}`);
  }
  const ps = (prev.rows || []).filter((r) => !isTask(r));
  const ns = new Map((next.rows || []).filter((r) => !isTask(r)).map((r) => [r.id, r]));
  const psIds = new Set(ps.map((r) => r.id));
  for (const s of ns.values()) if (!psIds.has(s.id)) out.push(`+ section ${q(s.name)}`);
  for (const s of ps) {
    if (!ns.has(s.id)) out.push(`− section ${q(s.name)}`);
    else if (ns.get(s.id).name !== s.name) out.push(`Section ${q(s.name)} renamed to ${q(ns.get(s.id).name)}`);
  }
  const order = (p) => (p.rows || []).map((r) => r.id).filter((id) => pt.has(id) && nt.has(id)).join();
  if (moved || order(prev) !== order(next)) out.push(moved ? `${plural(moved, 'task')} indented or outdented` : 'Rows reordered');
  const pf = new Map((prev.fields || []).map((f) => [f.id, f]));
  for (const f of fields.values()) {
    if (!pf.has(f.id)) out.push(`+ column ${q(f.name)}`);
    else if (pf.get(f.id).name !== f.name) out.push(`Column ${q(pf.get(f.id).name)} renamed to ${q(f.name)}`);
    else if (!same(pf.get(f.id).options, f.options)) out.push(`Options of ${q(f.name)} edited`);
  }
  for (const f of pf.values()) if (!fields.has(f.id)) out.push(`− column ${q(f.name)}`);
  const po = prev.options || {};
  const no = next.options || {};
  if (!same(po.status, no.status)) out.push('Status options edited');
  if (!same(po.priority, no.priority)) out.push('Priority options edited');
  if (!same(prev.logs, next.logs)) out.push('Logs edited (risks, decisions, questions)');
  if (!same(prev.baselineSavedAt, next.baselineSavedAt)) out.push(next.baselineSavedAt ? 'Baseline saved' : 'Baseline cleared');
  if (!out.length) out.push(same({ ...prev, updatedAt: 0 }, { ...next, updatedAt: 0 }) ? 'No changes' : 'View settings changed');
  if (out.length > MAX_CHANGES) {
    const rest = out.length - (MAX_CHANGES - 1);
    out.splice(MAX_CHANGES - 1, out.length, `… and ${plural(rest, 'more change')}`);
  }
  return out;
}

/** Replace the contents of `target` with `source` in place (restore a version), keeping target's id. */
export function replacePlanContents(target, source) {
  const id = target.id;
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, JSON.parse(JSON.stringify(source)), { id });
  return target;
}
