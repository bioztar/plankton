// Pure decisions for how a grid click or key press is interpreted
// (select / edit / open details). Kept free of DOM so it can be unit-tested.

const ACTS = { toggle: 'toggle', color: 'color', 'sec-menu': 'sec-menu', card: 'open', check: 'check' };

/**
 * A click on a grid cell. `detail` is the browser's click count (MouseEvent.detail):
 * the second click of a double-click arrives as a click with detail 2 even when the
 * first click re-rendered the row, so double-click editing does not depend on the
 * separate `dblclick` event (which Chrome drops when the target node was replaced).
 */
export function clickAction({ detail = 1, act = null, editable = false, section = false } = {}) {
  if (act && ACTS[act]) return ACTS[act];
  if (detail === 2) return editable ? 'edit' : section ? 'select' : 'open';
  return 'select';
}

/**
 * A key press on the selected cell (grid focused, not editing).
 * Returns 'edit' | 'type' (start editing with the typed character) | 'open' |
 * 'toggle-check' | null (not handled here).
 * Enter opens details from the Task name / # cells (and read-only cells), edits other cells;
 * Shift+Enter always opens details; F2 always edits.
 */
export function keyAction({ key, mod = false, alt = false, shift = false, col = 'name', editable = false, editKind = 'text', section = false } = {}) {
  if (key === 'F2') return editable ? 'edit' : null;
  if (key === 'Enter') {
    if (mod) return null;
    if (section) return 'edit';
    if (shift || col === 'num' || col === 'name' || !editable) return 'open';
    return editKind === 'checkbox' ? 'toggle-check' : 'edit';
  }
  if (key === ' ' && editable && editKind === 'checkbox' && !section) return 'toggle-check';
  if (key.length === 1 && key !== ' ' && !mod && !alt && editable && !section && editKind === 'text') return 'type';
  if (key.length === 1 && key === ' ' && !mod && !alt && editable && !section && editKind === 'text') return 'type';
  return null;
}
