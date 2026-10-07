// Spreadsheet-style cell operations for the grid: TSV copy, paste (one value
// over a range, or a block from the active cell), fill down, fill handle and
// clear. Rows/columns are addressed by index into the visible grid; edits are
// applied to the plan by id/column key. Pure.
import { isComplete } from './options.js';
import { computeTree, isTask } from './tree.js';
import { setTaskField, predsText, setPredsFromText } from './edit.js';
import { fieldKey, setFieldValue } from './fields.js';

export const READONLY_COLS = new Set(['num', 'variance', 'id']);
// Columns a summary task rolls up from its subtasks.
export const ROLLUP_COLS = new Set(['start', 'finish', 'duration', 'progress', 'status']);
/** Built-in columns that cannot be blank (a cleared cell keeps its value). */
export const REQUIRED_COLS = new Set(['name', 'start', 'finish', 'duration', 'status', 'priority']);
export const MAX_PASTE_CELLS = 20000;

/** Normalised range { r1, c1, r2, c2 } from two corners { r, c }. */
export function normRange(a, b = a) {
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}
export const rangeSize = (g) => (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);

/** Tab-separated text (Excel / Sheets clipboard) → rows of cells. Quoted cells may hold tabs/newlines. */
export function parseTSV(text) {
  const s = String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/(\r\n|\n|\r)$/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === '\t') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

const tsvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toTSV = (matrix) => matrix.map((r) => r.map(tsvCell).join('\t')).join('\r\n');

const fieldOf = (plan, col) => (plan.fields || []).find((f) => fieldKey(f) === col) || null;

/** Text of one cell as copied (dates ISO, durations in days, predecessors as outline refs). */
export function cellText(plan, tree, row, col) {
  if (!row) return '';
  if (!isTask(row)) return col === 'name' ? row.name : '';
  const f = fieldOf(plan, col);
  if (f) {
    const v = row.values ? row.values[f.id] : undefined;
    if (v == null || v === '') return '';
    return f.type === 'checkbox' ? (v ? 'Yes' : '') : String(v);
  }
  switch (col) {
    case 'num':
      return tree.outline.get(row.id) || '';
    case 'preds':
      return predsText(row, tree);
    case 'tags':
      return (row.tags || []).join(', ');
    case 'variance':
      return '';
    default:
      return row[col] == null ? '' : String(row[col]);
  }
}

/**
 * Where a clipboard block lands. One value fills the whole selection; a block
 * whose size divides the selection is repeated over it; otherwise the block is
 * pasted from the selection's top-left cell down/right, clipped to the grid.
 * Returns { cells: [{ r, c, value }], range }.
 */
export function pasteTargets(block, sel, nRows, nCols) {
  const bh = block.length;
  const bw = Math.max(...block.map((r) => r.length));
  const sh = sel.r2 - sel.r1 + 1;
  const sw = sel.c2 - sel.c1 + 1;
  const tile = (bh === 1 && bw === 1) || (sh * sw > 1 && sh % bh === 0 && sw % bw === 0);
  const h = tile ? sh : Math.min(bh, nRows - sel.r1);
  const w = tile ? sw : Math.min(bw, nCols - sel.c1);
  const cells = [];
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      const v = block[i % bh][j % bw];
      cells.push({ r: sel.r1 + i, c: sel.c1 + j, value: v == null ? '' : v });
      if (cells.length >= MAX_PASTE_CELLS) return { cells, range: { r1: sel.r1, c1: sel.c1, r2: sel.r1 + i, c2: sel.c1 + w - 1 } };
    }
  }
  return { cells, range: { r1: sel.r1, c1: sel.c1, r2: sel.r1 + h - 1, c2: sel.c1 + w - 1 } };
}

/**
 * Ctrl+D: copy the top row of the selection into the rows below it; a
 * one-row selection copies from the row above (like Excel).
 * Returns [{ r, c, from: { r, c } }].
 */
export function fillDownTargets(sel) {
  const out = [];
  const single = sel.r1 === sel.r2;
  if (single && sel.r1 === 0) return out;
  const src = single ? sel.r1 - 1 : sel.r1;
  for (let r = single ? sel.r1 : sel.r1 + 1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) out.push({ r, c, from: { r: src, c } });
  return out;
}

