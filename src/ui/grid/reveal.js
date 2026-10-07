// Scroll maths that keeps the active grid cell fully in view below the sticky
// header and right of the pinned (#, name) columns. Pure.

/** Left edge (content px) and width of column `ci` given the column widths. */
export function columnBox(widths, ci) {
  let left = 0;
  for (let i = 0; i < ci; i++) left += widths[i];
  return { left, width: widths[ci] || 0 };
}

/** Width of the leading pinned columns (`pinned` = how many). */
export const pinnedWidth = (widths, pinned) => widths.slice(0, pinned).reduce((a, w) => a + w, 0);

/**
 * New { top, left } scroll offsets so `cell` is fully visible.
 * view: { top, left, width, height } (current scroll offsets and client size).
 * cell: { top, height, left, width } in scroll-content coordinates (the
 * header is part of the content, so row i starts at headerH + i * rowH).
 * sticky: { top: header height, left: width of pinned columns, pinned: the cell itself is pinned }.
 * A cell wider than the free area is aligned to its left edge.
 */
export function revealCell(view, cell, sticky = {}) {
  const stTop = sticky.top || 0;
  const stLeft = sticky.left || 0;
  let { top, left } = view;
  if (cell.top - stTop < top) top = cell.top - stTop;
  else if (cell.top + cell.height > top + view.height) top = cell.top + cell.height - view.height;
  if (!sticky.pinned) {
    const free = view.width - stLeft;
    if (cell.left - stLeft < left || cell.width > free) left = cell.left - stLeft;
    else if (cell.left + cell.width > left + view.width) left = cell.left + cell.width - view.width;
  }
  return { top: Math.max(0, Math.round(top)), left: Math.max(0, Math.round(left)) };
}
