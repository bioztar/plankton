// Task tree stored as a flat ordered list with outline levels (like MS Project).
// Section rows (kind: 'section') are markers between tasks: they do not take part
// in the hierarchy and tint every row below them until the next section.

export function isTask(r) {
  return r && r.kind !== 'section';
}

/** Derive parents, children, outline numbers, sections and indexes from rows. */
export function computeTree(rows) {
  const byId = new Map();
  const index = new Map();
  const parent = new Map();
  const children = new Map();
  const outline = new Map();
  const sectionOf = new Map();
  const tasks = [];
  const stack = [];
  const counters = [];
  let section = null;
  rows.forEach((r, i) => {
    byId.set(r.id, r);
    index.set(r.id, i);
    if (!isTask(r)) {
      section = r;
      return;
    }
    tasks.push(r);
    sectionOf.set(r.id, section ? section.id : null);
    const level = Math.min(r.level | 0, stack.length);
    stack.length = level;
    const p = level > 0 ? stack[level - 1] : null;
    parent.set(r.id, p ? p.id : null);
    if (p) children.get(p.id).push(r.id);
    children.set(r.id, []);
    counters.length = level + 1;
    counters[level] = (counters[level] || 0) + 1;
    outline.set(r.id, counters.join('.'));
    stack.push(r);
  });
  const isSummary = (id) => (children.get(id) || []).length > 0;
  const byOutline = new Map();
  for (const [id, o] of outline) byOutline.set(o, id);
  return { rows, tasks, byId, index, parent, children, outline, byOutline, sectionOf, isSummary };
}

export function ancestors(tree, id) {
  const out = [];
  let p = tree.parent.get(id);
  while (p != null) {
    out.push(p);
    p = tree.parent.get(p);
  }
  return out;
}

