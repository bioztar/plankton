// Scheduling engine: summary roll-up, dependency graph, cycle detection,
// push-forward auto-scheduling and conflict detection. Pure: works on row objects.
import {
  parseISO,
  toISO,
  addWorkdays,
  nextWorkday,
  finishFromDuration,
  durationFromDates,
  workdayDiff,
} from './calendar.js';
import { earliestStart } from './links.js';
import { computeTree, isAncestor } from '../model/tree.js';

function dayOf(t) {
  return { start: parseISO(t.start), finish: parseISO(t.finish) };
}

function rollupOne(tree, id, agg) {
  const t = tree.byId.get(id);
  let s = Infinity;
  let f = -Infinity;
  let w = 0;
  let wp = 0;
  let n = 0;
  let p = 0;
  for (const c of tree.children.get(id)) {
    const ct = tree.byId.get(c);
    const cs = parseISO(ct.start);
    const cf = parseISO(ct.finish);
    if (cs < s) s = cs;
    if (cf > f) f = cf;
    const a = agg.get(c);
    w += a.w;
    wp += a.wp;
    n += a.n;
    p += a.p;
  }
  t.start = toISO(s);
  t.finish = toISO(f);
  t.duration = durationFromDates(s, f);
  t.milestone = false;
  t.progress = w > 0 ? Math.round(wp / w) : n > 0 ? Math.round(p / n) : 0;
  agg.set(id, { w, wp, n, p });
}

function leafAgg(t) {
  const prog = Math.max(0, Math.min(100, Number(t.progress) || 0));
  const w = t.milestone ? 0 : Math.max(0, t.duration | 0);
  return { w, wp: w * prog, n: 1, p: prog };
}

/**
 * Roll summary tasks up from their children: start = min, finish = max,
 * progress = duration-weighted average over leaf tasks. Mutates rows.
 */
export function rollup(rows, tree = computeTree(rows)) {
  const agg = new Map();
  for (let i = tree.tasks.length - 1; i >= 0; i--) {
    const t = tree.tasks[i];
    if (tree.isSummary(t.id)) rollupOne(tree, t.id, agg);
    else agg.set(t.id, leafAgg(t));
  }
  return tree;
}

// Graph: every task has an "in" node (constraints arrive) and an "out" node
// (its final dates are known). Summary in → child in, child out → summary out,
// leaf in → leaf out, link pred out → succ in.
function buildGraph(tree, extra) {
  const adj = new Map();
  const add = (a, b) => adj.get(a).push(b);
  for (const t of tree.tasks) {
    adj.set('i' + t.id, []);
    adj.set('o' + t.id, []);
  }
  for (const t of tree.tasks) {
    const kids = tree.children.get(t.id);
    if (kids.length) {
      for (const c of kids) {
        add('i' + t.id, 'i' + c);
        add('o' + c, 'o' + t.id);
      }
    } else add('i' + t.id, 'o' + t.id);
    for (const l of t.preds || []) {
      if (tree.byId.has(l.id) && tree.byId.get(l.id).kind !== 'section') add('o' + l.id, 'i' + t.id);
    }
  }
  if (extra) add('o' + extra.pred, 'i' + extra.succ);
  return adj;
}

function topo(adj) {
  const indeg = new Map();
  for (const k of adj.keys()) indeg.set(k, 0);
  for (const vs of adj.values()) for (const v of vs) indeg.set(v, indeg.get(v) + 1);
  const queue = [];
  for (const [k, d] of indeg) if (d === 0) queue.push(k);
  const order = [];
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    order.push(k);
    for (const v of adj.get(k)) {
      const d = indeg.get(v) - 1;
      indeg.set(v, d);
      if (d === 0) queue.push(v);
    }
  }
  return order.length === adj.size ? order : null;
}

/** Explain why a link pred → succ is not allowed, or return null if it is fine. */
export function linkError(rows, predId, succId, tree = computeTree(rows)) {
  if (predId === succId) return 'A task cannot depend on itself.';
  const p = tree.byId.get(predId);
  const s = tree.byId.get(succId);
  if (!p || !s || p.kind === 'section' || s.kind === 'section') return 'Unknown task.';
  if (isAncestor(tree, predId, succId) || isAncestor(tree, succId, predId)) {
    return 'A summary task cannot be linked to one of its own subtasks.';
  }
  if (!topo(buildGraph(tree, { pred: predId, succ: succId }))) {
    const po = tree.outline.get(predId);
    const so = tree.outline.get(succId);
    return `Linking ${po} → ${so} would create a circular dependency.`;
  }
  return null;
}

