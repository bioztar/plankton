// Pure editing helpers used by the UI: field edits with status/progress sync,
// predecessor text, links, moving bars and inserting rows.
import { parseLinkList, formatLink, LINK_TYPES } from '../schedule/links.js';
import { linkError } from '../schedule/engine.js';
import { computeTree, leavesOf, insertionPoint, isTask, blockRange } from './tree.js';
import { createTask, createSection } from './plan.js';
import { statusNames, priorityNames, matchOption, isComplete } from './options.js';
import { sanitizeHtml } from '../util/sanitize.js';
import {
  clampDuration, clampLag, parseISO, toISO, isISODate, nextWorkday, wdIndex, fromWdIndex, applyDateEdit, finishFromDuration, durationFromDates,
} from '../schedule/calendar.js';

/**
 * After a status change: a status that counts as complete sets progress to 100,
 * the first status (e.g. Not started) sets 0, and leaving complete drops 100 to 90.
 * Progress edits never change the status.
 */
export function syncStatus(task, plan) {
  if (isComplete(plan, task.status)) task.progress = 100;
  else if (task.status === statusNames(plan)[0]) task.progress = 0;
  else if (task.progress >= 100) task.progress = 90;
}

/**
 * Apply a user edit to a task field. Returns an error string or null.
 * `pinned` is the date field to keep when start/finish/duration change; `plan`
 * supplies the Status / Priority option lists (defaults when omitted).
 */
export function setTaskField(task, field, value, pinned, plan) {
  switch (field) {
    case 'name':
      task.name = String(value).trim().slice(0, 500);
      return null;
    case 'start':
    case 'finish':
    case 'duration': {
      if (field !== 'duration' && !isISODate(value)) return 'Enter a date as YYYY-MM-DD.';
      if (field === 'duration' && !/^\s*\d+\s*d?\s*$/i.test(String(value))) return 'Duration is a whole number of working days.';
      const v = field === 'duration' ? clampDuration(parseInt(value, 10)) : value;
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
      if (!/^\s*-?\d+(\.\d+)?\s*%?\s*$/.test(String(value)) || !Number.isFinite(n)) return 'Progress is a number from 0 to 100.';
      const v = Math.max(0, Math.min(100, n));
      if (v < 100 && isComplete(plan, task.status)) return `Status “${task.status}” counts as complete, so progress stays 100 %. Change the status first.`;
      task.progress = v;
      return null;
    }
    case 'status': {
      const s = matchOption(statusNames(plan), value);
      if (!s) return `Unknown status “${String(value).slice(0, 60)}” (choose ${statusNames(plan).join(', ')}).`;
      if (s === task.status) return null;
      task.status = s;
      syncStatus(task, plan);
      return null;
    }
    case 'priority': {
      const s = matchOption(priorityNames(plan), value);
      if (!s) return `Unknown priority “${String(value).slice(0, 60)}” (choose ${priorityNames(plan).join(', ')}).`;
      task.priority = s;
      return null;
    }
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
    case 'descHtml': {
      // over-long text is cut to MAX_DESC_HTML; the editor warns (see card.js)
      task.descHtml = sanitizeHtml(value);
      return null;
    }
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
  const link = { id: predId, type, lag: clampLag(lag) };
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
