// Plan-level custom column definitions (plan.fields) and per-task values
// (task.values, keyed by field id). Pure.
import { isISODate } from '../schedule/calendar.js';
import { safeUrl } from '../util/markdown.js';

export const FIELD_TYPES = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'date', label: 'Date' },
  { type: 'select', label: 'Single select' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'person', label: 'Person' },
  { type: 'url', label: 'URL' },
];
const TYPES = FIELD_TYPES.map((t) => t.type);
export const MAX_FIELDS = 50;
export const MAX_OPTIONS = 100;
const ID_RE = /^f\d{1,6}$/;

export const fieldKey = (f) => `cf_${f.id}`;
export function fieldIdOfKey(key) {
  const m = /^cf_(f\d{1,6})$/.exec(String(key));
  return m ? m[1] : null;
}
// Built-in column / CSV header names a custom column may not reuse.
export const RESERVED_NAMES = ['#', 'ID', 'Outline', 'Outline level', 'Section', 'Name', 'Task name', 'Start', 'Finish', 'Duration', 'Dur.', 'Progress', 'Progress %', '%', 'Status', 'Priority', 'Owner', 'Workstream', 'Tags', 'Milestone', 'Predecessors', 'Baseline start', 'Baseline finish', 'Variance', 'Notes', 'Description'];
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
export const findField = (plan, id) => (plan.fields || []).find((f) => f.id === id) || null;
export const fieldByName = (plan, name) => (plan.fields || []).find((f) => same(f.name, name)) || null;