export function descendants(tree, id) {
  const out = [];
  const walk = (x) => {
    for (const c of tree.children.get(x) || []) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

export function leavesOf(tree, id) {
  if (!tree.isSummary(id)) return [id];
  return descendants(tree, id).filter((d) => !tree.isSummary(d));
}

export function isAncestor(tree, a, b) {
  return ancestors(tree, b).includes(a);
}

/** Clamp levels so the list is a valid tree: first task 0, each ≤ previous + 1. */
export function normalizeLevels(rows) {
  let prev = -1;
  for (const r of rows) {
    if (!isTask(r)) {
      r.level = 0;
      continue;
    }
    let l = Math.max(0, Math.floor(Number(r.level) || 0));
    if (l > prev + 1) l = prev + 1;
    r.level = l;
    prev = l;
  }
  return rows;
}

/** True when rows already form a valid tree. */
export function isValidTree(rows) {
  let prev = -1;
  const ids = new Set();
  for (const r of rows) {
    if (ids.has(r.id)) return false;
    ids.add(r.id);
    if (!isTask(r)) continue;
    if (!Number.isInteger(r.level) || r.level < 0 || r.level > prev + 1) return false;
    prev = r.level;
  }
  return true;
}

/** [start, end) index range of a row plus its descendants (sections inside included). */
export function blockRange(rows, idx) {
  const r = rows[idx];
  if (!isTask(r)) return [idx, idx + 1];
  let last = idx;
  for (let j = idx + 1; j < rows.length; j++) {
    const x = rows[j];
    if (!isTask(x)) continue;
    if (x.level > r.level) last = j;
    else break;
  }
  return [idx, last + 1];
}

/** Keep only ids whose ancestors are not also selected; returned in document order. */
export function topLevelSelection(rows, ids) {
  const set = new Set(ids);
  const tree = computeTree(rows);
  return rows
    .filter((r) => set.has(r.id))
    .filter((r) => !isTask(r) || !ancestors(tree, r.id).some((a) => set.has(a)))
    .map((r) => r.id);
}

function prevTaskIndex(rows, idx) {
  for (let j = idx - 1; j >= 0; j--) if (isTask(rows[j])) return j;
  return -1;
}

function nextTaskIndex(rows, idx) {
  for (let j = idx; j < rows.length; j++) if (isTask(rows[j])) return j;
  return -1;
}

/** Indent selected tasks (and their subtrees) one level. Mutates; returns true if changed. */
export function indent(rows, ids) {
  let changed = false;
  for (const id of topLevelSelection(rows, ids)) {
    const idx = rows.findIndex((r) => r.id === id);
    const t = rows[idx];
    if (!isTask(t)) continue;
    const p = prevTaskIndex(rows, idx);
    if (p < 0 || rows[p].level < t.level) continue;
    const [a, b] = blockRange(rows, idx);
    for (let j = a; j < b; j++) if (isTask(rows[j])) rows[j].level += 1;
    changed = true;
  }
  return changed;
}

/** Outdent selected tasks one level; following siblings become their children. */
export function outdent(rows, ids) {
  let changed = false;
  for (const id of topLevelSelection(rows, ids)) {
    const idx = rows.findIndex((r) => r.id === id);
    const t = rows[idx];
    if (!isTask(t) || t.level === 0) continue;
    const [a, b] = blockRange(rows, idx);
    for (let j = a; j < b; j++) if (isTask(rows[j])) rows[j].level -= 1;
    changed = true;
  }
  normalizeLevels(rows);
  return changed;
}

/**
 * Move rows (with subtrees) relative to a target row.
 * position: 'before' | 'after' (after target's subtree, same level) |
 *           'inside' (last child) | 'firstchild'.
 * Returns a new rows array, or null when the move is invalid.
 */
export function moveRows(rows, ids, targetId, position) {
  const top = topLevelSelection(rows, ids);
  if (!top.length || top.includes(targetId)) return null;
  const blocks = [];
  const moving = new Set();
  for (const id of top) {
    const idx = rows.findIndex((r) => r.id === id);
    const [a, b] = blockRange(rows, idx);
    const block = rows.slice(a, b);
    block.forEach((r) => moving.add(r.id));
    blocks.push(block);
  }
  if (moving.has(targetId)) return null;
  const target = rows.find((r) => r.id === targetId);
  if (!target) return null;
  if ((position === 'inside' || position === 'firstchild') && !isTask(target)) position = 'after';
  const rest = rows.filter((r) => !moving.has(r.id));
  const tIdx = rest.indexOf(target);
  let insertAt;
  let level;
  if (position === 'before') {
    insertAt = tIdx;
    if (isTask(target)) level = target.level;
    else {
      const n = nextTaskIndex(rest, tIdx);
      level = n >= 0 ? rest[n].level : 0;
    }
  } else if (position === 'firstchild') {
    insertAt = tIdx + 1;
    level = target.level + 1;
  } else if (isTask(target)) {
    insertAt = blockRange(rest, tIdx)[1];
    level = position === 'inside' ? target.level + 1 : target.level;
  } else {
    insertAt = tIdx + 1;
    const n = nextTaskIndex(rest, tIdx + 1);
    level = n >= 0 ? rest[n].level : 0;
  }
  const flat = [];
  for (const block of blocks) {
    const root = block[0];
    const delta = isTask(root) ? level - root.level : 0;
    for (const r of block) {
      if (isTask(r)) r.level += delta;
      flat.push(r);
    }
  }
  const out = rest.slice(0, insertAt).concat(flat, rest.slice(insertAt));
  return normalizeLevels(out);
}

/** Delete rows: tasks go with their subtrees, sections go alone. Returns { rows, removed }. */
export function deleteRows(rows, ids) {
  const removed = new Set();
  for (const id of topLevelSelection(rows, ids)) {
    const idx = rows.findIndex((r) => r.id === id);
    const [a, b] = isTask(rows[idx]) ? blockRange(rows, idx) : [idx, idx + 1];
    for (let j = a; j < b; j++) {
      if (isTask(rows[j]) || j === idx) removed.add(rows[j].id);
    }
  }
  const out = rows.filter((r) => !removed.has(r.id));
  for (const r of out) {
    if (isTask(r) && r.preds && r.preds.length) r.preds = r.preds.filter((p) => !removed.has(p.id));
  }
  return { rows: normalizeLevels(out), removed };
}

/**
 * Index at which a new row goes "below" the row at idx, and its level: as first
 * child of an expanded summary, otherwise after the row's subtree as a sibling.
 */
export function insertionPoint(rows, idx) {
  if (idx < 0 || idx >= rows.length) return { at: rows.length, level: 0 };
  const r = rows[idx];
  if (!isTask(r)) {
    const n = nextTaskIndex(rows, idx + 1);
    return { at: idx + 1, level: n >= 0 ? Math.min(rows[n].level, 0) : 0 };
  }
  const [, end] = blockRange(rows, idx);
  if (end > idx + 1 && !r.collapsed) return { at: idx + 1, level: r.level + 1 };
  return { at: end, level: r.level };
}

/**
 * Rows to display. Collapsed tasks hide their subtrees; collapsed sections hide
 * rows until the next section. With a filter, matches plus their ancestors are
 * shown and collapse state is ignored.
 */
export function visibleRows(rows, tree, matches) {
  const out = [];
  if (matches) {
    const keep = new Set();
    for (const id of matches) {
      keep.add(id);
      for (const a of ancestors(tree, id)) keep.add(a);
    }
    let pendingSection = null;
    for (const r of rows) {
      if (!isTask(r)) {
        pendingSection = r;
        continue;
      }
      if (!keep.has(r.id)) continue;
      if (pendingSection) {
        out.push(pendingSection);
        pendingSection = null;
      }
      out.push(r);
    }
    return out;
  }
  let hideBelowLevel = Infinity;
  let sectionHidden = false;
  for (const r of rows) {
    if (!isTask(r)) {
      out.push(r);
      sectionHidden = !!r.collapsed;
      continue;
    }
    if (r.level > hideBelowLevel) continue;
    hideBelowLevel = Infinity;
    if (r.collapsed && tree.isSummary(r.id)) hideBelowLevel = r.level;
    if (!sectionHidden) out.push(r);
  }
  return out;
}