/** Fill handle dragged down to row `toRow`: repeat the selected rows below the selection. */
export function fillHandleTargets(sel, toRow) {
  const out = [];
  const h = sel.r2 - sel.r1 + 1;
  for (let r = sel.r2 + 1; r <= toRow; r++) for (let c = sel.c1; c <= sel.c2; c++) out.push({ r, c, from: { r: sel.r1 + ((r - sel.r2 - 1) % h), c } });
  return out;
}

/**
 * Apply cell edits [{ id, col, value }] to the plan in order, validating and
 * coercing each value for its column (built-in or custom). Cells that cannot
 * take the value are skipped: kind 'rollup' (summary rows: dates, duration,
 * progress, status), 'section' (section rows, except the name), 'readonly'
 * (computed columns), 'required' (blank value for a column that needs one),
 * 'invalid' (value rejected; `reason` says why).
 * Returns { applied, skipped: [{ id, col, value, kind, reason }] }.
 */
export function applyCellEdits(plan, edits, labels = {}) {
  const tree = computeTree(plan.rows);
  const byId = new Map(plan.rows.map((r) => [r.id, r]));
  const skipped = [];
  let applied = 0;
  const skip = (e, kind, reason = '') => skipped.push({ id: e.id, col: e.col, value: e.value, kind, reason });
  for (const e of edits) {
    const r = byId.get(e.id);
    if (!r) continue;
    const value = String(e.value == null ? '' : e.value);
    if (READONLY_COLS.has(e.col)) {
      skip(e, 'readonly');
      continue;
    }
    if (!isTask(r)) {
      if (e.col !== 'name') skip(e, 'section');
      else if (!value.trim()) skip(e, 'required', 'Section name cannot be empty.');
      else if (r.name !== value.trim().slice(0, 300)) {
        r.name = value.trim().slice(0, 300);
        applied++;
      }
      continue;
    }
    if (ROLLUP_COLS.has(e.col) && tree.isSummary(r.id)) {
      skip(e, 'rollup');
      continue;
    }
    if (e.col === 'finish' && r.milestone) {
      skip(e, 'invalid', 'A milestone has no separate finish date.');
      continue;
    }
    if (!value.trim() && (REQUIRED_COLS.has(e.col) || (e.col === 'progress' && isComplete(plan, r.status)))) {
      skip(e, 'required', `${labels[e.col] || e.col} cannot be empty.`);
      continue;
    }
    const before = JSON.stringify(r);
    let err = null;
    const f = fieldOf(plan, e.col);
    if (f) err = setFieldValue(r, f, value);
    else if (e.col === 'preds') {
      const errs = setPredsFromText(plan.rows, r.id, value);
      if (errs.length) err = errs.join(' ');
    } else if (e.col === 'name') err = setTaskField(r, 'name', value, undefined, plan);
    else if (e.col === 'progress') err = setTaskField(r, 'progress', value.trim() === '' ? '0' : value, undefined, plan);
    else err = setTaskField(r, e.col, value.trim(), undefined, plan);
    if (err) {
      if (e.col !== 'preds') Object.assign(r, JSON.parse(before));
      skip(e, 'invalid', err);
    } else if (JSON.stringify(r) !== before) applied++;
  }
  return { applied, skipped };
}

/** One toast for skipped cells, e.g. "3 cells skipped: 2 on summary rows (they roll up) · 1 invalid (Start “abc”: …)". */
export function skipSummary(skipped, labels = {}) {
  if (!skipped.length) return '';
  const n = skipped.length;
  const by = (k) => skipped.filter((s) => s.kind === k);
  const parts = [];
  const roll = by('rollup').length;
  const sec = by('section').length;
  const ro = by('readonly').length;
  const bad = [...by('required'), ...by('invalid')];
  if (roll) parts.push(`${roll} on summary rows (dates, progress and status roll up)`);
  if (sec) parts.push(`${sec} on section rows`);
  if (ro) parts.push(`${ro} in read-only columns`);
  if (bad.length) {
    const ex = bad[0];
    const v = String(ex.value);
    parts.push(`${bad.length} invalid (${labels[ex.col] || ex.col}${v ? ` “${v.length > 30 ? `${v.slice(0, 29)}…` : v}”` : ''}: ${ex.reason.replace(/\.$/, '')}${bad.length > 1 ? ', …' : ''})`);
  }
  return `${n} cell${n === 1 ? '' : 's'} skipped: ${parts.join(' · ')}`;
}
