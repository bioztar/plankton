// Task grid: virtualised rows, inline editing, keyboard navigation, drag-and-drop
// reordering / re-parenting and column resize.
import { escapeHtml as esc } from '../../util/escape.js';
import { visibleColumns, moveColumnTo, columnLabel } from './columns.js';
import { revealCell, columnBox, pinnedWidth } from './reveal.js';
import { clickAction, keyAction } from './edittrigger.js';
import { findField, formatValue, setFieldValue } from '../../model/fields.js';
import { descText } from '../../util/sanitize.js';
import { safeUrl } from '../../util/markdown.js';
import { fmtDate, fmtVariance, statusSlug } from '../format.js';
import { predsText, setTaskField, setPredsFromText } from '../../model/edit.js';
import { isTask } from '../../model/tree.js';
import { dropZone, edgeSpeed, applyRowMove } from './rowdrag.js';
import { statusNames, priorityNames, optionColor, summaryStatus as rolledStatus } from '../../model/options.js';
import { normRange, rangeSize, parseTSV, toTSV, cellText, pasteTargets, fillDownTargets, fillHandleTargets, applyCellEdits, skipSummary } from '../../model/cells.js';
import { variance, isOverdue, statusDay } from '../../model/stats.js';
import { parseISO, toYMD } from '../../schedule/calendar.js';
import { mod, isTyping } from '../dom.js';

const OVERSCAN = 10;
const HEAD_H = 44;
const DATE_COLS = new Set(['start', 'finish', 'duration', 'progress']);

/** Status shown on a summary row (see options.js summaryStatus). */
export function summaryStatus(tree, id, plan) {
  return rolledStatus(tree, id, plan);
}