export function hasCycle(rows, tree = computeTree(rows)) {
  return !topo(buildGraph(tree));
}

/**
 * Push-forward auto-scheduling: every task starts no earlier than its links
 * allow; tasks are never pulled earlier. Moving a summary shifts its subtree.
 * Mutates rows; returns the set of task ids whose dates changed.
 * Throws if the dependency graph has a cycle.
 */
export function autoSchedule(rows, tree = computeTree(rows)) {
  rollup(rows, tree);
  const order = topo(buildGraph(tree));
  if (!order) throw new Error('Dependency cycle');
  const changed = new Set();
  const shift = new Map();
  const agg = new Map();
  for (const key of order) {
    const id = Number(key.slice(1));
    const t = tree.byId.get(id);
    const summary = tree.isSummary(id);
    if (key[0] === 'o') {
      if (summary) rollupOne(tree, id, agg);
      else agg.set(id, leafAgg(t));
      continue;
    }
    const inherited = shift.get(id) || 0;
    const startDay = parseISO(t.start);
    let s = inherited ? addWorkdays(nextWorkday(startDay), inherited) : startDay;
    let es = -Infinity;
    for (const l of t.preds || []) {
      const p = tree.byId.get(l.id);
      if (!p || p.kind === 'section') continue;
      const e = earliestStart(dayOf(p), t, l);
      if (e > es) es = e;
    }
    if (summary) {
      const extra = es > s ? workdayDiff(s, es) : 0;
      const total = inherited + extra;
      if (total) for (const c of tree.children.get(id)) shift.set(c, total);
      continue;
    }
    if (es > s) s = es;
    if (s !== startDay) {
      const dur = t.milestone ? 0 : Math.max(1, t.duration | 0);
      const f = finishFromDuration(s, dur);
      t.start = toISO(s);
      t.finish = toISO(f);
      changed.add(id);
    }
  }
  return changed;
}

/** Links whose constraint is violated by the current dates. */
export function findConflicts(rows, tree = computeTree(rows)) {
  const out = [];
  for (const t of tree.tasks) {
    for (const l of t.preds || []) {
      const p = tree.byId.get(l.id);
      if (!p || p.kind === 'section') continue;
      const es = earliestStart(dayOf(p), t, l);
      const s = parseISO(t.start);
      if (s < es) {
        out.push({ predId: l.id, succId: t.id, type: l.type, lag: l.lag, days: workdayDiff(s, es) });
      }
    }
  }
  return out;
}

/** All links as { predId, succId, type, lag }. */
export function allLinks(tree) {
  const out = [];
  for (const t of tree.tasks) {
    for (const l of t.preds || []) {
      if (tree.byId.has(l.id)) out.push({ predId: l.id, succId: t.id, type: l.type, lag: l.lag | 0 });
    }
  }
  return out;
}

/** Remove links that reference missing tasks, duplicates, self links and links that close a cycle. */
export function sanitizeLinks(rows) {
  const dropped = [];
  for (const t of rows) {
    if (t.kind === 'section') continue;
    const seen = new Set();
    t.preds = (t.preds || []).filter((l) => {
      const ok = l.id !== t.id && !seen.has(l.id);
      seen.add(l.id);
      return ok;
    });
  }
  let tree = computeTree(rows);
  // Cheap checks first; the per-link cycle test below is O(n) per link, so it
  // only runs when the graph actually has a cycle.
  for (const t of rows) {
    if (t.kind === 'section') continue;
    t.preds = t.preds.filter((l) => {
      const p = tree.byId.get(l.id);
      if (!p || p.kind === 'section') {
        dropped.push({ succId: t.id, predId: l.id, reason: 'missing' });
        return false;
      }
      if (isAncestor(tree, l.id, t.id) || isAncestor(tree, t.id, l.id)) {
        dropped.push({ succId: t.id, predId: l.id, reason: 'A summary task cannot be linked to one of its own subtasks.' });
        return false;
      }
      return true;
    });
  }
  if (!hasCycle(rows, tree)) return dropped;
  for (const t of rows) {
    if (t.kind === 'section') continue;
    const all = t.preds;
    t.preds = [];
    for (const l of all) {
      const err = linkError(rows, l.id, t.id, tree);
      if (err) dropped.push({ succId: t.id, predId: l.id, reason: err });
      else t.preds.push(l);
    }
  }
  return dropped;
}
