// Undo/redo snapshots. Each step stores the plan's JSON split into a head and one
// string per row; rows unchanged since the previous snapshot reuse the same string,
// so a step costs only what changed (a 500-task plan is ~400 KB, an edit ~1 KB).

export const MAX_HISTORY_STEPS = 200;
export const MAX_HISTORY_BYTES = 20 * 1024 * 1024;

export function createHistory({ maxSteps = MAX_HISTORY_STEPS, maxBytes = MAX_HISTORY_BYTES } = {}) {
  let cache = new Map();

  /** Snapshot a plan. `bytes` counts only strings not shared with earlier snapshots. */
  function snap(plan) {
    const { rows, ...rest } = plan;
    const head = JSON.stringify(rest);
    const ids = new Array(rows.length);
    const out = new Array(rows.length);
    let chars = head.length;
    if (cache.size > rows.length * 2 + 64) cache = new Map();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const j = JSON.stringify(r);
      const c = cache.get(r.id);
      ids[i] = r.id;
      if (c === j) out[i] = c;
      else {
        cache.set(r.id, j);
        out[i] = j;
        chars += j.length;
      }
    }
    return { head, ids, rows: out, bytes: chars * 2 + rows.length * 8 };
  }

  function restore(sn) {
    const plan = JSON.parse(sn.head);
    plan.rows = sn.rows.map((j) => JSON.parse(j));
    return plan;
  }

  function same(a, b) {
    if (a.head !== b.head || a.rows.length !== b.rows.length) return false;
    for (let i = 0; i < a.rows.length; i++) if (a.rows[i] !== b.rows[i]) return false;
    return true;
  }

  /** Push onto a stack, dropping the oldest steps beyond maxSteps / maxBytes. */
  function push(stack, sn) {
    stack.push(sn);
    let total = 0;
    for (const x of stack) total += x.bytes;
    while (stack.length > 1 && (stack.length > maxSteps || total > maxBytes)) total -= stack.shift().bytes;
  }

  const bytes = (stack) => stack.reduce((n, x) => n + x.bytes, 0);

  return { snap, restore, same, push, bytes };
}
