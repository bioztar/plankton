// Application store: current plan, derived schedule data, UI state and undo/redo.
import { computeTree, normalizeLevels, visibleRows } from '../model/tree.js';
import { rollup, autoSchedule, findConflicts, sanitizeLinks } from '../schedule/engine.js';
import { criticalPath } from '../schedule/critical.js';
import { matchTasks } from '../model/stats.js';
import { nowStamp, normalizePlan } from '../model/plan.js';

export const MAX_UNDO = 200;

export function createStore({ plan, storage, readOnly = false, embedded = false, presenter = false }) {
  const listeners = new Set();
  const s = {
    plan,
    storage,
    readOnly,
    embedded,
    presenter,
    undoStack: [],
    redoStack: [],
    selection: new Set(),
    active: null, // { id, col }
    anchor: null,
    view: 'plan',
    filter: { text: '', owner: '', status: '', section: '', overdue: false },
    cardId: null,
    d: null,
    saveState: 'saved',
    saveTimer: 0,
  };

  s.on = (fn) => listeners.add(fn);
  s.emit = (kind, data) => listeners.forEach((fn) => fn(kind, data));

  s.derive = (schedule = true) => {
    const rows = s.plan.rows;
    normalizeLevels(rows);
    let tree = computeTree(rows);
    let moved = null;
    if (schedule) {
      rollup(rows, tree);
      if (s.plan.settings.autoSchedule) {
        try {
          moved = autoSchedule(rows, tree);
        } catch (e) {
          sanitizeLinks(rows);
          tree = computeTree(rows);
          moved = autoSchedule(rows, tree);
        }
      }
    }
    const conflicts = findConflicts(rows, tree);
    const conflictKeys = new Set(conflicts.map((c) => `${c.predId}>${c.succId}`));
    const critical = s.plan.settings.showCritical ? criticalPath(rows, tree) : null;
    const matches = matchTasks(s.plan, tree, s.filter);
    const visible = visibleRows(rows, tree, matches);
    const indexOf = new Map(visible.map((r, i) => [r.id, i]));
    const sectionColor = new Map();
    for (const t of tree.tasks) {
      const sid = tree.sectionOf.get(t.id);
      if (sid != null) sectionColor.set(t.id, tree.byId.get(sid).color);
    }
    s.d = { tree, conflicts, conflictKeys, critical, matches, visible, indexOf, sectionColor, moved };
    for (const id of [...s.selection]) if (!tree.byId.has(id)) s.selection.delete(id);
    if (s.active && !tree.byId.has(s.active.id)) s.active = null;
    if (s.cardId != null && !tree.byId.has(s.cardId)) s.cardId = null;
    return s.d;
  };

  /** UI-only change (selection, filter, view…): re-derive cheap parts and re-render. */
  s.ui = (rederive = false) => {
    if (rederive) s.derive(false);
    s.emit('change');
  };

  s.persist = () => {
    if (s.readOnly || !s.storage) return;
    s.saveState = 'saving';
    clearTimeout(s.saveTimer);
    s.saveTimer = setTimeout(() => {
      s.saveState = s.storage.save(s.plan) ? 'saved' : 'error';
      s.emit('saved', s.saveState);
    }, 250);
  };

  s.flush = () => {
    if (s.saveState === 'saving' && !s.readOnly && s.storage) {
      clearTimeout(s.saveTimer);
      s.saveState = s.storage.save(s.plan) ? 'saved' : 'error';
    }
  };

  /**
   * Mutate the plan inside fn(plan). Return false from fn (before mutating) to abort,
   * or a string to abort with a message. Options: undo, schedule, touch.
   */
  s.commit = (label, fn, opts = {}) => {
    const { undo = true, schedule = true, touch = true, allowReadOnly = false } = opts;
    if (s.readOnly && !allowReadOnly) {
      s.emit('readonly');
      return false;
    }
    const before = JSON.stringify(s.plan);
    const rowsBefore = touch ? new Map(s.plan.rows.map((r) => [r.id, JSON.stringify(r)])) : null;
    let res;
    try {
      res = fn(s.plan);
    } catch (e) {
      s.plan = JSON.parse(before);
      s.derive(false);
      s.emit('error', e.message || String(e));
      return false;
    }
    if (res === false || typeof res === 'string') {
      s.plan = JSON.parse(before);
      s.derive(false);
      if (typeof res === 'string') s.emit('error', res);
      s.emit('change');
      return false;
    }
    s.derive(schedule);
    const after = JSON.stringify(s.plan);
    if (after === before) {
      s.emit('change');
      return true;
    }
    const stamp = nowStamp();
    if (touch) {
      for (const r of s.plan.rows) {
        if (r.kind === 'section') continue;
        const b = rowsBefore.get(r.id);
        if (b != null && b !== JSON.stringify(r)) r.updatedAt = stamp;
      }
    }
    s.plan.updatedAt = stamp;
    if (undo) {
      s.undoStack.push(before);
      if (s.undoStack.length > MAX_UNDO) s.undoStack.shift();
      s.redoStack.length = 0;
    }
    s.lastLabel = label;
    s.persist();
    s.emit('change', { label, moved: s.d.moved });
    return true;
  };

  const restore = (from, to) => {
    if (s.readOnly || !from.length) return false;
    to.push(JSON.stringify(s.plan));
    s.plan = normalizePlan(JSON.parse(from.pop()));
    s.derive(false);
    s.persist();
    s.emit('change');
    return true;
  };
  s.undo = () => restore(s.undoStack, s.redoStack);
  s.redo = () => restore(s.redoStack, s.undoStack);

  /** Replace the whole plan (switch / import). Clears history. */
  s.load = (plan, opts = {}) => {
    s.plan = plan;
    s.undoStack = [];
    s.redoStack = [];
    s.selection.clear();
    s.active = null;
    s.cardId = null;
    s.derive(true);
    if (opts.save !== false) s.persist();
    s.emit('load');
    s.emit('change');
  };

  s.derive(true);
  return s;
}
