// Pure editing helpers used by the UI: field edits with status/progress sync,
// predecessor text, links, moving bars and inserting rows.
import { parseLinkList, formatLink, LINK_TYPES } from '../schedule/links.js';
import { linkError } from '../schedule/engine.js';
import { computeTree, leavesOf, insertionPoint, isTask, blockRange } from './tree.js';
import { createTask, createSection, STATUSES, PRIORITIES } from './plan.js';
import {
  parseISO, toISO, isISODate, nextWorkday, wdIndex, fromWdIndex, applyDateEdit, finishFromDuration, durationFromDates,
} from '../schedule/calendar.js';

/** Keep status and progress consistent after one of them changed. */
export function syncStatus(task, changed) {
  if (changed === 'progress') {
    if (task.progress >= 100) task.status = 'Done';
    else if (task.status === 'Done') task.status = task.progress > 0 ? 'In progress' : 'Not started';
    else if (task.progress > 0 && task.status === 'Not started') task.status = 'In progress';
  } else if (changed === 'status') {
    if (task.status === 'Done') task.progress = 100;
    else if (task.status === 'Not started') task.progress = 0;
    else if (task.progress >= 100) task.progress = 90;
  }
}

/**
 * Apply a user edit to a task field. Returns an error string or null.
 * `pinned` is the date field to keep when start/finish/duration change.
 */
export function setTaskField(task, field, value, pinned) {
  switch (field) {
    case 'name':
      task.name = String(value).trim().slice(0, 500);
      return null;
    case 'start':
    case 'finish':
    case 'duration': {
      if (field !== 'duration' && !isISODate(value)) return 'Enter a date as YYYY-MM-DD.';
      if (field === 'duration' && !/^\s*\d+\s*d?\s*$/i.test(String(value))) return 'Duration is a whole number of working days.';
      const v = field === 'duration' ? parseInt(value, 10) : value;
      if (field === 'duration' && v === 0) task.milestone = true;
      else if (field === 'duration' && task.milestone) task.milestone = false;
      const r = applyDateEdit(task, field, v, pinned);
      if (!r) return 'Invalid date.';
      if (!task.milestone && r.duration < 1) return 'Finish cannot be before start.';
      Object.assign(task, r);
      return null;
    }
    case 'progress': {
      const n = parseInt(String(value).replace('%', ''), 10);
      if (!Number.isFinite(n)) return 'Progress is a number from 0 to 100.';
      task.progress = Math.max(0, Math.min(100, n));
      syncStatus(task, 'progress');
      return null;
    }
    case 'status':
      if (!STATUSES.includes(value)) return 'Unknown status.';
      task.status = value;
      syncStatus(task, 'status');
      return null;
    case 'priority':
      if (!PRIORITIES.includes(value)) return 'Unknown priority.';
      task.priority = value;
      return null;
    case 'milestone':
      task.milestone = !!value;
      if (task.milestone) {
        task.duration = 0;
        task.finish = task.start;
      } else {
        task.duration = Math.max(1, task.duration);
        task.finish = toISO(finishFromDuration(parseISO(task.start), task.duration));
      }
      return null;
    case 'tags':
      task.tags = String(value).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
      return null;
    case 'owner':
    case 'workstream':
      task[field] = String(value).trim().slice(0, 200);
      return null;
    case 'desc':
    case 'notes':
      task[field] = String(value).slice(0, 20000);
      return null;
    default:
      return `Unknown field ${field}`;
  }
}

/** Predecessors as text using outline numbers. */
export function predsText(task, tree) {
  return (task.preds || [])
    .filter((p) => tree.byId.has(p.id))
    .map((p) => formatLink(tree.outline.get(p.id), p.type, p.lag))
    .join(', ');
}

/** "#7" = task id 7, "1.2" / "4" = outline number. */
export function resolveRef(tree, ref) {
  const s = String(ref).trim();
  if (s.startsWith('#')) {
    const id = Number(s.slice(1));
    const r = tree.byId.get(id);
    return r && isTask(r) ? id : null;
  }
  return tree.byOutline.has(s) ? tree.byOutline.get(s) : null;
}

