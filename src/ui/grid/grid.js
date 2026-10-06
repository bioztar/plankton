// Task grid: virtualised rows, inline editing, keyboard navigation, drag-and-drop
// reordering / re-parenting and column resize.
import { escapeHtml as esc } from '../../util/escape.js';
import { visibleColumns } from './columns.js';
import { fmtDate, fmtVariance, statusSlug } from '../format.js';
import { predsText, setTaskField, setPredsFromText } from '../../model/edit.js';
import { moveRows, isTask } from '../../model/tree.js';
import { STATUSES, PRIORITIES } from '../../model/plan.js';
import { variance, isOverdue, statusDay } from '../../model/stats.js';
import { parseISO, toYMD } from '../../schedule/calendar.js';
import { mod } from '../dom.js';

const OVERSCAN = 10;
const HEAD_H = 44;
const DATE_COLS = new Set(['start', 'finish', 'duration', 'progress']);

export function summaryStatus(tree, id) {
  const leaves = [];
  const walk = (x) => {
    for (const c of tree.children.get(x)) tree.isSummary(c) ? walk(c) : leaves.push(tree.byId.get(c));
  };
  walk(id);
  if (leaves.length && leaves.every((t) => t.status === 'Done')) return 'Done';
  if (leaves.some((t) => t.status === 'Blocked')) return 'Blocked';
  if (leaves.some((t) => t.status !== 'Not started' || t.progress > 0)) return 'In progress';
  return 'Not started';
}

