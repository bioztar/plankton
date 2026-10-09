// Pure helpers for dragging rows by the # cell: drop zone with hysteresis,
// edge auto-scroll speed and the move itself (a no-op move is not committed).
import { moveRows } from '../../model/tree.js';

const BANDS = { before: [0, 0.3], inside: [0.3, 0.7], after: [0.7, 1] };
const HYSTERESIS = 0.15; // of a row height

function band(zone, canNest) {
  if (!canNest && zone !== 'before') return [0.3, 1];
  return BANDS[zone];
}

/**
 * Drop zone under body-relative y. `rows` = number of visible rows, `h` = row height,
 * `canNest(i)` = row i accepts children ('inside'). `prev` ({ i, zone }) is kept while
 * the pointer stays within a small margin around its band, so the drop line does not
 * flicker between before / after / inside (or between two rows) at a boundary.
 */
export function dropZone(y, h, rows, canNest, prev = null) {
  if (!rows) return null;
  if (prev && prev.i >= 0 && prev.i < rows) {
    const [lo, hi] = band(prev.zone, canNest(prev.i));
    const m = h * HYSTERESIS;
    if (y >= (prev.i + lo) * h - m && y <= (prev.i + hi) * h + m) return prev;
  }
  const i = Math.max(0, Math.min(rows - 1, Math.floor(y / h)));
  const frac = Math.max(0, Math.min(1, (y - i * h) / h));
  const nest = canNest(i);
  const zone = frac < 0.3 ? 'before' : frac > 0.7 || !nest ? 'after' : 'inside';
  if (prev && prev.i === i && prev.zone === zone) return prev;
  return { i, zone };
}

/**
 * Auto-scroll speed (px per frame, signed) for a pointer at `pos` inside [start, end]:
 * 0 outside the edge zones, ramping up to `max` at (and beyond) the edge.
 */
export function edgeSpeed(pos, start, end, zone = 40, max = 22) {
  if (pos < start + zone) return -Math.ceil(max * Math.min(1, (start + zone - pos) / zone));
  if (pos > end - zone) return Math.ceil(max * Math.min(1, (pos - (end - zone)) / zone));
  return 0;
}

/**
 * Move `ids` relative to `targetId` inside a store.commit callback. Returns false
 * (nothing committed, no undo entry) when the move is invalid or leaves every row
 * where it was, e.g. a row dropped back onto its own position.
 */
export function applyRowMove(plan, ids, targetId, pos) {
  const before = plan.rows.map((r) => [r, r.level]);
  const next = moveRows(plan.rows, ids, targetId, pos === 'before-next' ? 'after' : pos);
  if (!next) return false;
  if (next.length === before.length && next.every((r, i) => r === before[i][0] && r.level === before[i][1])) return false;
  plan.rows = next;
  return undefined;
}
