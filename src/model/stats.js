// Header statistics and filtering helpers (pure).
import { parseISO, todayISO, workdayDiff } from '../schedule/calendar.js';
import { isTask } from './tree.js';
import { descText } from '../util/sanitize.js';
import { formatValue, findField } from './fields.js';
import { isComplete, summaryStatus } from './options.js';

export function statusDay(plan, now) {
  return parseISO(plan.statusDate || todayISO(now));
}

export function isOverdue(task, day, plan) {
  return isTask(task) && !isComplete(plan, task.status) && task.progress < 100 && parseISO(task.finish) < day;
}

export function planStats(plan, tree, now) {
  const day = statusDay(plan, now);
  const leaves = tree.tasks.filter((t) => !tree.isSummary(t.id));
  let w = 0;
  let wp = 0;
  let finish = '';
  let start = '';
  let overdue = 0;
  let done = 0;
  for (const t of leaves) {
    const d = t.milestone ? 0 : t.duration;
    w += d;
    wp += d * t.progress;
    if (!finish || t.finish > finish) finish = t.finish;
    if (!start || t.start < start) start = t.start;
    if (isOverdue(t, day, plan)) overdue++;
    if (isComplete(plan, t.status)) done++;
  }
  return {
    tasks: leaves.length,
    milestones: leaves.filter((t) => t.milestone).length,
    done,
    percent: w > 0 ? Math.round(wp / w) : leaves.length ? Math.round((done / leaves.length) * 100) : 0,
    start,
    finish,
    overdue,
  };
}

/** Baseline variance in working days (positive = late), or null. */
export function variance(task) {
  if (!task.baseline) return null;
  return workdayDiff(parseISO(task.baseline.finish), parseISO(task.finish));
}

/**
 * Return a Set of matching task ids for the filter, or null when no filter is active.
 * filter: { text, owner, status, section, overdue, hideDone, field: { id, value } }
 * (field.value is the display text, '' = empty)
 */
export function matchTasks(plan, tree, filter, now) {
  const f = filter || {};
  const text = (f.text || '').trim().toLowerCase();
  const fieldFilter = f.field && findField(plan, f.field.id) ? { def: findField(plan, f.field.id), value: String(f.field.value) } : null;
  if (!text && !f.owner && !f.status && !f.section && !f.overdue && !f.hideDone && !fieldFilter) return null;
  const day = statusDay(plan, now);
  const out = new Set();
  for (const t of tree.tasks) {
    if (f.owner && t.owner !== f.owner) continue;
    if (f.status && t.status !== f.status) continue;
    if (f.section && String(tree.sectionOf.get(t.id)) !== String(f.section)) continue;
    if (f.overdue && (!isOverdue(t, day, plan) || tree.isSummary(t.id))) continue;
    if (f.hideDone && isComplete(plan, tree.isSummary(t.id) ? summaryStatus(tree, t.id, plan) : t.status)) continue;
    if (fieldFilter && formatValue(fieldFilter.def, t.values && t.values[fieldFilter.def.id]) !== fieldFilter.value) continue;
    if (text) {
      const custom = (plan.fields || []).map((fd) => formatValue(fd, t.values && t.values[fd.id]));
      const kv = (t.custom || []).map((c) => `${c.key} ${c.value}`);
      const hay = [t.name, t.owner, t.workstream, t.notes, descText(t), (t.tags || []).join(' '), tree.outline.get(t.id), ...custom, ...kv]
        .join('\n')
        .toLowerCase();
      if (!hay.includes(text)) continue;
    }
    out.add(t.id);
  }
  return out;
}