export function createGrid(app, root) {
  const store = app.store;
  root.innerHTML = `<div class="g-scroll"><div class="g-head" role="row"></div><div class="g-body" tabindex="0" role="grid" aria-label="Tasks. Arrow keys move, Enter edits, Tab indents, Insert adds a row." aria-multiselectable="true"><div class="g-rows" role="rowgroup"></div><div class="drop-line" hidden></div></div><div class="g-empty" hidden></div></div>`;
  const scroll = root.querySelector('.g-scroll');
  const head = root.querySelector('.g-head');
  const body = root.querySelector('.g-body');
  const rowsEl = root.querySelector('.g-rows');
  const dropLine = root.querySelector('.drop-line');
  const empty = root.querySelector('.g-empty');
  let win = { from: -1, to: -1 };
  let cols = [];
  let editing = null;
  let released = false;
  let suppressClick = false;

  const rowH = () => app.rowH();

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
        return `<span class="ind" style="width:${t.level * 18}px"></span>${tog}${t.milestone ? '<span class="ms-ic" title="Milestone">◆</span>' : ''}<span class="nm">${esc(t.name) || '<span class="muted">(untitled)</span>'}</span>`;
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
        const s = summary ? summaryStatus(tree, t.id) : t.status;
        return `<span class="pill st-${statusSlug(s)}">${esc(s)}</span>`;
      }
      case 'priority':
        return summary ? '' : `<span class="prio pr-${t.priority.toLowerCase()}">${esc(t.priority)}</span>`;
      case 'workstream':
        return esc(t.workstream);
      case 'variance': {
        const v = variance(t);
        return v == null ? '' : `<span class="${v > 0 ? 'var-late' : v < 0 ? 'var-early' : ''}">${fmtVariance(v)}</span>`;
      }
      case 'id':
        return `#${t.id}`;
      default:
        return '';
    }
  }

  function rowHTML(r, i, ctx) {
    const s = store;
    const { tree } = s.d;
    const top = i * rowH();
    const sel = s.selection.has(r.id);
    const act = s.active && s.active.id === r.id ? s.active.col : null;
    if (r.kind === 'section') {
      const n = ctx.sectionCounts.get(r.id) || 0;
      return `<div class="gr section${sel ? ' sel' : ''}" role="row" aria-selected="${sel}" data-id="${r.id}" style="top:${top}px;--sec:${r.color}">
<div class="gc c-num${act ? ' act' : ''}" data-col="num" role="gridcell" id="gc-${r.id}-num"><span class="drag" title="Drag to move section" aria-hidden="true">⋮⋮</span></div>
<div class="gc sec-body${act && act !== 'num' ? ' act' : ''}" data-col="name" role="gridcell" id="gc-${r.id}-name"><button type="button" class="tog" data-act="toggle" tabindex="-1" aria-expanded="${!r.collapsed}" aria-label="${r.collapsed ? 'Expand' : 'Collapse'} section ${esc(r.name)}">${r.collapsed ? '▸' : '▾'}</button><button type="button" class="swatch edit-only" data-act="color" tabindex="-1" style="background:${r.color}" aria-label="Change colour of section ${esc(r.name)}"></button><span class="nm">${esc(r.name)}</span><span class="sec-count">${n} task${n === 1 ? '' : 's'}</span><button type="button" class="btn ic sec-menu edit-only" data-act="sec-menu" tabindex="-1" aria-label="Section actions for ${esc(r.name)}">⋯</button></div></div>`;
    }
    const summary = tree.isSummary(r.id);
    const cls = ['gr', 'task', summary ? 'sum' : '', sel ? 'sel' : '', ctx.critical && ctx.critical.tasks.has(r.id) ? 'crit' : '', isOverdue(r, ctx.day) && !summary ? 'overdue' : '']
      .filter(Boolean)
      .join(' ');
    const tint = s.d.sectionColor.get(r.id);
    const cells = cols
      .map(
        (c) =>
          `<div class="gc c-${c.key}${c.align === 'r' ? ' r' : ''}${act === c.key ? ' act' : ''}" data-col="${c.key}" role="gridcell" id="gc-${r.id}-${c.key}">${cellHTML(r, c, ctx)}</div>`
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
    head.innerHTML = cols
      .map(
        (c) =>
          `<div class="gh${c.align === 'r' ? ' r' : ''}" data-col="${c.key}" role="columnheader"${c.title ? ` title="${esc(c.title)}"` : ''}>${esc(c.label)}${c.key !== 'num' ? `<span class="rs" data-rs="${c.key}" title="Drag to resize" aria-hidden="true"></span>` : ''}</div>`
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
    };
    const out = [];
    for (let i = from; i < to; i++) out.push(rowHTML(store.d.visible[i], i, ctx));
    rowsEl.innerHTML = out.join('');
    const a = store.active;
    if (a && store.d.indexOf.has(a.id)) body.setAttribute('aria-activedescendant', `gc-${a.id}-${a.col}`);
    else body.removeAttribute('aria-activedescendant');
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

  function ensureVisible(id) {
    const i = store.d.indexOf.get(id);
    if (i == null) return;
    const h = rowH();
    const top = i * h;
    const viewH = scroll.clientHeight - HEAD_H - 16;
    if (top < scroll.scrollTop) scroll.scrollTop = top;
    else if (top + h > scroll.scrollTop + viewH) scroll.scrollTop = top + h - viewH;
    renderWindow();
  }

  // ---- editing -----------------------------------------------------------
  function rawValue(r, col) {
    if (r.kind === 'section') return r.name;
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

  function startEdit(id, col, initial) {
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
    if (col === 'status' || col === 'priority') {
      input = document.createElement('select');
      input.innerHTML = (col === 'status' ? STATUSES : PRIORITIES).map((s) => `<option${s === orig ? ' selected' : ''}>${esc(s)}</option>`).join('');
    } else {
      input = document.createElement('input');
      input.type = col === 'start' || col === 'finish' ? 'date' : 'text';
      input.value = initial != null ? initial : orig;
      if (col === 'preds') input.placeholder = 'e.g. 3, 1.2FS+2d';
    }
    input.className = 'ed';
    input.setAttribute('aria-label', `Edit ${col}`);
    input.spellcheck = false;
    editing = { id, col, input, orig };
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
        if (ed.col === 'name' && !v.trim()) return 'Task name cannot be empty.';
        return setTaskField(t, ed.col, v) || undefined;
      });
    } else renderWindow(true);
    if (!fromBlur) {
      body.focus({ preventScroll: true });
      if (dRow || dCol) move(dRow, dCol, false);
    }
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
    app.select(r.id, { extend, col: r.kind === 'section' && ci > 1 ? 'name' : keys[ci], keepCard: true });
    ensureVisible(r.id);
  }

  body.addEventListener('keydown', (e) => {
    if (e.target !== body) return;
    const vis = store.d.visible;
    const a = store.active && store.d.indexOf.has(store.active.id) ? store.active : null;
    const r = a ? store.d.tree.byId.get(a.id) : null;
    const k = e.key;
    const page = Math.max(1, Math.floor((scroll.clientHeight - HEAD_H) / rowH()) - 1);
    if (k !== 'Tab' && k !== 'Shift') released = false;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (!a && vis.length && /^Arrow|Home|End|Page/.test(k)) {
      handled();
      return app.select(vis[0].id, { col: 'name' });
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
        return move(0, k === 'ArrowRight' ? 1 : -1, false);
      case 'Home':
      case 'End':
        handled();
        return mod(e) ? move(k === 'Home' ? -1e9 : 1e9, 0, e.shiftKey) : move(0, k === 'Home' ? -1e9 : 1e9, false);
      case 'PageDown':
      case 'PageUp':
        handled();
        return move(k === 'PageDown' ? page : -page, 0, e.shiftKey);
      case 'Enter':
        handled();
        if (mod(e)) return app.addTask();
        if (!r) return undefined;
        if (r.kind === 'section') return startEdit(r.id, 'name');
        if (e.shiftKey || a.col === 'num' || !canEdit(r, a.col)) return app.openCard(r.id);
        return startEdit(r.id, a.col);
      case 'F2':
        handled();
        return r && startEdit(r.id, r.kind === 'section' ? 'name' : a.col);
      case 'Insert':
        handled();
        return e.shiftKey ? app.addSection() : app.addTask();
      case 'Delete':
      case 'Backspace':
        handled();
        return app.deleteSelection();
      case 'Tab':
        if (released || !a) return undefined;
        handled();
        return e.shiftKey ? app.outdent() : app.indent();
      case 'Escape':
        released = true;
        if (store.cardId != null) {
          handled();
          return app.closeCard();
        }
        return app.toast('Grid released: Tab now moves focus out of the grid.', 'info', 2000);
      case ' ':
        if (r && (r.kind === 'section' || store.d.tree.isSummary(r.id))) {
          handled();
          return app.toggleCollapse(r.id);
        }
        return undefined;
      default:
        if (r && k.length === 1 && !mod(e) && !e.altKey && r.kind !== 'section' && canEdit(r, a.col)) {
          const c = cols.find((x) => x.key === a.col);
          if (c && c.edit === 'text') {
            handled();
            return startEdit(r.id, a.col, k);
          }
        }
    }
    return undefined;
  });
  body.addEventListener('focus', () => {
    released = false;
    if (!store.active && store.d.visible.length) app.select(store.d.visible[0].id, { col: 'name', keepCard: true });
  });

  // ---- mouse ---------------------------------------------------------------
  rowsEl.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const rowEl = e.target.closest('.gr');
    if (!rowEl || e.target.closest('.ed')) return;
    const id = Number(rowEl.dataset.id);
    const actEl = e.target.closest('[data-act]');
    const cell = e.target.closest('[data-col]');
    const act = actEl && actEl.dataset.act;
    if (act === 'toggle') return app.toggleCollapse(id);
    if (act === 'color') return app.sectionColor(id, actEl);
    if (act === 'sec-menu') return app.sectionMenu(id, actEl);
    app.select(id, { extend: e.shiftKey, toggle: mod(e), col: cell ? cell.dataset.col : 'name', keepCard: true });
    if (act === 'card') return app.openCard(id);
    body.focus({ preventScroll: true });
    return undefined;
  });
  rowsEl.addEventListener('dblclick', (e) => {
    const rowEl = e.target.closest('.gr');
    const cell = e.target.closest('[data-col]');
    if (!rowEl || !cell || e.target.closest('[data-act]')) return;
    const id = Number(rowEl.dataset.id);
    const r = store.d.tree.byId.get(id);
    if (canEdit(r, cell.dataset.col)) startEdit(id, cell.dataset.col);
    else if (r && r.kind !== 'section') app.openCard(id);
  });

  // drag rows by the # cell
  let drag = null;
  let autoScroll = 0;
  rowsEl.addEventListener('pointerdown', (e) => {
    const num = e.target.closest('.c-num');
    if (!num || e.button !== 0 || store.readOnly) return;
    const id = Number(num.closest('.gr').dataset.id);
    drag = { id, x: e.clientX, y: e.clientY, started: false, target: null };
  });
  function dropTarget(clientY) {
    const rect = body.getBoundingClientRect();
    const h = rowH();
    const vis = store.d.visible;
    const y = clientY - rect.top;
    const i = Math.max(0, Math.min(vis.length - 1, Math.floor(y / h)));
    const r = vis[i];
    if (!r || drag.moving.has(r.id)) return null;
    const frac = (y - i * h) / h;
    const tree = store.d.tree;
    let pos = frac < 0.3 ? 'before' : frac > 0.7 ? 'after' : isTask(r) ? 'inside' : 'after';
    if (pos === 'after' && isTask(r) && tree.isSummary(r.id) && !r.collapsed) pos = 'firstchild';
    if (pos === 'after' && !isTask(r) && !r.collapsed) pos = 'before-next';
    return { r, i, pos };
  }
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.abs(e.clientY - drag.y) + Math.abs(e.clientX - drag.x) < 6) return;
      drag.started = true;
      if (!store.selection.has(drag.id)) app.select(drag.id, { keepCard: true });
      const ids = [...store.selection];
      const tree = store.d.tree;
      const moving = new Set(ids);
      for (const id of ids) if (isTask(tree.byId.get(id))) for (const dd of descendantsOf(tree, id)) moving.add(dd);
      drag.ids = ids;
      drag.moving = moving;
      root.classList.add('dragging');
    }
    const t = dropTarget(e.clientY);
    drag.target = t;
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
    const sr = scroll.getBoundingClientRect();
    autoScroll = e.clientY < sr.top + HEAD_H + 24 ? -1 : e.clientY > sr.bottom - 24 ? 1 : 0;
  });
  setInterval(() => {
    if (drag && drag.started && autoScroll) scroll.scrollTop += autoScroll * 14;
  }, 30);
  const endDrag = (e, cancel) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    autoScroll = 0;
    dropLine.hidden = true;
    root.classList.remove('dragging');
    if (!d.started) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    if (cancel || !d.target) return renderWindow(true);
    const { r, pos } = d.target;
    store.commit('Move rows', (plan) => {
      let targetId = r.id;
      let p = pos;
      if (p === 'before-next') {
        p = 'after';
      }
      const next = moveRows(plan.rows, d.ids, targetId, p);
      if (!next) return false;
      plan.rows = next;
      return undefined;
    });
    return undefined;
  };
  window.addEventListener('pointerup', (e) => endDrag(e, false));
  window.addEventListener('pointercancel', (e) => endDrag(e, true));
  window.addEventListener('keydown', (e) => {
    if (drag && drag.started && e.key === 'Escape') endDrag(e, true);
  });

  // column resize
  head.addEventListener('pointerdown', (e) => {
    const rs = e.target.closest('.rs');
    if (!rs) return;
    e.preventDefault();
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