export function createGrid(app, root) {
  const store = app.store;
  root.innerHTML = `<div class="g-scroll"><div class="g-head" role="row"></div><div class="g-body" tabindex="0" role="grid" aria-label="Tasks. Arrow keys move, Enter edits, Tab indents, Insert adds a row." aria-multiselectable="true"><div class="g-rows" role="rowgroup"></div><div class="drop-line" hidden></div></div><div class="g-empty" hidden></div></div><div class="g-tip" role="tooltip" hidden></div>`;
  const scroll = root.querySelector('.g-scroll');
  const head = root.querySelector('.g-head');
  const body = root.querySelector('.g-body');
  const rowsEl = root.querySelector('.g-rows');
  const dropLine = root.querySelector('.drop-line');
  const empty = root.querySelector('.g-empty');
  const tipEl = root.querySelector('.g-tip');
  let win = { from: -1, to: -1 };
  let cols = [];
  let editing = null;
  let released = false;
  let suppressClick = false;
  let clip = null; // last copied TSV (fallback when the clipboard event has no data)
  let cellDrag = null;
  let fillDrag = null;
  let fillPreview = null;
  let drag = null; // row drag by the # cell
  let autoScroll = 0; // px per frame while dragging near an edge
  let autoScrollX = 0;

  const rowH = () => app.rowH();
  const colDef = (key) => cols.find((x) => x.key === key);

  function canEdit(r, col) {
    if (!r) return false;
    if (r.kind === 'section') return col === 'name';
    const c = cols.find((x) => x.key === col);
    if (!c || !c.edit) return false;
    const summary = store.d.tree.isSummary(r.id);
    if (summary && (DATE_COLS.has(col) || col === 'status')) return false;
    if (r.milestone && col === 'finish') return false;
    return true;
  }

  function cellHTML(t, c, ctx) {
    const { tree } = store.d;
    const summary = tree.isSummary(t.id);
    switch (c.key) {
      case 'num':
        return `<button type="button" class="num-btn" data-act="card" tabindex="-1" title="Open task card · drag to move" aria-label="Open task card for ${esc(t.name || 'task')}">${esc(tree.outline.get(t.id))}</button>`;
      case 'name': {
        const tog = summary
          ? `<button type="button" class="tog" data-act="toggle" tabindex="-1" aria-expanded="${!t.collapsed}" aria-label="${t.collapsed ? 'Expand' : 'Collapse'} ${esc(t.name)}">${t.collapsed ? '▸' : '▾'}</button>`
          : '<span class="tog-sp"></span>';
        const done = store.d.done.has(t.id) ? '<span class="done-ck" title="Complete" aria-label="Complete">✓</span>' : '';
        return `<span class="ind" style="width:${t.level * 18}px"></span>${tog}${done}${t.milestone ? '<span class="ms-ic" title="Milestone">◆</span>' : ''}<span class="nm">${esc(t.name) || '<span class="muted">(untitled)</span>'}</span>${t.descHtml ? '<span class="has-desc" title="Has a description" aria-hidden="true">≡</span>' : ''}<button type="button" class="open-btn" data-act="card" tabindex="-1" title="Open task details (Enter)" aria-label="Open details for ${esc(t.name || 'task')}">↗</button>`;
      }
      case 'start':
        return esc(fmtDate(t.start, ctx.year));
      case 'finish':
        return esc(fmtDate(t.finish, ctx.year));
      case 'duration':
        return t.milestone ? '0d' : `${t.duration}d`;
      case 'progress':
        return `<span class="prog" aria-hidden="true"><span style="width:${t.progress}%"></span></span>${t.progress}%`;
      case 'owner':
        return esc(t.owner);
      case 'preds':
        return esc(predsText(t, tree));
      case 'status': {
        const s = summary ? rolledStatus(tree, t.id, store.plan) : t.status;
        return `<span class="pill opt st-${statusSlug(s)}" style="--opt:${esc(optionColor(store.plan, 'status', s))}">${esc(s)}</span>`;
      }
      case 'priority':
        return summary ? '' : `<span class="prio opt pr-${statusSlug(t.priority)}" style="--opt:${esc(optionColor(store.plan, 'priority', t.priority))}">${esc(t.priority)}</span>`;
      case 'workstream':
        return esc(t.workstream);
      case 'variance': {
        const v = variance(t);
        return v == null ? '' : `<span class="${v > 0 ? 'var-late' : v < 0 ? 'var-early' : ''}">${fmtVariance(v)}</span>`;
      }
      case 'id':
        return `#${t.id}`;
      default:
        return c.field ? customCell(t, c.field) : '';
    }
  }

  function customCell(t, f) {
    const v = t.values ? t.values[f.id] : undefined;
    if (f.type === 'checkbox') return `<span class="cf-chk" data-act="check" role="checkbox" aria-checked="${!!v}" aria-label="${esc(f.name)}">${v ? '☑' : '☐'}</span>`;
    if (v == null || v === '') return '';
    if (f.type === 'url') {
      const href = safeUrl(v);
      return href ? `<a class="cf-url" href="${esc(href)}" target="_blank" rel="noopener noreferrer" tabindex="-1" title="${esc(href)}">${esc(String(v).replace(/^https?:\/\//, ''))}</a>` : esc(v);
    }
    if (f.type === 'date') return esc(fmtDate(v, toYMD(parseISO(store.plan.start))[0]));
    return esc(formatValue(f, v));
  }

  // range outline / fill preview classes for cell (i, ci)
  function rgCls(i, ci, ctx) {
    let out = '';
    const g = ctx.rg;
    if (g && g.multi && i >= g.r1 && i <= g.r2 && ci >= g.c1 && ci <= g.c2) {
      out += ' rg';
      if (i === g.r1) out += ' rg-t';
      if (i === g.r2) out += ' rg-b';
      if (ci === g.c1) out += ' rg-l';
      if (ci === g.c2) out += ' rg-r';
    }
    const f = ctx.fill;
    if (f && i >= f.r1 && i <= f.r2 && ci >= f.c1 && ci <= f.c2) out += ' rg-fill';
    return out;
  }
  const fillHandle = (i, ci, ctx) => (ctx.rg && !store.readOnly && i === ctx.rg.r2 && ci === ctx.rg.c2 ? '<span class="fill-h" data-act="fill" title="Drag down to fill (or Ctrl+D)" aria-hidden="true"></span>' : '');

  function rowHTML(r, i, ctx) {
    const s = store;
    const { tree } = s.d;
    const top = i * rowH();
    const sel = s.selection.has(r.id);
    const act = s.active && s.active.id === r.id ? s.active.col : null;
    if (r.kind === 'section') {
      const n = ctx.sectionCounts.get(r.id) || 0;
      return `<div class="gr section${sel ? ' sel' : ''}" role="row" aria-selected="${sel}" data-id="${r.id}" style="top:${top}px;--sec:${r.color}">
<div class="gc c-num pin${act === 'num' ? ' act' : ''}${rgCls(i, 0, ctx)}" data-col="num" role="gridcell" id="gc-${r.id}-num"><span class="drag" title="Drag to move section" aria-hidden="true">⋮⋮</span></div>
<div class="gc sec-body${act && act !== 'num' ? ' act' : ''}${ctx.rg && ctx.rg.c2 >= 1 ? rgCls(i, Math.max(1, ctx.rg.c1), ctx) : ''}" data-col="name" role="gridcell" id="gc-${r.id}-name"><button type="button" class="tog" data-act="toggle" tabindex="-1" aria-expanded="${!r.collapsed}" aria-label="${r.collapsed ? 'Expand' : 'Collapse'} section ${esc(r.name)}">${r.collapsed ? '▸' : '▾'}</button><button type="button" class="swatch edit-only" data-act="color" tabindex="-1" style="background:${r.color}" aria-label="Change colour of section ${esc(r.name)}"></button><span class="nm">${esc(r.name)}</span><span class="sec-count">${n} task${n === 1 ? '' : 's'}</span><button type="button" class="btn ic sec-menu edit-only" data-act="sec-menu" tabindex="-1" aria-label="Section actions for ${esc(r.name)}">⋯</button></div></div>`;
    }
    const summary = tree.isSummary(r.id);
    const done = s.d.done.has(r.id);
    const cls = ['gr', 'task', summary ? 'sum' : '', sel ? 'sel' : '', done ? 'done' : '', ctx.critical && ctx.critical.tasks.has(r.id) ? 'crit' : '', !done && isOverdue(r, ctx.day, s.plan) && !summary ? 'overdue' : '']
      .filter(Boolean)
      .join(' ');
    const tint = s.d.sectionColor.get(r.id);
    const stColor = cols.some((c) => c.key === 'status') ? optionColor(s.plan, 'status', summary ? rolledStatus(tree, r.id, s.plan) : r.status) : '';
    const cells = cols
      .map(
        (c, ci) =>
          `<div class="gc c-${c.key}${c.fixed ? ' pin' : ''}${c.field ? ' c-cf' : ''}${c.align === 'r' ? ' r' : c.align === 'c' ? ' c' : ''}${c.key === 'status' ? ' tinted' : ''}${act === c.key ? ' act' : ''}${rgCls(i, ci, ctx)}" data-col="${c.key}" role="gridcell" id="gc-${r.id}-${c.key}"${c.key === 'status' ? ` style="--opt:${esc(stColor)}"` : ''}>${cellHTML(r, c, ctx)}${fillHandle(i, ci, ctx)}</div>`
      )
      .join('');
    return `<div class="${cls}" role="row" aria-selected="${sel}" aria-level="${r.level + 1}" data-id="${r.id}" style="top:${top}px${tint ? `;--tint:${tint}` : ''}">${cells}</div>`;
  }

  function render() {
    cols = visibleColumns(store.plan);
    const tmpl = cols.map((c) => `${c.width}px`).join(' ');
    const total = cols.reduce((a, c) => a + c.width, 0);
    root.style.setProperty('--gcols', tmpl);
    root.style.setProperty('--gwidth', `${total}px`);
    root.style.setProperty('--rowh', `${rowH()}px`);
    root.style.setProperty('--pinw', `${cols[0] && cols[0].key === 'num' ? cols[0].width : 0}px`);
    head.innerHTML = cols
      .map(
        (c) =>
          `<div class="gh${c.fixed ? ' pin' : ''}${c.align === 'r' ? ' r' : ''}${c.field ? ' gh-cf' : ''}" data-col="${c.key}" role="columnheader"${c.fixed ? '' : ` draggable="true"`} title="${esc(c.title ? `${c.title} · ` : '')}${c.fixed ? 'Right-click for column options' : 'Drag to reorder · right-click for options'}"><span class="gh-l">${esc(c.label)}</span>${c.key !== 'num' ? `<span class="rs" data-rs="${c.key}" title="Drag to resize" aria-hidden="true"></span>` : ''}</div>`
      )
      .join('');
    const n = store.d.visible.length;
    body.style.height = `${n * rowH() + 40}px`;
    empty.hidden = n > 0;
    if (!n) empty.innerHTML = store.d.matches ? 'No tasks match the filter.' : 'This plan is empty. Press <kbd>Insert</kbd> or “+ Task” to add a task.';
    renderWindow(true);
  }

  function renderWindow(force) {
    const h = rowH();
    const n = store.d.visible.length;
    const first = Math.floor(scroll.scrollTop / h);
    const from = Math.max(0, first - OVERSCAN);
    const to = Math.min(n, first + Math.ceil(scroll.clientHeight / h) + OVERSCAN);
    if (!force && from === win.from && to === win.to) return;
    if (editing) finishEdit(true);
    win = { from, to };
    const ctx = {
      year: toYMD(parseISO(store.plan.start))[0],
      day: statusDay(store.plan),
      critical: store.d.critical,
      sectionCounts: sectionCounts(),
      rg: range(),
      fill: fillPreview,
    };
    if (ctx.rg) ctx.rg.multi = rangeSize(ctx.rg) > 1;
    const out = [];
    for (let i = from; i < to; i++) out.push(rowHTML(store.d.visible[i], i, ctx));
    rowsEl.innerHTML = out.join('');
    const a = store.active;
    if (a && store.d.indexOf.has(a.id)) {
      const sec = store.d.tree.byId.get(a.id).kind === 'section';
      body.setAttribute('aria-activedescendant', `gc-${a.id}-${sec ? (a.col === 'num' ? 'num' : 'name') : a.col}`);
    }
    else body.removeAttribute('aria-activedescendant');
    if (drag && drag.started) paintDrop();
  }

  let countsCache = null;
  function sectionCounts() {
    if (countsCache && countsCache.d === store.d) return countsCache.m;
    const m = new Map();
    for (const t of store.d.tree.tasks) {
      const sid = store.d.tree.sectionOf.get(t.id);
      if (sid != null) m.set(sid, (m.get(sid) || 0) + 1);
    }
    countsCache = { d: store.d, m };
    return m;
  }

  /** Scroll so the row (and the cell in `col`, default the active column) is fully visible. */
  function ensureVisible(id, col = store.active && store.active.id === id ? store.active.col : null) {
    const i = store.d.indexOf.get(id);
    if (i == null) return;
    const h = rowH();
    const widths = cols.map((c) => c.width);
    const pinned = cols.filter((c) => c.fixed).length;
    const ci = col ? cols.findIndex((c) => c.key === col) : -1;
    const section = store.d.visible[i].kind === 'section';
    const box = ci >= 0 ? columnBox(widths, ci) : { left: 0, width: 0 };
    const next = revealCell(
      { top: scroll.scrollTop, left: scroll.scrollLeft, width: scroll.clientWidth, height: scroll.clientHeight },
      { top: HEAD_H + i * h, height: h, left: box.left, width: box.width },
      { top: HEAD_H, left: pinnedWidth(widths, pinned), pinned: section || ci < pinned }
    );
    if (next.top !== Math.round(scroll.scrollTop)) scroll.scrollTop = next.top;
    if (next.left !== Math.round(scroll.scrollLeft)) scroll.scrollLeft = next.left;
    renderWindow();
  }

  // ---- cell range ----------------------------------------------------------
  const colIndex = (key) => Math.max(0, cols.findIndex((c) => c.key === key));
  /** Current cell range { r1, c1, r2, c2 } (visible row / column indices) or null. */
  function range() {
    const a = store.active;
    if (!a || !store.d.indexOf.has(a.id) || !cols.length) return null;
    const an = store.cellAnchor && store.d.indexOf.has(store.cellAnchor.id) ? store.cellAnchor : a;
    return normRange({ r: store.d.indexOf.get(an.id), c: colIndex(an.col) }, { r: store.d.indexOf.get(a.id), c: colIndex(a.col) });
  }
  /** Select range g with the active cell at its top-left. */
  function setRange(g) {
    const vis = store.d.visible;
    if (!vis[g.r1] || !vis[g.r2]) return;
    store.anchor = vis[g.r2].id;
    store.cellAnchor = { id: vis[g.r2].id, col: cols[g.c2].key };
    app.select(vis[g.r1].id, { extend: true, col: cols[g.c1].key, keepCard: true });
    ensureVisible(vis[g.r1].id);
  }
  const labels = () => Object.fromEntries(cols.map((c) => [c.key, columnLabel(c)]));
  function rangeTSV(g) {
    const out = [];
    for (let r = g.r1; r <= g.r2; r++) out.push(cols.slice(g.c1, g.c2 + 1).map((c) => cellText(store.plan, store.d.tree, store.d.visible[r], c.key)));
    return toTSV(out);
  }
  /** Apply [{ r, c, value }] as ONE undoable step; one toast lists skipped cells. */
  function applyCells(label, cells, after, quiet = []) {
    if (store.readOnly) return store.emit('readonly');
    const vis = store.d.visible;
    const edits = cells.filter((x) => vis[x.r] && cols[x.c]).map((x) => ({ id: vis[x.r].id, col: cols[x.c].key, value: x.value }));
    if (!edits.length) return undefined;
    const lb = labels();
    let res = null;
    store.commit(label, (plan) => {
      res = applyCellEdits(plan, edits, lb);
      return res.applied ? undefined : false;
    });
    if (after) setRange(after);
    const skipped = res ? res.skipped.filter((x) => !quiet.includes(x.kind)) : [];
    if (skipped.length) app.toast(skipSummary(skipped, lb), 'warn', 7000);
    return undefined;
  }
  function pasteText(text) {
    const g = range();
    if (!g || text == null || text === '') return;
    const block = parseTSV(text);
    const { cells, range: out } = pasteTargets(block, g, store.d.visible.length, cols.length);
    applyCells(cells.length > 1 ? `Paste ${cells.length} cells` : 'Paste', cells, out);
  }
  function clearRange() {
    const g = range();
    if (!g) return;
    const cells = [];
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) cells.push({ r, c, value: '' });
    applyCells('Clear cells', cells, null, ['section', 'rollup', 'readonly', 'required']);
  }
  function fromCells(targets) {
    return targets.map((x) => ({ r: x.r, c: x.c, value: cellText(store.plan, store.d.tree, store.d.visible[x.from.r], cols[x.from.c].key) }));
  }
  function fillDown() {
    const g = range();
    if (!g) return;
    const t = fillDownTargets(g);
    if (!t.length) return;
    applyCells('Fill down', fromCells(t), g.r1 === g.r2 ? null : g);
  }
  /** Visible row / column index under a pointer position (pinned columns accounted for). */
  function cellAt(x, y) {
    const sr = scroll.getBoundingClientRect();
    const n = store.d.visible.length;
    const r = Math.max(0, Math.min(n - 1, Math.floor((y - sr.top - HEAD_H + scroll.scrollTop) / rowH())));
    const widths = cols.map((c) => c.width);
    const pin = pinnedWidth(widths, cols.filter((c) => c.fixed).length);
    const px = x - sr.left;
    const cx = px < pin ? px : px + scroll.scrollLeft;
    let c = 0;
    for (let acc = 0; c < cols.length - 1 && acc + widths[c] <= cx; c++) acc += widths[c];
    return { r, c };
  }
  function edgeScroll(x, y, horizontal = true) {
    const sr = scroll.getBoundingClientRect();
    autoScroll = edgeSpeed(y, sr.top + HEAD_H, sr.bottom, 36);
    autoScrollX = horizontal ? edgeSpeed(x, sr.left, sr.right, 24) : 0;
  }

  // ---- editing -----------------------------------------------------------
  function rawValue(r, col) {
    if (r.kind === 'section') return r.name;
    const cf = colDef(col);
    if (cf && cf.field) {
      const v = r.values ? r.values[cf.field.id] : undefined;
      return cf.field.type === 'date' || cf.field.type === 'select' ? v || '' : formatValue(cf.field, v);
    }
    switch (col) {
      case 'preds':
        return predsText(r, store.d.tree);
      case 'duration':
      case 'progress':
        return String(r[col]);
      default:
        return r[col] == null ? '' : String(r[col]);
    }
  }

  function startEdit(id, col, initial, opts = {}) {
    const r = store.d.tree.byId.get(id);
    if (!r) return;
    if (!canEdit(r, col)) {
      if (isTask(r) && store.d.tree.isSummary(id) && (DATE_COLS.has(col) || col === 'status')) app.toast('Summary tasks roll up dates, progress and status from their subtasks.');
      return;
    }
    if (store.readOnly) {
      store.emit('readonly');
      return;
    }
    ensureVisible(id);
    const cell = rowsEl.querySelector(`.gr[data-id="${id}"] [data-col="${col}"]`);
    if (!cell) return;
    let input;
    const orig = rawValue(r, col);
    const field = colDef(col) && colDef(col).field;
    if (field && field.type === 'checkbox') return toggleCheck(id, col);
    if (col === 'status' || col === 'priority' || (field && field.type === 'select')) {
      input = document.createElement('select');
      const list = field ? ['', ...field.options] : col === 'status' ? statusNames(store.plan) : priorityNames(store.plan);
      input.innerHTML = list.map((s) => `<option${s === orig ? ' selected' : ''}>${esc(s)}</option>`).join('');
    } else if (field) {
      input = document.createElement('input');
      input.type = field.type === 'date' ? 'date' : 'text';
      if (field.type === 'number') input.inputMode = 'decimal';
      if (field.type === 'url') input.placeholder = 'https://';
      input.value = initial != null ? initial : orig;
    } else {
      input = document.createElement('input');
      input.type = col === 'start' || col === 'finish' ? 'date' : 'text';
      input.value = initial != null ? initial : orig;
      if (col === 'preds') input.placeholder = 'e.g. 3, 1.2FS+2d';
    }
    input.className = 'ed';
    input.setAttribute('aria-label', `Edit ${col}`);
    input.spellcheck = false;
    editing = { id, col, input, orig, field };
    cell.classList.add('editing');
    if (r.kind === 'section' || col === 'name') {
      const nm = cell.querySelector('.nm');
      nm.replaceWith(input);
    } else {
      cell.textContent = '';
      cell.appendChild(input);
    }
    input.focus();
    if (initial == null && input.select) input.select();
    // Option list open straight away; needs the click / key press's user activation.
    if (opts.pick && input.tagName === 'SELECT' && typeof input.showPicker === 'function') {
      try {
        input.showPicker();
      } catch {
        // no activation or unsupported: the focused select opens with Space / Alt+↓ / click
      }
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finishEdit(true, e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finishEdit(false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        finishEdit(true, 0, e.shiftKey ? -1 : 1);
      }
    });
    input.addEventListener('blur', () => finishEdit(true, 0, 0, true));
    if (input.tagName === 'SELECT') input.addEventListener('change', () => finishEdit(true));
  }

  function finishEdit(save, dRow = 0, dCol = 0, fromBlur = false) {
    const ed = editing;
    if (!ed) return;
    editing = null;
    const v = ed.input.value;
    if (save && v !== ed.orig) {
      store.commit(`Edit ${ed.col}`, (plan) => {
        const t = plan.rows.find((x) => x.id === ed.id);
        if (!t) return false;
        if (t.kind === 'section') {
          const name = v.trim();
          if (!name) return 'Section name cannot be empty.';
          t.name = name.slice(0, 300);
          return undefined;
        }
        if (ed.col === 'preds') {
          const errs = setPredsFromText(plan.rows, t.id, v);
          if (errs.length) setTimeout(() => app.toast(errs.join(' '), 'error', 7000));
          return undefined;
        }
        if (ed.field) {
          const f = findField(plan, ed.field.id);
          return f ? setFieldValue(t, f, v) || undefined : false;
        }
        if (ed.col === 'name' && !v.trim()) return 'Task name cannot be empty.';
        return setTaskField(t, ed.col, v, undefined, plan) || undefined;
      });
    } else renderWindow(true);
    if (!fromBlur) {
      body.focus({ preventScroll: true });
      if (dRow || dCol) move(dRow, dCol, false);
    }
  }

  function toggleCheck(id, col) {
    const c = colDef(col);
    if (!c || !c.field || store.readOnly) return store.readOnly ? store.emit('readonly') : undefined;
    const r = store.d.tree.byId.get(id);
    if (!r || r.kind === 'section') return undefined;
    return store.commit(`Edit ${c.field.name}`, (plan) => {
      const t = plan.rows.find((x) => x.id === id);
      const f = findField(plan, c.field.id);
      if (!t || !f) return false;
      return setFieldValue(t, f, !(t.values && t.values[f.id])) || undefined;
    });
  }

  // ---- selection & keyboard ---------------------------------------------
  function move(dRow, dCol, extend) {
    const vis = store.d.visible;
    if (!vis.length) return;
    const keys = cols.map((c) => c.key);
    const a = store.active && store.d.indexOf.has(store.active.id) ? store.active : { id: vis[0].id, col: 'name' };
    let i = store.d.indexOf.get(a.id);
    let ci = Math.max(0, keys.indexOf(a.col));
    i = Math.max(0, Math.min(vis.length - 1, i + dRow));
    ci = Math.max(0, Math.min(keys.length - 1, ci + dCol));
    const r = vis[i];
    app.select(r.id, { extend, col: keys[ci], keepCard: true });
    ensureVisible(r.id, keys[ci]);
  }

  body.addEventListener('keydown', (e) => {
    if (e.target !== body) return;
    const vis = store.d.visible;
    const a = store.active && store.d.indexOf.has(store.active.id) ? store.active : null;
    const r = a ? store.d.tree.byId.get(a.id) : null;
    const k = e.key;
    const page = Math.max(1, Math.floor((scroll.clientHeight - HEAD_H) / rowH()) - 1);
    if (k !== 'Tab' && k !== 'Shift') released = false;
    const decide = () => {
      const c = colDef(a.col);
      const section = r.kind === 'section';
      return keyAction({
        key: k, mod: mod(e), alt: e.altKey, shift: e.shiftKey, col: a.col, section,
        editable: !store.readOnly && canEdit(r, section ? 'name' : a.col),
        editKind: c ? c.edit || 'text' : 'text',
      });
    };
    const doKey = (what) => {
      if (what === 'edit') {
        const c = colDef(a.col);
        return startEdit(r.id, r.kind === 'section' ? 'name' : a.col, undefined, { pick: r.kind !== 'section' && !!c && c.edit === 'select' });
      }
      if (what === 'open') return app.openCard(r.id);
      if (what === 'toggle-check') return toggleCheck(r.id, a.col);
      if (what === 'type') return startEdit(r.id, a.col, k);
      return undefined;
    };
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (!a && vis.length && /^Arrow|Home|End|Page/.test(k)) {
      handled();
      return app.select(vis[0].id, { col: 'name' });
    }
    if (mod(e) && !e.altKey && a) {
      const lk = k.toLowerCase();
      if (lk === 'd') {
        handled();
        return fillDown();
      }
      if (lk === 'a') {
        handled();
        return vis.length && cols.length ? setRange({ r1: 0, c1: 0, r2: vis.length - 1, c2: cols.length - 1 }) : undefined;
      }
    }
    switch (k) {
      case 'ArrowDown':
      case 'ArrowUp':
        handled();
        if (e.altKey && e.shiftKey) return app.moveSelection(k === 'ArrowUp' ? -1 : 1);
        return move(k === 'ArrowDown' ? 1 : -1, 0, e.shiftKey);
      case 'ArrowLeft':
      case 'ArrowRight':
        handled();
        if (e.altKey && r) {
          const isCollapsible = r.kind === 'section' || store.d.tree.isSummary(r.id);
          if (isCollapsible && !!r.collapsed !== (k === 'ArrowLeft')) app.toggleCollapse(r.id);
          return undefined;
        }
        return move(0, k === 'ArrowRight' ? 1 : -1, e.shiftKey);
      case 'Home':
      case 'End':
        handled();
        return mod(e) ? move(k === 'Home' ? -1e9 : 1e9, 0, e.shiftKey) : move(0, k === 'Home' ? -1e9 : 1e9, e.shiftKey);
      case 'PageDown':
      case 'PageUp':
        handled();
        return move(k === 'PageDown' ? page : -page, 0, e.shiftKey);
      case 'Enter':
        handled();
        if (mod(e)) return app.addTask();
        return r ? doKey(decide()) : undefined;
      case 'F2':
        handled();
        return r ? doKey(decide()) : undefined;
      case 'Insert':
        handled();
        return e.shiftKey ? app.addSection() : app.addTask();
      case 'Delete':
      case 'Backspace':
        handled();
        // the # column (row handles) or Ctrl+Delete removes rows; elsewhere Delete clears the cells
        if (mod(e) || (a && a.col === 'num')) return app.deleteSelection();
        return clearRange();
      case 'Tab':
        if (released || !a) return undefined;
        handled();
        return e.shiftKey ? app.outdent() : app.indent();
      case 'Escape': {
        const g = range();
        if (g && rangeSize(g) > 1) {
          handled();
          store.cellAnchor = { ...a };
          store.anchor = a.id;
          return app.select(a.id, { col: a.col, keepCard: true });
        }
        released = true;
        if (store.cardId != null) {
          handled();
          return app.closeCard();
        }
        return app.toast('Grid released: Tab now moves focus out of the grid.', 'info', 2000);
      }
      case ' ': {
        const what = r ? decide() : null;
        if (what === 'toggle-check' || what === 'edit') {
          handled();
          return doKey(what);
        }
        if (r && (r.kind === 'section' || store.d.tree.isSummary(r.id))) {
          handled();
          return app.toggleCollapse(r.id);
        }
        return undefined;
      }
      case 'ContextMenu':
        if (!r) return undefined;
        handled();
        return openRowMenu(r.id, rowsEl.querySelector(`.gr[data-id="${r.id}"] [data-col="${a.col}"]`) || body);
      default:
        if (r && k === 'F10' && e.shiftKey) {
          handled();
          return openRowMenu(r.id, rowsEl.querySelector(`.gr[data-id="${r.id}"] [data-col="${a.col}"]`) || body);
        }
        if (r && decide() === 'type') {
          handled();
          return doKey('type');
        }
    }
    return undefined;
  });
  body.addEventListener('focus', () => {
    released = false;
    if (!store.active && store.d.visible.length) app.select(store.d.visible[0].id, { col: 'name', keepCard: true });
  });

  // ---- clipboard: TSV like Excel / Sheets -----------------------------------
  // Chrome dispatches copy / paste at document.body when the focused element
  // is not editable, so listen on the document while the grid has focus.
  const gridFocused = () => document.activeElement === body && !editing;
  function copyRange(e) {
    if (!gridFocused()) return false;
    const g = range();
    if (!g) return false;
    const text = rangeTSV(g);
    e.preventDefault();
    if (e.clipboardData) e.clipboardData.setData('text/plain', text);
    clip = text;
    const n = rangeSize(g);
    app.toast(`Copied ${n} cell${n === 1 ? '' : 's'}.`, 'info', 1500);
    return true;
  }
  document.addEventListener('copy', copyRange);
  document.addEventListener('cut', (e) => {
    if (!gridFocused()) return undefined;
    if (store.readOnly) return store.emit('readonly');
    if (copyRange(e)) clearRange();
    return undefined;
  });
  document.addEventListener('paste', (e) => {
    if (!gridFocused()) return;
    e.preventDefault();
    // The grid's own copy is only a fallback for browsers without clipboardData;
    // a system clipboard holding non-text (an image, files) pastes nothing.
    if (!e.clipboardData) return pasteText(clip);
    const text = e.clipboardData.getData('text/plain');
    if (text) pasteText(text);
    else app.toast('The clipboard holds no text to paste.', 'info', 3000);
    return undefined;
  });

  // ---- mouse ---------------------------------------------------------------
  // Double-click detection uses the click count of the *second* click
  // (event.detail === 2) instead of the dblclick event: the first click selects
  // the row, which re-renders it, so a native dblclick would target a node that
  // is no longer in the document and never fire.
  rowsEl.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    let target = e.target;
    // Closing an open editor on mousedown re-renders the rows, so the click can land
    // on the rows container instead of the cell under the pointer.
    if (!target.closest('.gr')) {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      if (under && rowsEl.contains(under)) target = under;
    }
    const rowEl = target.closest('.gr');
    if (!rowEl || target.closest('.ed')) return;
    if (target.closest('a[href]')) return;
    const id = Number(rowEl.dataset.id);
    const actEl = target.closest('[data-act]');
    const cell = target.closest('[data-col]');
    const act = actEl && actEl.dataset.act;
    if (act === 'toggle') return app.toggleCollapse(id);
    if (act === 'color') return app.sectionColor(id, actEl);
    if (act === 'sec-menu') return app.sectionMenu(id, actEl);
    const r = store.d.tree.byId.get(id);
    const col = cell ? cell.dataset.col : 'name';
    const section = !!r && r.kind === 'section';
    const c = colDef(col);
    const editKind = c ? c.edit || null : null;
    const what = clickAction({ detail: e.detail, act, editable: !store.readOnly && canEdit(r, section ? 'name' : col), section, editKind, extend: e.shiftKey || mod(e) });
    if (what === 'edit') {
      const pick = !section && editKind === 'select';
      if (pick && e.detail === 1) app.select(id, { col, keepCard: true });
      return startEdit(id, section ? 'name' : col, undefined, { pick });
    }
    if (what === 'check') {
      if (e.detail > 1) return undefined;
      app.select(id, { col, keepCard: true });
      return toggleCheck(id, col);
    }
    if (what === 'open') {
      if (r && r.kind !== 'section') return app.openCard(id, { focus: act === 'card' });
      return undefined;
    }
    if (e.detail > 1) return undefined;
    app.select(id, { extend: e.shiftKey, toggle: mod(e), col, keepCard: true });
    body.focus({ preventScroll: true });
    ensureVisible(id, col);
    return undefined;
  });

  function openRowMenu(id, at) {
    hideTip();
    if (!store.selection.has(id)) app.select(id, { keepCard: true });
    app.rowMenu(id, at);
  }
  rowsEl.addEventListener('contextmenu', (e) => {
    const rowEl = e.target.closest('.gr');
    if (!rowEl || e.target.closest('.ed') || isTyping(e)) return;
    e.preventDefault();
    const cell = e.target.closest('[data-col]');
    const id = Number(rowEl.dataset.id);
    if (!store.selection.has(id)) app.select(id, { col: cell ? cell.dataset.col : 'name', keepCard: true });
    openRowMenu(id, { x: e.clientX, y: e.clientY });
  });

  // hover preview: first lines of the description (text only, never HTML)
  let tipTimer = 0;
  let tipId = null;
  function hideTip() {
    clearTimeout(tipTimer);
    tipId = null;
    tipEl.hidden = true;
  }
  rowsEl.addEventListener('mouseover', (e) => {
    const nameCell = e.target.closest('.gr.task .c-name');
    const id = nameCell ? Number(nameCell.closest('.gr').dataset.id) : null;
    if (id === tipId) return;
    hideTip();
    if (id == null || drag || editing) return;
    const t = store.d.tree.byId.get(id);
    const text = t ? descText(t) : '';
    if (!text) return;
    tipId = id;
    tipTimer = setTimeout(() => {
      const lines = text.split('\n').filter((l) => l.trim()).slice(0, 4);
      tipEl.textContent = '';
      const h = document.createElement('b');
      h.textContent = t.name;
      tipEl.appendChild(h);
      for (const l of lines) {
        const d = document.createElement('div');
        d.textContent = l.length > 160 ? `${l.slice(0, 159)}…` : l;
        tipEl.appendChild(d);
      }
      const rb = nameCell.getBoundingClientRect();
      const pb = root.getBoundingClientRect();
      tipEl.style.left = `${Math.max(4, rb.left - pb.left + 24)}px`;
      tipEl.style.top = `${rb.bottom - pb.top + 2}px`;
      tipEl.hidden = false;
    }, 450);
  });
  rowsEl.addEventListener('mouseleave', hideTip);
  scroll.addEventListener('scroll', hideTip, { passive: true });

  // header: right-click menu, drag to reorder
  head.addEventListener('contextmenu', (e) => {
    const h = e.target.closest('.gh');
    if (!h) return;
    e.preventDefault();
    app.columnsMenu({ x: e.clientX, y: e.clientY }, h.dataset.col);
  });
  let colDrag = null;
  const clearMarks = () => head.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  head.addEventListener('dragstart', (e) => {
    const h = e.target.closest('.gh[draggable="true"]');
    if (!h) return;
    colDrag = h.dataset.col;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-planboard-col', colDrag);
    h.classList.add('dragging');
  });
  const dropSpot = (e) => {
    const h = e.target.closest('.gh');
    if (!h || !colDrag) return null;
    const c = colDef(h.dataset.col);
    if (!c) return null;
    if (c.fixed) {
      const first = cols.find((x) => !x.fixed);
      return first ? { el: head.querySelector(`.gh[data-col="${first.key}"]`), before: first.key, side: 'before' } : null;
    }
    const b = h.getBoundingClientRect();
    const after = e.clientX > b.left + b.width / 2;
    const i = cols.indexOf(c);
    const next = cols.slice(i + 1).find((x) => !x.fixed);
    return { el: h, before: after ? (next ? next.key : null) : c.key, side: after ? 'after' : 'before' };
  };
  head.addEventListener('dragover', (e) => {
    const spot = dropSpot(e);
    if (!spot) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearMarks();
    if (spot.el) spot.el.classList.add(`drop-${spot.side}`);
  });
  head.addEventListener('drop', (e) => {
    const spot = dropSpot(e);
    clearMarks();
    if (!spot) return;
    e.preventDefault();
    const key = colDrag;
    colDrag = null;
    if (spot.before === key) return;
    store.commit('Move column', (plan) => (moveColumnTo(plan, key, spot.before) ? undefined : false), { touch: false, schedule: false });
  });
  head.addEventListener('dragend', () => {
    colDrag = null;
    clearMarks();
    head.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
  });

  // ---- drags: rows by the # cell, cell ranges, the fill handle ---------------
  // While any of them is pending the grid body is user-select:none and
  // selectstart is cancelled, so no native text selection runs alongside.
  let lastPoint = null;
  let ticker = 0;
  let swallowNextClick = false; // a drag cancelled with Esc while the button is still down
  const anyDrag = () => !!(drag || cellDrag || fillDrag);
  const dragRunning = () => !!((drag && drag.started) || (cellDrag && cellDrag.started) || fillDrag);
  function armDrag() {
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
    body.classList.add('no-select');
  }
  function disarm() {
    if (anyDrag()) return;
    body.classList.remove('no-select');
    autoScroll = 0;
    autoScrollX = 0;
  }
  function capture(e) {
    try {
      if (!body.hasPointerCapture(e.pointerId)) body.setPointerCapture(e.pointerId);
    } catch {
      // pointer already released
    }
  }
  const afterDrag = () => {
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
  };
  body.addEventListener('selectstart', (e) => {
    const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (anyDrag() && !(el && el.closest('.ed'))) e.preventDefault();
  });

  rowsEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.ed')) return;
    if (e.target.closest('.fill-h')) {
      e.preventDefault();
      const g = range();
      if (!g || store.readOnly) return;
      fillDrag = { g, to: g.r2 };
      armDrag();
      body.classList.add('cell-drag');
      capture(e);
      return;
    }
    const num = e.target.closest('.c-num');
    if (num) {
      // the press would otherwise start a native text selection across the rows
      e.preventDefault();
      if (store.readOnly) return;
      hideTip();
      drag = { id: Number(num.closest('.gr').dataset.id), x: e.clientX, y: e.clientY, started: false, target: null, zone: null };
      armDrag();
      return;
    }
    const cell = e.target.closest('[data-col]');
    if (!cell || e.target.closest('[data-act], a[href]') || e.shiftKey || mod(e)) return;
    const rowEl = cell.closest('.gr');
    cellDrag = { id: Number(rowEl.dataset.id), col: cell.dataset.col, started: false, last: null };
    armDrag();
  });
  function dropTarget(clientX, clientY) {
    // beside the grid (e.g. over the Gantt) there is no drop target: releasing there cancels
    const sr = scroll.getBoundingClientRect();
    if (clientX < sr.left || clientX > sr.right) return null;
    const vis = store.d.visible;
    const tree = store.d.tree;
    const y = clientY - body.getBoundingClientRect().top;
    const z = dropZone(y, rowH(), vis.length, (i) => isTask(vis[i]), drag.zone);
    drag.zone = z;
    const r = z && vis[z.i];
    if (!r || drag.moving.has(r.id)) return null;
    let pos = z.zone;
    if (pos === 'after' && isTask(r) && tree.isSummary(r.id) && !r.collapsed) pos = 'firstchild';
    if (pos === 'after' && !isTask(r) && !r.collapsed) pos = 'before-next';
    return { r, i: z.i, pos };
  }
  function paintDrop() {
    const t = drag && drag.started ? drag.target : null;
    rowsEl.querySelectorAll('.drop-in').forEach((n) => n.classList.remove('drop-in'));
    if (!t) {
      dropLine.hidden = true;
    } else if (t.pos === 'inside') {
      dropLine.hidden = true;
      const n = rowsEl.querySelector(`.gr[data-id="${t.r.id}"]`);
      if (n) n.classList.add('drop-in');
    } else {
      const h = rowH();
      const lvl = t.pos === 'firstchild' ? t.r.level + 1 : isTask(t.r) ? t.r.level : 0;
      dropLine.hidden = false;
      dropLine.style.top = `${(t.pos === 'before' ? t.i : t.i + 1) * h - 1}px`;
      dropLine.style.left = `${(cols[0] ? cols[0].width : 0) + lvl * 18 + 16}px`;
    }
  }
  /** Follow the pointer (also called after an auto-scroll step with the last position). */
  function dragTo(x, y) {
    if (fillDrag) {
      const { r } = cellAt(x, y);
      const to = Math.max(fillDrag.g.r2, r);
      if (to === fillDrag.to) return;
      fillDrag.to = to;
      fillPreview = to > fillDrag.g.r2 ? { r1: fillDrag.g.r2 + 1, r2: to, c1: fillDrag.g.c1, c2: fillDrag.g.c2 } : null;
      renderWindow(true);
      return;
    }
    if (cellDrag && cellDrag.started) {
      const { r, c } = cellAt(x, y);
      const vis = store.d.visible;
      const key = cols[c] ? cols[c].key : 'name';
      const here = `${r}:${key}`;
      if (here === cellDrag.last || !vis[r]) return;
      cellDrag.last = here;
      app.select(vis[r].id, { extend: true, col: key, keepCard: true });
      return;
    }
    if (drag && drag.started) {
      const t = dropTarget(x, y);
      const prev = drag.target;
      drag.target = t;
      if (!t || !prev || t.r !== prev.r || t.pos !== prev.pos) paintDrop();
    }
  }
  function startTicker() {
    if (ticker) return;
    const step = () => {
      ticker = 0;
      if (!dragRunning()) return;
      const top = scroll.scrollTop;
      const left = scroll.scrollLeft;
      if (autoScroll) scroll.scrollTop = top + autoScroll;
      if (autoScrollX && !drag) scroll.scrollLeft = left + autoScrollX;
      if (lastPoint && (scroll.scrollTop !== top || scroll.scrollLeft !== left)) {
        renderWindow();
        dragTo(lastPoint.x, lastPoint.y);
      }
      ticker = requestAnimationFrame(step);
    };
    ticker = requestAnimationFrame(step);
  }
  window.addEventListener('pointermove', (e) => {
    if (!anyDrag()) return;
    if (!(e.buttons & 1)) {
      // the release happened where we could not see it (e.g. outside the window)
      endCellDrag(true);
      endDrag(true);
      return;
    }
    lastPoint = { x: e.clientX, y: e.clientY };
    if (fillDrag) {
      edgeScroll(e.clientX, e.clientY);
      startTicker();
      dragTo(e.clientX, e.clientY);
      return;
    }
    if (cellDrag) {
      if (!cellDrag.started) {
        const { r, c } = cellAt(e.clientX, e.clientY);
        const vis = store.d.visible;
        const key = cols[c] ? cols[c].key : 'name';
        if (!vis[r] || (vis[r].id === cellDrag.id && (key === cellDrag.col || vis[r].kind === 'section'))) return;
        cellDrag.started = true;
        armDrag();
        body.classList.add('cell-drag');
        capture(e);
        app.select(cellDrag.id, { col: cellDrag.col, keepCard: true });
        body.focus({ preventScroll: true });
      }
      edgeScroll(e.clientX, e.clientY);
      startTicker();
      dragTo(e.clientX, e.clientY);
      return;
    }
    if (!drag.started) {
      if (Math.abs(e.clientY - drag.y) + Math.abs(e.clientX - drag.x) < 6) return;
      drag.started = true;
      armDrag();
      capture(e);
      if (!store.selection.has(drag.id)) app.select(drag.id, { keepCard: true });
      const ids = [...store.selection];
      const tree = store.d.tree;
      const moving = new Set(ids);
      for (const id of ids) if (isTask(tree.byId.get(id))) for (const dd of descendantsOf(tree, id)) moving.add(dd);
      drag.ids = ids;
      drag.moving = moving;
      root.classList.add('dragging');
      body.focus({ preventScroll: true });
    }
    edgeScroll(e.clientX, e.clientY, false);
    startTicker();
    dragTo(e.clientX, e.clientY);
  });
  function endCellDrag(cancel) {
    body.classList.remove('cell-drag');
    if (fillDrag) {
      const { g, to } = fillDrag;
      fillDrag = null;
      fillPreview = null;
      disarm();
      afterDrag();
      if (cancel || to <= g.r2) return renderWindow(true);
      return applyCells('Fill', fromCells(fillHandleTargets(g, to)), { r1: g.r1, c1: g.c1, r2: to, c2: g.c2 });
    }
    if (cellDrag) {
      const started = cellDrag.started;
      cellDrag = null;
      if (started) afterDrag();
    }
    disarm();
    return undefined;
  }
  function endDrag(cancel) {
    if (!drag) return undefined;
    const d = drag;
    drag = null;
    disarm();
    dropLine.hidden = true;
    rowsEl.querySelectorAll('.drop-in').forEach((n) => n.classList.remove('drop-in'));
    root.classList.remove('dragging');
    if (!d.started) return undefined;
    afterDrag();
    if (cancel || !d.target) return renderWindow(true);
    const { r, pos } = d.target;
    store.commit('Move rows', (plan) => applyRowMove(plan, d.ids, r.id, pos));
    return undefined;
  }
  window.addEventListener('pointerup', () => {
    if (swallowNextClick) {
      swallowNextClick = false;
      afterDrag();
    }
    endCellDrag(false);
    endDrag(false);
  });
  window.addEventListener('pointercancel', () => {
    endCellDrag(true);
    endDrag(true);
  });
  window.addEventListener('blur', () => {
    endCellDrag(true);
    endDrag(true);
  });
  // capture phase: Esc ends the drag and must not also release the grid / close the card
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !dragRunning()) return;
      e.preventDefault();
      e.stopPropagation();
      swallowNextClick = true;
      endCellDrag(true);
      endDrag(true);
    },
    true
  );

  // column resize
  head.addEventListener('pointerdown', (e) => {
    const rs = e.target.closest('.rs');
    if (!rs) return;
    e.preventDefault();
    e.stopPropagation();
    const key = rs.dataset.rs;
    const col = cols.find((c) => c.key === key);
    const x0 = e.clientX;
    const w0 = col.width;
    rs.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      col.width = Math.max(40, Math.min(800, Math.round(w0 + ev.clientX - x0)));
      root.style.setProperty('--gcols', cols.map((c) => `${c.width}px`).join(' '));
      root.style.setProperty('--gwidth', `${cols.reduce((a, c) => a + c.width, 0)}px`);
    };
    const onUp = () => {
      rs.removeEventListener('pointermove', onMove);
      rs.removeEventListener('pointerup', onUp);
      const width = col.width;
      store.commit(
        'Resize column',
        (plan) => {
          const c = (plan.settings.columns = plan.settings.columns || {});
          c[key] = { ...(c[key] || {}), width };
        },
        { undo: false, touch: false, schedule: false }
      );
    };
    rs.addEventListener('pointermove', onMove);
    rs.addEventListener('pointerup', onUp);
  });

  scroll.addEventListener('scroll', () => {
    app.syncScroll('grid', scroll.scrollTop);
    renderWindow();
  });

  return {
    el: root,
    render,
    renderWindow,
    startEdit,
    ensureVisible,
    range,
    pasteText,
    fillDown,
    clearRange,
    focus: () => body.focus({ preventScroll: true }),
    get scrollTop() {
      return scroll.scrollTop;
    },
    setScrollTop(top) {
      if (Math.abs(scroll.scrollTop - top) > 0.5) scroll.scrollTop = top;
      renderWindow();
    },
    isEditing: () => !!editing,
  };
}

function descendantsOf(tree, id) {
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
