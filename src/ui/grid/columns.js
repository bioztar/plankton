// Grid column definitions (built-in + plan custom fields) and the per-plan
// order / visibility / width settings saved in plan.settings. Pure.
import { fieldKey, FIELD_TYPES } from '../../model/fields.js';

export const COLUMNS = [
  { key: 'num', label: '#', width: 52, fixed: true },
  { key: 'name', label: 'Task name', width: 300, fixed: true, edit: 'text' },
  { key: 'start', label: 'Start', width: 104, edit: 'date', align: 'r' },
  { key: 'finish', label: 'Finish', width: 104, edit: 'date', align: 'r' },
  { key: 'duration', label: 'Dur.', menuLabel: 'Duration', width: 56, edit: 'text', align: 'r', title: 'Duration in working days' },
  { key: 'progress', label: '%', menuLabel: 'Progress %', width: 64, edit: 'text', align: 'r', title: 'Progress %' },
  { key: 'owner', label: 'Owner', width: 120, edit: 'text' },
  { key: 'preds', label: 'Predecessors', width: 116, edit: 'text', title: 'e.g. 3, 1.2FS+2d, #7SS-1d' },
  { key: 'status', label: 'Status', width: 104, edit: 'select' },
  { key: 'priority', label: 'Priority', width: 80, edit: 'select', hidden: true },
  { key: 'workstream', label: 'Workstream', width: 120, edit: 'text', hidden: true },
  { key: 'variance', label: 'Variance', width: 76, align: 'r', hidden: (plan) => !plan.settings.showBaseline, title: 'Finish vs. baseline (working days)' },
  { key: 'id', label: 'ID', width: 52, align: 'r', hidden: true, title: 'Task ID (use #ID in predecessors)' },
];

const TYPE_WIDTH = { text: 140, person: 120, number: 90, date: 104, select: 120, checkbox: 72, url: 160 };
const TYPE_EDIT = { select: 'select', checkbox: 'checkbox', date: 'date' };

export function customColumn(f) {
  const type = FIELD_TYPES.find((t) => t.type === f.type);
  return {
    key: fieldKey(f),
    label: f.name,
    width: TYPE_WIDTH[f.type] || 120,
    edit: TYPE_EDIT[f.type] || 'text',
    align: f.type === 'number' ? 'r' : f.type === 'checkbox' ? 'c' : undefined,
    title: `${f.name} · custom ${type ? type.label.toLowerCase() : 'text'} column`,
    field: f,
  };
}

export const allColumns = (plan) => [...COLUMNS, ...(plan.fields || []).map(customColumn)];
export const columnLabel = (c) => c.menuLabel || c.label;

/** Movable column keys in display order (saved order first, new columns at their natural place). */
export function columnOrder(plan) {
  const defs = allColumns(plan).filter((c) => !c.fixed);
  const keys = new Set(defs.map((c) => c.key));
  const out = (plan.settings.columnOrder || []).filter((k) => keys.has(k));
  const placed = new Set(out);
  defs.forEach((c, i) => {
    if (placed.has(c.key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) at = Math.max(at, out.indexOf(defs[j].key) + 1);
    out.splice(at, 0, c.key);
    placed.add(c.key);
  });
  return out;
}

export function columnState(plan) {
  const s = plan.settings.columns || {};
  const defs = allColumns(plan);
  const byKey = new Map(defs.map((c) => [c.key, c]));
  const ordered = [...defs.filter((c) => c.fixed), ...columnOrder(plan).map((k) => byKey.get(k))];
  return ordered.map((c) => {
    const user = s[c.key] || {};
    const dflt = c.field ? true : typeof c.hidden === 'function' ? !c.hidden(plan) : !c.hidden;
    return {
      ...c,
      visible: c.fixed ? true : user.explicit ? !!user.visible : dflt,
      width: user.width || c.width,
    };
  });
}

export function visibleColumns(plan) {
  return columnState(plan).filter((c) => c.visible);
}

export function setColumnVisible(plan, key, on) {
  const cs = (plan.settings.columns = { ...(plan.settings.columns || {}) });
  cs[key] = { ...(cs[key] || {}), visible: !!on, explicit: true };
}

/**
 * Move a column among the *visible* movable columns by `delta` steps
 * (Move left / Move right). Returns false when it cannot move.
 */
export function moveColumn(plan, key, delta) {
  const order = columnOrder(plan);
  const vis = new Set(visibleColumns(plan).map((c) => c.key));
  const shown = order.filter((k) => vis.has(k));
  const i = shown.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= shown.length) return false;
  return moveColumnTo(plan, key, delta > 0 ? (shown[j + 1] ?? null) : shown[j]);
}

/** Put `key` right before `beforeKey` (null = last). Used by header drag-and-drop. */
export function moveColumnTo(plan, key, beforeKey) {
  const order = columnOrder(plan);
  const i = order.indexOf(key);
  if (i < 0 || key === beforeKey) return false;
  const next = order.filter((k) => k !== key);
  const at = beforeKey == null ? next.length : next.indexOf(beforeKey);
  if (at < 0) return false;
  next.splice(at, 0, key);
  if (next.join() === order.join()) return false;
  plan.settings.columnOrder = next;
  return true;
}

export function resetColumns(plan) {
  plan.settings.columns = null;
  plan.settings.columnOrder = null;
}
