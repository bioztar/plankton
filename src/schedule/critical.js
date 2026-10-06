// Critical path: late dates from a backward pass over the current schedule.
// Tasks with total float ≤ 0 working days are critical.
import { parseISO, startFromDuration, workdayDiff } from './calendar.js';
import { latestFinish } from './links.js';
import { computeTree, leavesOf } from '../model/tree.js';

/** Leaves that drive a summary's start or finish (or the leaf itself). */
function drivers(tree, id, end) {
  const leaves = leavesOf(tree, id);
  if (leaves.length === 1) return leaves;
  const t = tree.byId.get(id);
  return leaves.filter((l) => tree.byId.get(l)[end] === t[end]);
}

/**
 * Returns { tasks: Set<id>, links: Set<"pred>succ">, float: Map<id, days> }.
 * Links on summary tasks act on the subtasks that drive the summary's dates.
 */
export function criticalPath(rows, tree = computeTree(rows)) {
  const leaves = tree.tasks.filter((t) => !tree.isSummary(t.id));
  const out = new Map(leaves.map((t) => [t.id, []]));
  const indeg = new Map(leaves.map((t) => [t.id, 0]));
  for (const t of tree.tasks) {
    for (const l of t.preds || []) {
      if (!tree.byId.has(l.id)) continue;
      const predEnd = l.type === 'SS' || l.type === 'SF' ? 'start' : 'finish';
      const succEnd = l.type === 'FS' || l.type === 'SS' ? 'start' : 'finish';
      for (const a of drivers(tree, l.id, predEnd)) {
        for (const b of drivers(tree, t.id, succEnd)) {
          if (a === b || !out.has(a) || !out.has(b)) continue;
          out.get(a).push({ to: b, link: l, key: `${l.id}>${t.id}` });
          indeg.set(b, indeg.get(b) + 1);
        }
      }
    }
  }
  const queue = leaves.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  const order = [];
  for (let i = 0; i < queue.length; i++) {
    order.push(queue[i]);
    for (const e of out.get(queue[i])) {
      indeg.set(e.to, indeg.get(e.to) - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }
  const result = { tasks: new Set(), links: new Set(), float: new Map() };
  if (order.length !== leaves.length || !leaves.length) return result;
  let projectFinish = -Infinity;
  for (const t of leaves) projectFinish = Math.max(projectFinish, parseISO(t.finish));
  const late = new Map();
  const bound = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const t = tree.byId.get(id);
    let lf = projectFinish;
    const edgeLf = [];
    for (const e of out.get(id)) {
      const s = tree.byId.get(e.to);
      const v = latestFinish(t, { ...late.get(e.to), milestone: s.milestone }, e.link);
      edgeLf.push([e, v]);
      if (v < lf) lf = v;
    }
    const dur = t.milestone ? 0 : Math.max(0, t.duration | 0);
    late.set(id, { lf, ls: startFromDuration(lf, dur) });
    bound.set(id, edgeLf);
    const fl = workdayDiff(parseISO(t.finish), lf);
    result.float.set(id, fl);
    if (fl <= 0) result.tasks.add(id);
  }
  for (const id of result.tasks) {
    const lf = late.get(id).lf;
    for (const [e, v] of bound.get(id)) {
      if (v === lf && result.tasks.has(e.to)) result.links.add(e.key);
    }
  }
  return result;
}