export function normOptions(list) {
  const out = [];
  for (const o of Array.isArray(list) ? list : []) {
    const s = String(o == null ? '' : o).trim().slice(0, 100);
    if (s && !out.some((x) => same(x, s))) out.push(s);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

/** Validate field definitions from untrusted JSON. */
export function normFields(list) {
  const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || typeof f !== 'object' || !ID_RE.test(f.id) || out.some((x) => x.id === f.id)) continue;
    const name = String(f.name == null ? '' : f.name).trim().slice(0, 60);
    if (!name || out.some((x) => same(x.name, name))) continue;
    const type = TYPES.includes(f.type) ? f.type : 'text';
    out.push({ id: f.id, name, type, options: type === 'select' ? normOptions(f.options) : [] });
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

const TRUE = /^(true|yes|y|x|1|✓|✔|done|checked|on)$/i;
const FALSE = /^(false|no|n|0|off|unchecked|)$/i;

/** Coerce raw input to a field's type. Returns { value } (null = empty) or { error }. */
export function coerceValue(field, raw) {
  if (field.type === 'checkbox') {
    if (typeof raw === 'boolean') return { value: raw || null };
    const s = String(raw == null ? '' : raw).trim();
    if (TRUE.test(s)) return { value: true };
    if (FALSE.test(s)) return { value: null };
    return { error: `“${field.name}” is a checkbox: use yes or no.` };
  }
  if (typeof raw === 'number' && field.type === 'number') return Number.isFinite(raw) ? { value: raw } : { error: 'Not a number.' };
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return { value: null };
  switch (field.type) {
    case 'number': {
      let t = s.replace(/[\s\u00a0']/g, '');
      if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
      else if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.');
      const n = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : NaN;
      return Number.isFinite(n) ? { value: n } : { error: `“${field.name}” is a number.` };
    }
    case 'date':
      return isISODate(s) ? { value: s } : { error: `“${field.name}” is a date (YYYY-MM-DD).` };
    case 'select': {
      const o = field.options.find((x) => same(x, s));
      return o ? { value: o } : { error: `“${field.name}”: choose one of ${field.options.join(', ') || '(no options yet)'}.` };
    }
    case 'url': {
      const u = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s) && !/^[\w.+-]+@/.test(s) ? `https://${s}` : s;
      const ok = safeUrl(u);
      return ok ? { value: ok.slice(0, 2000) } : { error: `“${field.name}” is a web address (https://…) or mailto: link.` };
    }
    default:
      return { value: s.slice(0, 2000) };
  }
}

/** Display / CSV / search text for a value. */
export function formatValue(field, v) {
  if (v == null || v === '') return '';
  if (field.type === 'checkbox') return v ? 'Yes' : '';
  return String(v);
}

/** Keep only values of known fields, coerced to their type. */
export function normValues(values, fields) {
  const out = {};
  if (!values || typeof values !== 'object' || Array.isArray(values)) return out;
  for (const f of fields) {
    if (!(f.id in values)) continue;
    const r = coerceValue(f, values[f.id]);
    if (!r.error && r.value != null) out[f.id] = r.value;
  }
  return out;
}

/** Set a task's value for a field from user input. Returns an error string or null. */
export function setFieldValue(task, field, raw) {
  const r = coerceValue(field, raw);
  if (r.error) return r.error;
  task.values = { ...(task.values || {}) };
  if (r.value == null) delete task.values[field.id];
  else task.values[field.id] = r.value;
  return null;
}

function nextFieldId(plan) {
  let n = 0;
  for (const f of plan.fields || []) n = Math.max(n, Number(f.id.slice(1)));
  return `f${n + 1}`;
}

function checkName(plan, name, selfId) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return { error: 'Enter a column name.' };
  if (s.length > 60) return { error: 'Column names can be at most 60 characters.' };
  const res = RESERVED_NAMES.find((r) => same(r, s));
  if (res) return { error: `“${res}” is a built-in column. Choose another name.` };
  const clash = (plan.fields || []).find((f) => f.id !== selfId && same(f.name, s));
  if (clash) return { error: `There is already a column called “${clash.name}”.` };
  return { name: s };
}

/** Add a custom column. Returns { field } or { error }. */
export function addField(plan, { name, type = 'text', options = [] } = {}) {
  plan.fields = plan.fields || [];
  if (plan.fields.length >= MAX_FIELDS) return { error: `A plan can have at most ${MAX_FIELDS} custom columns.` };
  const n = checkName(plan, name);
  if (n.error) return n;
  if (!TYPES.includes(type)) return { error: 'Unknown column type.' };
  const field = { id: nextFieldId(plan), name: n.name, type, options: type === 'select' ? normOptions(options) : [] };
  plan.fields.push(field);
  return { field };
}

export function renameField(plan, id, name) {
  const f = findField(plan, id);
  if (!f) return 'Unknown column.';
  const n = checkName(plan, name, id);
  if (n.error) return n.error;
  f.name = n.name;
  return null;
}

/** Replace a single-select column's options; values no longer offered are cleared. */
export function setFieldOptions(plan, id, options) {
  const f = findField(plan, id);
  if (!f || f.type !== 'select') return 'Not a single-select column.';
  f.options = normOptions(options);
  for (const r of plan.rows) {
    if (r.kind === 'section' || !r.values || !(id in r.values)) continue;
    const o = f.options.find((x) => same(x, r.values[id]));
    r.values = { ...r.values };
    if (o) r.values[id] = o;
    else delete r.values[id];
  }
  return null;
}

/** Delete a custom column and every task's value for it. */
export function deleteField(plan, id) {
  const f = findField(plan, id);
  if (!f) return false;
  const key = fieldKey(f);
  plan.fields = plan.fields.filter((x) => x.id !== id);
  for (const r of plan.rows) {
    if (r.kind === 'section' || !r.values || !(id in r.values)) continue;
    r.values = { ...r.values };
    delete r.values[id];
  }
  const s = plan.settings || {};
  if (s.columns && s.columns[key]) {
    s.columns = { ...s.columns };
    delete s.columns[key];
  }
  if (Array.isArray(s.columnOrder)) s.columnOrder = s.columnOrder.filter((k) => k !== key);
  return true;
}

/** Keys of per-task custom fields (task.custom key/value pairs) with how many tasks use them. */
export function customKeyUsage(plan) {
  const m = new Map();
  for (const r of plan.rows) {
    if (r.kind === 'section') continue;
    const seen = new Set();
    for (const c of r.custom || []) {
      const k = String(c.key || '').trim();
      const lk = k.toLowerCase();
      if (!k || seen.has(lk)) continue;
      seen.add(lk);
      const e = m.get(lk) || { key: k, count: 0 };
      e.count++;
      m.set(lk, e);
    }
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function detectType(values) {
  const v = values.map((x) => String(x).trim()).filter(Boolean);
  if (!v.length) return 'text';
  const all = (fn) => v.every(fn);
  const num = { type: 'number', name: '' };
  if (all((x) => !coerceValue(num, x).error)) return 'number';
  if (all((x) => isISODate(x))) return 'date';
  if (all((x) => /^(https?:\/\/|mailto:)/i.test(x) && safeUrl(x))) return 'url';
  if (all((x) => /^(yes|no|true|false)$/i.test(x))) return 'checkbox';
  return 'text';
}

/**
 * Promote a per-task custom field key to a plan column ("Show as column").
 * Reuses a column with the same name. Values that do not fit the column's type
 * stay as per-task custom fields. Returns { field, moved, kept } or { error }.
 */
export function promoteCustomKey(plan, key) {
  const k = String(key || '').trim();
  if (!k) return { error: 'Empty field name.' };
  const tasks = plan.rows.filter((r) => r.kind !== 'section');
  let field = fieldByName(plan, k);
  if (!field) {
    const vals = tasks.flatMap((t) => (t.custom || []).filter((c) => same(c.key, k)).map((c) => c.value));
    const r = addField(plan, { name: k, type: detectType(vals) });
    if (r.error) return r;
    field = r.field;
  }
  let moved = 0;
  let kept = 0;
  for (const t of tasks) {
    const rest = [];
    for (const c of t.custom || []) {
      if (!same(c.key, k)) {
        rest.push(c);
        continue;
      }
      const has = t.values && field.id in t.values;
      if (!has && !setFieldValue(t, field, c.value)) moved++;
      else if (has && String(t.values[field.id]) === String(c.value).trim()) moved++;
      else {
        rest.push(c);
        kept++;
      }
    }
    t.custom = rest;
  }
  return { field, moved, kept };
}

/** Distinct display values of a field across tasks (for filter menus). */
export function distinctValues(plan, field) {
  const s = new Set();
  for (const r of plan.rows) if (r.kind !== 'section') s.add(formatValue(field, r.values && r.values[field.id]));
  return [...s].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })));
}
