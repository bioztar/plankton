// Plan-level option lists for Status and Priority (plan.options), the
// "counts as complete" flag, and edits to any option list (also custom
// single-select columns) that migrate the tasks using renamed or deleted
// options. Pure.
import { findField, normOptions } from './fields.js';

export const DEFAULT_STATUS_OPTIONS = [
  { name: 'Not started', color: '#64748b', complete: false },
  { name: 'In progress', color: '#2563eb', complete: false },
  { name: 'Blocked', color: '#dc2626', complete: false },
  { name: 'Done', color: '#16a34a', complete: true },
];
export const DEFAULT_PRIORITY_OPTIONS = [
  { name: 'Low', color: '#64748b' },
  { name: 'Medium', color: '#2563eb' },
  { name: 'High', color: '#d97706' },
  { name: 'Critical', color: '#dc2626' },
];
export const MAX_LIST_OPTIONS = 40;
export const OPTION_COLORS = ['#64748b', '#2563eb', '#0d9488', '#16a34a', '#65a30d', '#d97706', '#ea580c', '#dc2626', '#db2777', '#7c3aed'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export function defaultOptions() {
  return { status: DEFAULT_STATUS_OPTIONS.map((o) => ({ ...o })), priority: DEFAULT_PRIORITY_OPTIONS.map((o) => ({ ...o })) };
}

function normList(list, dflt, withComplete) {
  const out = [];
  for (const o of Array.isArray(list) ? list : []) {
    const raw = o && typeof o === 'object' ? o : { name: o };
    const name = String(raw.name == null ? '' : raw.name).trim().slice(0, 60);
    if (!name || out.some((x) => same(x.name, name))) continue;
    const d = dflt.find((x) => same(x.name, name));
    const item = { name, color: COLOR_RE.test(raw.color) ? raw.color.toLowerCase() : d ? d.color : OPTION_COLORS[out.length % OPTION_COLORS.length] };
    if (withComplete) item.complete = !!raw.complete;
    out.push(item);
    if (out.length >= MAX_LIST_OPTIONS) break;
  }
  if (!out.length) return dflt.map((o) => ({ ...o }));
  if (withComplete) {
    if (!out.some((o) => o.complete)) (out.find((o) => same(o.name, 'Done')) || out[out.length - 1]).complete = true;
    if (out.length > 1 && out.every((o) => o.complete)) out[0].complete = false;
  }
  return out;
}

/** Validate plan.options from untrusted JSON; plans without lists get the defaults. */
export function normOptionLists(input) {
  const o = input && typeof input === 'object' ? input : {};
  return { status: normList(o.status, DEFAULT_STATUS_OPTIONS, true), priority: normList(o.priority, DEFAULT_PRIORITY_OPTIONS, false) };
}

const listOf = (plan, key, dflt) => (plan && plan.options && Array.isArray(plan.options[key]) && plan.options[key].length ? plan.options[key] : dflt);
export const statusOptions = (plan) => listOf(plan, 'status', DEFAULT_STATUS_OPTIONS);
export const priorityOptions = (plan) => listOf(plan, 'priority', DEFAULT_PRIORITY_OPTIONS);
export const statusNames = (plan) => statusOptions(plan).map((o) => o.name);
export const priorityNames = (plan) => priorityOptions(plan).map((o) => o.name);

/** Canonical option name for user input (case-insensitive), or null. */
export function matchOption(names, value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return null;
  return names.find((n) => same(n, s)) || null;
}

export function isComplete(plan, status) {
  return statusOptions(plan).some((o) => o.complete && o.name === status);
}
export const completeStatuses = (plan) => statusOptions(plan).filter((o) => o.complete).map((o) => o.name);
export const defaultStatus = (plan) => statusOptions(plan)[0].name;
export function defaultPriority(plan) {
  const names = priorityNames(plan);
  return matchOption(names, 'Medium') || names[Math.floor((names.length - 1) / 2)];
}

export function optionColor(plan, key, name) {
  const o = (key === 'priority' ? priorityOptions(plan) : statusOptions(plan)).find((x) => x.name === name);
  return o ? o.color : '';
}

/**
 * Rolled-up status of a summary task: complete when every leaf is complete,
 * the leaves' common status when they agree, else Blocked / In progress when the
 * plan has such options, else the most common status among the open leaves.
 */
export function summaryStatus(tree, id, plan) {
  const leaves = [];
  const walk = (x) => {
    for (const c of tree.children.get(x) || []) tree.isSummary(c) ? walk(c) : leaves.push(tree.byId.get(c));
  };
  walk(id);
  const names = statusNames(plan);
  if (!leaves.length) return names[0];
  if (leaves.every((t) => isComplete(plan, t.status))) {
    const first = leaves[0].status;
    return leaves.every((t) => t.status === first) ? first : completeStatuses(plan)[0];
  }
  if (leaves.every((t) => t.status === leaves[0].status)) return leaves[0].status;
  const open = leaves.filter((t) => !isComplete(plan, t.status));
  const blocked = matchOption(names, 'Blocked');
  if (blocked && open.some((t) => t.status === blocked)) return blocked;
  const prog = matchOption(names, 'In progress');
  if (prog) return prog;
  const n = new Map();
  for (const t of open) n.set(t.status, (n.get(t.status) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// ---- editing option lists -------------------------------------------------
// target: 'status' | 'priority' | a custom select field id.

/** Editable copy of a list: [{ name, color?, complete?, from }]. */
export function getOptionList(plan, target) {
  if (target === 'status') return statusOptions(plan).map((o) => ({ ...o, from: o.name }));
  if (target === 'priority') return priorityOptions(plan).map((o) => ({ ...o, from: o.name }));
  const f = findField(plan, target);
  return f ? f.options.map((name) => ({ name, from: name })) : [];
}

const valueOf = (t, target) => (target === 'status' || target === 'priority' ? t[target] : t.values ? t.values[target] : undefined);

/** Tasks whose value is `name` in the list `target`. */
export function optionUsage(plan, target, name) {
  return plan.rows.filter((r) => r.kind !== 'section' && valueOf(r, target) === name).length;
}

/**
 * Replace a list with an edited copy. items: [{ name, color, complete, from,
 * deleted, moveTo }] in the new order; `from` = original name (null = new),
 * `deleted` items move their tasks to `moveTo` (a kept item's new name; '' clears
 * a custom column). Renames migrate every task. Returns { error } or
 * { renamed, moved } (task counts).
 */
export function applyOptionList(plan, target, items) {
  const builtIn = target === 'status' || target === 'priority';
  const field = builtIn ? null : findField(plan, target);
  if (!builtIn && (!field || field.type !== 'select')) return { error: 'Unknown column.' };
  const kept = [];
  for (const it of items) {
    if (it.deleted) continue;
    const name = String(it.name == null ? '' : it.name).trim().slice(0, builtIn ? 60 : 100);
    if (!name) return { error: 'Options need a name.' };
    if (kept.some((k) => same(k.name, name))) return { error: `“${name}” is listed twice.` };
    kept.push({ ...it, name });
  }
  if (builtIn && !kept.length) return { error: 'Keep at least one option.' };
  if (kept.length > MAX_LIST_OPTIONS) return { error: `At most ${MAX_LIST_OPTIONS} options.` };
  if (target === 'status') {
    if (!kept.some((k) => k.complete)) return { error: 'Flag at least one status as “counts as complete”.' };
    if (!kept.some((k) => !k.complete)) return { error: 'At least one status must not count as complete.' };
  }
  const map = new Map();
  for (const k of kept) if (k.from != null) map.set(k.from, k.name);
  for (const it of items) {
    if (!it.deleted || it.from == null || map.has(it.from)) continue;
    const used = optionUsage(plan, target, it.from);
    const to = it.moveTo == null ? null : kept.find((k) => same(k.name, it.moveTo));
    if (to) map.set(it.from, to.name);
    else if (!builtIn && (it.moveTo === '' || !used)) map.set(it.from, '');
    else if (used) return { error: `Choose where the ${used} task${used === 1 ? '' : 's'} using “${it.from}” should move.` };
  }
  const wasComplete = (s) => isComplete(plan, s);
  let renamed = 0;
  let moved = 0;
  const changes = [];
  for (const r of plan.rows) {
    if (r.kind === 'section') continue;
    const v = valueOf(r, target);
    if (v == null || v === '' || !map.has(v)) continue;
    const nv = map.get(v);
    const deleted = !kept.some((k) => k.from === v);
    if (nv !== v) {
      if (deleted) moved++;
      else renamed++;
    }
    changes.push([r, v, nv]);
  }
  for (const r of plan.rows) {
    if (r.kind === 'section') continue;
    const v = valueOf(r, target);
    if (v != null && v !== '' && !map.has(v)) changes.push([r, v, builtIn ? kept[0].name : '']);
  }
  const before = new Map(changes.map(([r, v]) => [r, wasComplete(v)]));
  if (target === 'status') plan.options = { ...(plan.options || {}), status: kept.map((k) => ({ name: k.name, color: COLOR_RE.test(k.color) ? k.color : OPTION_COLORS[0], complete: !!k.complete })), priority: priorityOptions(plan).map((o) => ({ ...o })) };
  else if (target === 'priority') plan.options = { status: statusOptions(plan).map((o) => ({ ...o })), ...(plan.options || {}), priority: kept.map((k) => ({ name: k.name, color: COLOR_RE.test(k.color) ? k.color : OPTION_COLORS[0] })) };
  else field.options = normOptions(kept.map((k) => k.name));
  for (const [r, , nv] of changes) {
    if (builtIn) r[target] = nv;
    else if (nv === '') delete r.values[target];
    else r.values[target] = nv;
  }
  if (target === 'status') {
    for (const r of plan.rows) {
      if (r.kind === 'section') continue;
      const now = isComplete(plan, r.status);
      const was = before.has(r) ? before.get(r) : now;
      if (now && r.progress < 100) r.progress = 100;
      else if (!now && was && r.progress >= 100) r.progress = 90;
    }
  }
  return { renamed, moved };
}

const edit = (plan, target, fn) => {
  const items = getOptionList(plan, target);
  const err = fn(items);
  return err ? { error: err } : applyOptionList(plan, target, items);
};
const find = (items, name) => items.find((i) => same(i.name, name));

export const addOption = (plan, target, name, extra = {}) =>
  edit(plan, target, (items) => {
    items.push({ color: OPTION_COLORS[items.length % OPTION_COLORS.length], complete: false, ...extra, name, from: null });
  });
export const renameOption = (plan, target, from, to) =>
  edit(plan, target, (items) => {
    const it = find(items, from);
    if (!it) return `No option “${from}”.`;
    it.name = to;
    return null;
  });
export const deleteOption = (plan, target, name, moveTo) =>
  edit(plan, target, (items) => {
    const it = find(items, name);
    if (!it) return `No option “${name}”.`;
    it.deleted = true;
    it.moveTo = moveTo;
    return null;
  });
export const moveOption = (plan, target, name, toIndex) =>
  edit(plan, target, (items) => {
    const i = items.findIndex((x) => same(x.name, name));
    if (i < 0) return `No option “${name}”.`;
    const [it] = items.splice(i, 1);
    items.splice(Math.max(0, Math.min(items.length, toIndex)), 0, it);
    return null;
  });
export const setOptionColor = (plan, target, name, color) =>
  edit(plan, target, (items) => {
    const it = find(items, name);
    if (!it) return `No option “${name}”.`;
    it.color = color;
    return null;
  });
export const setOptionComplete = (plan, name, on) =>
  edit(plan, 'status', (items) => {
    const it = find(items, name);
    if (!it) return `No option “${name}”.`;
    it.complete = !!on;
    return null;
  });
