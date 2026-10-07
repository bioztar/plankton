// Application store: current plan, derived schedule data, UI state and undo/redo.
import { computeTree, normalizeLevels, visibleRows } from '../model/tree.js';
import { rollup, autoSchedule, findConflicts, sanitizeLinks } from '../schedule/engine.js';
import { criticalPath } from '../schedule/critical.js';
import { matchTasks } from '../model/stats.js';
import { nowStamp, normalizePlan } from '../model/plan.js';
import { createHistory, MAX_HISTORY_STEPS } from '../model/history.js';

export const MAX_UNDO = MAX_HISTORY_STEPS;

export function createStore({ plan, storage, readOnly = false, embedded = false, presenter = false, history = {} }) {
  const listeners = new Set();
  const H = createHistory(history);
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
    filter: { text: '', owner: '', status: '', section: '', overdue: false, field: null },
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
          const n = sanitizeLinks(rows).length;
          if (n) s.emit('warn', `${n} circular link${n === 1 ? '' : 's'} removed.`);
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
    const before = H.snap(s.plan);
    let res;
    try {
      res = fn(s.plan);
    } catch (e) {
      s.plan = H.restore(before);
      s.derive(false);
      s.emit('error', e.message || String(e));
      return false;
    }
    if (res === false || typeof res === 'string') {
      s.plan = H.restore(before);
      s.derive(false);
      if (typeof res === 'string') s.emit('error', res);
      s.emit('change');
      return false;
    }
    s.derive(schedule);
    const after = H.snap(s.plan);
    if (H.same(before, after)) {
      s.emit('change');
      return true;
    }
    const stamp = nowStamp();
    if (touch) {
      const rowsBefore = new Map(before.ids.map((id, i) => [id, before.rows[i]]));
      s.plan.rows.forEach((r, i) => {
        if (r.kind === 'section') return;
        const b = rowsBefore.get(r.id);
        if (b != null && b !== after.rows[i]) r.updatedAt = stamp;
      });
    }
    s.plan.updatedAt = stamp;
    if (undo) {
      H.push(s.undoStack, before);
      s.redoStack.length = 0;
    }
    s.lastLabel = label;
    s.persist();
    // Undoable commits are content edits; view tweaks (zoom, collapse, widths) are not.
    if (undo) s.emit('edit', label);
    s.emit('change', { label, moved: s.d.moved });
    return true;
  };

  const restore = (from, to) => {
    if (s.readOnly || !from.length) return false;
    H.push(to, H.snap(s.plan));
    s.plan = normalizePlan(H.restore(from.pop()));
    s.derive(false);
    s.persist();
    s.emit('edit');
    s.emit('change');
    return true;
  };
  s.historyBytes = () => H.bytes(s.undoStack) + H.bytes(s.redoStack);
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