/** Replace a task's predecessors from text. Invalid / cyclic entries are skipped and reported. */
export function setPredsFromText(rows, taskId, text) {
  const tree = computeTree(rows);
  const task = tree.byId.get(taskId);
  const { items, errors } = parseLinkList(text);
  task.preds = [];
  for (const it of items) {
    const id = resolveRef(tree, it.ref);
    if (id == null) {
      errors.push(`No task "${it.ref}".`);
      continue;
    }
    if (task.preds.some((p) => p.id === id)) continue;
    const err = linkError(rows, id, taskId, tree);
    if (err) errors.push(err);
    else task.preds.push({ id, type: it.type, lag: it.lag });
  }
  return errors;
}

/** Add or replace the link pred → succ. Returns an error string or null. */
export function addLink(rows, predId, succId, type = 'FS', lag = 0) {
  if (!LINK_TYPES.includes(type)) return 'Unknown link type.';
  const tree = computeTree(rows);
  const succ = tree.byId.get(succId);
  if (!succ || !isTask(succ)) return 'Unknown task.';
  const existing = succ.preds.findIndex((p) => p.id === predId);
  const saved = existing >= 0 ? succ.preds.splice(existing, 1)[0] : null;
  const err = linkError(rows, predId, succId, tree);
  if (err) {
    if (saved) succ.preds.splice(existing, 0, saved);
    return err;
  }
  const link = { id: predId, type, lag: Math.round(+lag || 0) };
  if (existing >= 0) succ.preds.splice(existing, 0, link);
  else succ.preds.push(link);
  return null;
}

export function removeLink(rows, predId, succId) {
  const succ = rows.find((r) => r.id === succId);
  if (succ && succ.preds) succ.preds = succ.preds.filter((p) => p.id !== predId);
}

/** Move a task (a summary moves all its leaves) by `days` calendar days, snapping to workdays. */
export function moveTaskBy(rows, id, days) {
  const tree = computeTree(rows);
  const t = tree.byId.get(id);
  if (!t || !isTask(t) || !days) return false;
  const s = parseISO(t.start);
  const shift = wdIndex(nextWorkday(s + days)) - wdIndex(s);
  if (!shift) return false;
  for (const lid of leavesOf(tree, id)) {
    const leaf = tree.byId.get(lid);
    const ns = fromWdIndex(wdIndex(parseISO(leaf.start)) + shift);
    leaf.start = toISO(ns);
    leaf.finish = toISO(finishFromDuration(ns, leaf.milestone ? 0 : leaf.duration));
  }
  return true;
}

/** Set a leaf task's finish (resize). Duration ≥ 1. */
export function resizeTaskTo(task, finishDay) {
  const s = parseISO(task.start);
  const f = Math.max(s, finishDay);
  task.duration = Math.max(1, durationFromDates(s, f));
  task.finish = toISO(finishFromDuration(s, task.duration));
  task.milestone = false;
}

/** Insert a new task below the row `refId` (or at the end). Returns the task. */
export function insertTaskBelow(plan, refId, fields = {}) {
  const rows = plan.rows;
  const idx = refId == null ? -1 : rows.findIndex((r) => r.id === refId);
  const { at, level } = insertionPoint(rows, idx);
  const ref = idx >= 0 && isTask(rows[idx]) ? rows[idx] : null;
  const task = createTask(plan, { name: 'New task', start: ref ? ref.start : plan.start, duration: 1, level, ...fields });
  rows.splice(at, 0, task);
  return task;
}

export function insertSectionBelow(plan, refId, fields = {}) {
  const rows = plan.rows;
  const idx = refId == null ? -1 : rows.findIndex((r) => r.id === refId);
  let at = rows.length;
  if (idx >= 0) at = isTask(rows[idx]) && rows[idx].collapsed ? blockRange(rows, idx)[1] : idx + 1;
  const s = createSection(plan, fields);
  rows.splice(at, 0, s);
  return s;
}
