// App shell: layout, header, toolbar, menus, plan management, import/export,
// global shortcuts. Views (grid, gantt, card, board, logs) live in their own modules.
import { download, safeFilename, toast, isTyping, mod, isMac } from './dom.js';
import { createStore } from './state.js';
import { createStorage, defaultStore } from '../io/storage.js';
import { samplePlan } from '../model/sample.js';
import { createPlan, createTask, normalizePlan, parsePlanJSON, serializePlan, clonePlan, uid, nowStamp, saveBaseline, clearBaseline, PALETTE, STATUSES, PLAN_STATUSES } from '../model/plan.js';
import { indent, outdent, deleteRows as removeRows, moveRows, isTask, descendants, ancestors } from '../model/tree.js';
import { insertTaskBelow, insertSectionBelow } from '../model/edit.js';
import { planStats } from '../model/stats.js';
import { today, isISODate, mondayOf, toISO } from '../schedule/calendar.js';
import { formatLag } from '../schedule/links.js';
import { toCSV } from '../io/csv.js';
import { embedPayload, extractPayload, resolveBoot, buildPayload } from '../io/standalone.js';
import { createFileSaver, createHandleRegistry, initialSaveState, saveReducer, hasUnsaved, saveStatusText, suggestedFileName } from '../io/filesave.js';
import { idbKV } from '../io/idb.js';
import { escapeHtml as esc } from '../util/escape.js';
import { GANTT_CSS } from './gantt/render.js';
import { createGrid } from './grid/grid.js';
import { createGantt } from './gantt/gantt.js';
import { createCard } from './card/card.js';
import { createBoard } from './board/board.js';
import { createLogs } from './logs/logs.js';
import { modal, confirmBox, promptBox } from './dialogs/modal.js';
import { openMenu, openPalette, closeMenu, isMenuOpen } from './dialogs/menu.js';
import { openPasteImport } from './dialogs/paste.js';
import { exportGanttPNG } from './gantt/export.js';
import { buildPrint, clearPrint } from './print.js';
import { columnState } from './grid/columns.js';
import { fmtDateLong, fmtStamp } from './format.js';

const VIEWS = ['plan', 'board', 'logs'];
const THEMES = ['auto', 'light', 'dark'];
const UI = { undo: false, touch: false, schedule: false, allowReadOnly: true };
const K = isMac ? '⌘' : 'Ctrl';

function layoutHTML() {
  return `<header class="top">
<div class="brand" aria-hidden="true">▦</div>
<div class="plan-meta">
  <div class="pm-row1"><input class="plan-name" aria-label="Plan name" maxlength="200"><button type="button" class="btn ic edit-only" data-act="plans" aria-haspopup="menu" aria-label="Switch or manage plans" title="Plans">▾</button><span class="ro-badge">Read-only</span><span class="save-state" aria-live="polite"></span></div>
  <div class="pm-row2">
    <label>Start <input type="date" data-p="start"></label>
    <label>Status date <input type="date" data-p="statusDate" title="Used for overdue; empty = today"></label>
    <label>Owner <input data-p="owner" maxlength="200"></label>
    <label>Status <select data-p="status">${PLAN_STATUSES.map((s) => `<option>${s}</option>`).join('')}</select></label>
  </div>
</div>
<div class="stats" aria-label="Plan summary"></div>
<div class="top-actions">
  <div class="tabs" role="tablist" aria-label="Views">${VIEWS.map((v) => `<button type="button" role="tab" class="tab" data-act="view-${v}" aria-selected="false">${v === 'plan' ? 'Grid + Gantt' : v === 'board' ? 'Board' : 'Logs'}</button>`).join('')}</div>
  <button type="button" class="btn primary unlock" data-act="unlock">Unlock editing</button>
  <button type="button" class="btn" data-act="present" aria-pressed="false" title="Presenter mode: hides editing tools, larger text">Present</button>
  <button type="button" class="btn" data-act="theme" title="Light / dark theme (Auto follows the OS)">Theme</button>
  <button type="button" class="btn save-btn" data-act="save" title="Save (${K}+S)">Save</button>
  <button type="button" class="btn" data-act="file" aria-haspopup="menu">File ▾</button>
  <button type="button" class="btn ic" data-act="help" aria-label="Keyboard shortcuts and help" title="Help (?)">?</button>
</div>
</header>
<div class="banner" role="status" hidden><span class="banner-text"></span><button type="button" class="btn sm" data-act="use-file">Use file version</button><button type="button" class="btn ic sm" data-act="banner-close" aria-label="Dismiss" title="Dismiss">×</button></div>
<div class="toolbar" role="toolbar" aria-label="Plan tools">
  <div class="tb-group edit-only">
    <button type="button" class="btn" data-act="add-task" title="New task below (Insert or ${K}+Enter)">+ Task</button>
    <button type="button" class="btn plan-only" data-act="add-section" title="New section (Shift+Insert)">+ Section</button>
    <button type="button" class="btn ic plan-only" data-act="outdent" aria-label="Outdent" title="Outdent (Shift+Tab)">⇤</button>
    <button type="button" class="btn ic plan-only" data-act="indent" aria-label="Indent" title="Indent (Tab)">⇥</button>
    <button type="button" class="btn ic plan-only" data-act="delete" aria-label="Delete selected rows" title="Delete selected rows (Delete)">✕</button>
    <button type="button" class="btn ic" data-act="undo" aria-label="Undo" title="Undo (${K}+Z)">↶</button>
    <button type="button" class="btn ic" data-act="redo" aria-label="Redo" title="Redo (Shift+${K}+Z)">↷</button>
  </div>
  <div class="tb-group plan-only">
    <button type="button" class="btn ic" data-act="expand-all" aria-label="Expand all" title="Expand all">⊞</button>
    <button type="button" class="btn ic" data-act="collapse-all" aria-label="Collapse all" title="Collapse all">⊟</button>
    <label class="tb-lbl">Zoom <select data-set="zoom"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option><option value="fit">Fit project</option></select></label>
    <button type="button" class="btn" data-act="fit" title="Fit the whole project in view">Fit</button>
    <button type="button" class="btn" data-act="today" title="Scroll the Gantt to today">Today</button>
    <label class="tb-lbl">Labels <select data-set="labelMode"><option value="name">Name</option><option value="owner">Owner</option><option value="none">None</option></select></label>
    <button type="button" class="btn edit-only" data-act="auto" aria-pressed="false" title="Auto-schedule: moving a task pushes its successors">Auto-schedule</button>
    <button type="button" class="btn" data-act="critical" aria-pressed="false" title="Highlight the critical path">Critical path</button>
    <button type="button" class="btn" data-act="baseline" aria-haspopup="menu">Baseline ▾</button>
    <button type="button" class="btn" data-act="columns" aria-haspopup="menu">Columns ▾</button>
  </div>
  <div class="tb-group filters" role="search">
    <input type="search" class="search" placeholder="Search (${K}+F)" aria-label="Search tasks">
    <select data-filter="owner" aria-label="Filter by owner"></select>
    <select data-filter="status" aria-label="Filter by status"></select>
    <select data-filter="section" aria-label="Filter by section"></select>
    <button type="button" class="btn" data-act="f-overdue" aria-pressed="false" title="Only overdue tasks">Overdue</button>
    <button type="button" class="btn ic" data-act="f-clear" aria-label="Clear filters" title="Clear filters">⌫</button>
  </div>
</div>
<main class="views">
  <section class="view view-plan" aria-label="Grid and Gantt"><div class="pane grid-pane"></div><div class="splitter" role="separator" aria-orientation="vertical" aria-label="Resize grid and Gantt" tabindex="0"></div><div class="pane gantt-pane"></div></section>
  <section class="view view-board" aria-label="Board" hidden></section>
  <section class="view view-logs" aria-label="Logs" hidden></section>
</main>
<aside class="card" hidden></aside>`;
}

function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function blankPlan(name) {
  const start = toISO(mondayOf(today()));
  const p = createPlan({ name, start });
  p.rows = [createTask(p, { name: 'First task', start, duration: 3 })];
  return p;
}

function loadInitial(storage) {
  const idx = storage.index();
  let plan = idx.current ? storage.load(idx.current) : null;
  for (const e of idx.plans) {
    if (plan) break;
    plan = storage.load(e.id);
  }
  if (!plan) {
    plan = samplePlan();
    storage.save(plan);
  }
  return plan;
}

export function boot(sourceHtml) {
  const gs = document.createElement('style');
  gs.textContent = GANTT_CSS;
  document.head.appendChild(gs);
  const { store: backing, persistent } = defaultStore();
  const storage = createStorage(backing);
  let theme = storage.prefs().theme || 'auto';
  applyTheme(theme);

  // A file with an embedded plan opens that plan, unless this browser holds newer
  // saved edits of the same plan (see resolveBoot).
  let opened = null;
  const fileReport = {};
  try {
    const payload = JSON.parse(document.getElementById('pb-data').textContent || 'null');
    if (payload && payload.plan) {
      const filePlan = normalizePlan(payload.plan, fileReport);
      opened = resolveBoot({ ...payload, plan: filePlan }, storage.load(filePlan.id));
    }
  } catch (e) {
    opened = null;
  }
  const store = opened
    ? createStore({ plan: opened.plan, storage, readOnly: opened.readOnly, embedded: true, presenter: opened.presenter })
    : createStore({ plan: loadInitial(storage), storage });

  const root = document.getElementById('app');
  root.innerHTML = layoutHTML();
  const q = (s) => root.querySelector(s);
  const printRoot = document.getElementById('print-root');

  const app = {
    store,
    storage,
    toast,
    rowH: () => (store.presenter ? 36 : 30),
    todayDay: () => today(),
    select,
    openCard,
    closeCard,
    syncScroll,
    toggleCollapse,
    sectionColor,
    sectionMenu,
    addTask,
    addSection,
    indent: () => treeOp('Indent', indent),
    outdent: () => treeOp('Outdent', outdent),
    deleteSelection: () => deleteRowsUI(targetIds()),
    deleteRows: deleteRowsUI,
    moveSelection,
    addPlan,
  };

  // ---- selection / card ---------------------------------------------------
  function select(id, o = {}) {
    const d = store.d;
    if (o.extend && store.anchor != null && d.indexOf.has(store.anchor) && d.indexOf.has(id)) {
      const a = d.indexOf.get(store.anchor);
      const b = d.indexOf.get(id);
      store.selection = new Set(d.visible.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id));
    } else if (o.toggle) {
      if (store.selection.has(id)) store.selection.delete(id);
      else store.selection.add(id);
      store.anchor = id;
    } else {
      store.selection = new Set([id]);
      store.anchor = id;
    }
    store.active = { id, col: o.col || (store.active && store.active.col) || 'name' };
    const r = d.tree.byId.get(id);
    if (o.keepCard && store.cardId != null && r && isTask(r)) store.cardId = id;
    store.ui();
  }

  function openCard(id, o = {}) {
    const r = store.d.tree.byId.get(id);
    if (!r) return;
    if (!isTask(r)) {
      if (store.view === 'plan') app.grid.startEdit(id, 'name');
      return;
    }
    store.cardId = id;
    store.selection = new Set([id]);
    store.anchor = id;
    store.active = { id, col: (store.active && store.active.col) || 'name' };
    store.ui();
    if (store.view === 'plan') app.grid.ensureVisible(id);
    if (o.focus !== false) card.focusName();
  }

  function closeCard() {
    if (store.cardId == null) return;
    store.cardId = null;
    store.ui();
    if (store.view === 'plan') app.grid.focus();
  }

  let syncing = false;
  function syncScroll(src, top) {
    if (syncing) return;
    syncing = true;
    if (src === 'grid') app.gantt.setScrollTop(top);
    else app.grid.setScrollTop(top);
    syncing = false;
  }

  // ---- row operations -------------------------------------------------------
  function targetIds() {
    if (store.selection.size) return [...store.selection];
    return store.active ? [store.active.id] : [];
  }

  function treeOp(label, fn) {
    const ids = targetIds();
    if (!ids.length) return;
    store.commit(label, (p) => (fn(p.rows, ids) ? undefined : false));
  }

  function reveal(id) {
    if (store.d.indexOf.has(id)) return;
    const tree = store.d.tree;
    const ids = [...ancestors(tree, id)];
    const sid = tree.sectionOf.get(id);
    if (sid != null) ids.push(sid);
    store.commit('Reveal', (p) => {
      for (const r of p.rows) if (ids.includes(r.id)) r.collapsed = false;
    }, UI);
  }

  function afterInsert(id) {
    if (id == null) return;
    if (store.d.matches && !store.d.matches.has(id)) {
      clearFilters();
      toast('Filters cleared to show the new row.');
    }
    reveal(id);
    if (store.view !== 'plan') {
      if (isTask(store.d.tree.byId.get(id))) openCard(id);
      return;
    }
    select(id, { col: 'name' });
    app.grid.ensureVisible(id);
    setTimeout(() => app.grid.startEdit(id, 'name'), 0);
  }

  function refId() {
    if (store.active && store.d.tree.byId.has(store.active.id)) return store.active.id;
    const v = store.d.visible;
    return v.length ? v[v.length - 1].id : null;
  }

  function addTask() {
    if (store.readOnly) return store.emit('readonly');
    let id = null;
    const ref = refId();
    store.commit('Add task', (p) => {
      id = insertTaskBelow(p, ref).id;
    });
    return afterInsert(id);
  }

  function addSection(refOverride) {
    if (store.readOnly) return store.emit('readonly');
    let id = null;
    const ref = refOverride != null ? refOverride : refId();
    const n = store.plan.rows.filter((r) => !isTask(r)).length;
    store.commit('Add section', (p) => {
      id = insertSectionBelow(p, ref, { name: 'New section', color: PALETTE[n % PALETTE.length].color }).id;
    });
    return afterInsert(id);
  }

  async function deleteRowsUI(ids) {
    if (store.readOnly) return store.emit('readonly');
    if (!ids.length) return undefined;
    const tree = store.d.tree;
    const gone = new Set();
    let tasks = 0;
    let sections = 0;
    for (const id of ids) {
      const r = tree.byId.get(id);
      if (!r) continue;
      gone.add(id);
      if (!isTask(r)) {
        sections++;
        continue;
      }
      for (const x of [id, ...descendants(tree, id)]) {
        if (!gone.has(x) || x === id) tasks += gone.has(x) && x !== id ? 0 : 1;
        gone.add(x);
      }
    }
    const parts = [];
    if (tasks) parts.push(`${tasks} task${tasks > 1 ? 's' : ''}`);
    if (sections) parts.push(`${sections} section${sections > 1 ? 's' : ''}`);
    const msg = `Delete ${parts.join(' and ')}?${sections ? ' Tasks under a deleted section are kept.' : ''} You can undo with ${K}+Z.`;
    const ok = await confirmBox(msg, { ok: 'Delete', danger: true, title: 'Delete rows' });
    if (!ok) return undefined;
    const vis = store.d.visible;
    const idxs = ids.map((id) => store.d.indexOf.get(id)).filter((i) => i != null);
    const maxI = idxs.length ? Math.max(...idxs) : -1;
    const minI = idxs.length ? Math.min(...idxs) : 0;
    const next = vis.slice(maxI + 1).find((r) => !gone.has(r.id)) || vis.slice(0, minI).reverse().find((r) => !gone.has(r.id));
    store.commit('Delete rows', (p) => {
      p.rows = removeRows(p.rows, ids).rows;
    });
    if (next) select(next.id, { col: 'name' });
    if (store.view === 'plan') app.grid.focus();
    return undefined;
  }

  function moveSelection(dir) {
    const ids = targetIds();
    if (!ids.length || store.readOnly) return;
    const d = store.d;
    const moving = new Set(ids);
    for (const id of ids) if (isTask(d.tree.byId.get(id))) for (const x of descendants(d.tree, id)) moving.add(x);
    const idxs = [...moving].map((id) => d.indexOf.get(id)).filter((i) => i != null);
    if (!idxs.length) return;
    let target;
    let pos;
    if (dir < 0) {
      target = d.visible[Math.min(...idxs) - 1];
      pos = 'before';
    } else {
      target = d.visible[Math.max(...idxs) + 1];
      pos = 'after';
    }
    if (!target) return;
    store.commit('Move rows', (p) => {
      const out = moveRows(p.rows, ids, target.id, pos);
      if (!out) return false;
      p.rows = out;
      return undefined;
    });
    app.grid.ensureVisible(ids[0]);
  }

  function toggleCollapse(id) {
    store.commit('Collapse', (p) => {
      const r = p.rows.find((x) => x.id === id);
      if (r) r.collapsed = !r.collapsed;
    }, UI);
  }

  function setCollapsedAll(collapsed) {
    const tree = store.d.tree;
    store.commit(collapsed ? 'Collapse all' : 'Expand all', (p) => {
      for (const r of p.rows) {
        if (!isTask(r)) {
          if (!collapsed) r.collapsed = false;
        } else if (tree.isSummary(r.id)) r.collapsed = collapsed;
      }
    }, UI);
  }

  function sectionColor(id, anchor) {
    if (store.readOnly) return store.emit('readonly');
    const r = store.d.tree.byId.get(id);
    return openPalette(anchor, r.color, PALETTE).then((color) =>
      store.commit('Section colour', (p) => {
        p.rows.find((x) => x.id === id).color = color;
      }, { touch: false, schedule: false })
    );
  }

  function moveSectionBlock(p, id, dir) {
    const rows = p.rows;
    const i = rows.findIndex((r) => r.id === id);
    let end = i + 1;
    while (end < rows.length && isTask(rows[end])) end++;
    const block = rows.slice(i, end);
    if (dir < 0) {
      if (i === 0) return false;
      let prev = i - 1;
      while (prev > 0 && isTask(rows[prev])) prev--;
      rows.splice(i, end - i);
      rows.splice(prev, 0, ...block);
    } else {
      if (end >= rows.length) return false;
      let n = end + 1;
      while (n < rows.length && isTask(rows[n])) n++;
      rows.splice(i, end - i);
      rows.splice(n - block.length, 0, ...block);
    }
    return true;
  }

  function sectionMenu(id, anchor) {
    const r = store.d.tree.byId.get(id);
    if (!r) return;
    openMenu(anchor, [
      { label: 'Rename', action: () => app.grid.startEdit(id, 'name') },
      { label: 'Change colour…', action: () => sectionColor(id, anchor) },
      { label: r.collapsed ? 'Expand' : 'Collapse', action: () => toggleCollapse(id) },
      { label: 'Add task in this section', action: () => {
        let nid = null;
        store.commit('Add task', (p) => {
          nid = insertTaskBelow(p, id).id;
        });
        afterInsert(nid);
      } },
      { label: 'Add section below', action: () => addSection(id) },
      { sep: true },
      { label: 'Move up (with its tasks)', action: () => store.commit('Move section', (p) => (moveSectionBlock(p, id, -1) ? undefined : false)) },
      { label: 'Move down (with its tasks)', action: () => store.commit('Move section', (p) => (moveSectionBlock(p, id, 1) ? undefined : false)) },
      { sep: true },
      { label: 'Delete section (keep tasks)', danger: true, action: () => deleteRowsUI([id]) },
    ], { label: `Section ${r.name}` });
  }

  // ---- plans ----------------------------------------------------------------
  function addPlan(p) {
    store.flush();
    if (!storage.save(p)) toast('Could not save: browser storage is full or disabled. Use Export JSON.', 'error', 7000);
    store.load(p, { save: false });
  }

  function switchPlan(id) {
    if (id === store.plan.id) return;
    store.flush();
    const p = storage.load(id);
    if (!p) return toast('Could not load that plan.', 'error');
    storage.setCurrent(id);
    store.load(p, { save: false });
    return undefined;
  }

  async function newPlan() {
    const name = await promptBox('New plan', 'Plan name', 'Untitled plan');
    if (name) addPlan(blankPlan(name.slice(0, 200)));
  }

  function duplicatePlan() {
    const p = clonePlan(store.plan);
    p.id = uid();
    p.name = `${p.name} (copy)`.slice(0, 200);
    p.createdAt = p.updatedAt = nowStamp();
    addPlan(p);
    toast(`Created “${p.name}”.`);
  }

  async function renamePlan() {
    const name = await promptBox('Rename plan', 'Plan name', store.plan.name);
    if (name) store.commit('Rename plan', (p) => {
      p.name = name.slice(0, 200);
    }, { touch: false, schedule: false });
  }

  async function deletePlan() {
    const ok = await confirmBox(`Delete “${store.plan.name}” from this browser? This cannot be undone. Export it as JSON first if you might need it.`, { ok: 'Delete plan', danger: true, title: 'Delete plan' });
    if (!ok) return;
    clearTimeout(store.saveTimer);
    store.saveState = 'saved';
    storage.remove(store.plan.id);
    const idx = storage.index();
    let next = idx.current ? storage.load(idx.current) : null;
    if (!next) {
      next = blankPlan('Untitled plan');
      storage.save(next);
    }
    storage.setCurrent(next.id);
    store.load(next, { save: false });
  }

  function plansMenu(anchor) {
    const list = storage.list();
    openMenu(anchor, [
      { heading: 'Plans in this browser' },
      ...list.map((p) => ({ label: p.name, checked: p.id === store.plan.id, radio: true, action: () => switchPlan(p.id) })),
      { sep: true },
      { label: 'New plan…', action: newPlan },
      { label: 'Duplicate plan', action: duplicatePlan },
      { label: 'Rename plan…', action: renamePlan },
      { label: 'Delete plan…', danger: true, action: deletePlan },
    ], { label: 'Plans' });
  }

  // ---- import / export ------------------------------------------------------
  function pickFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json,.html,.htm,.csv,.tsv,.txt';
    input.addEventListener('change', () => input.files[0] && readFile(input.files[0]));
    input.click();
  }

  async function readFile(file) {
    if (store.readOnly) return store.emit('readonly');
    if (file.size > 20 * 1024 * 1024) return toast('That file is too large (over 20 MB).', 'error');
    const text = await file.text();
    return importText(text, file.name);
  }

  async function importText(text, name = '') {
    const lower = name.toLowerCase();
    if (/\.(csv|tsv|txt)$/.test(lower)) return openPasteImport(app, text);
    let p;
    const report = {};
    try {
      if (/\.html?$/.test(lower) || /^\s*</.test(text)) {
        const payload = extractPayload(text);
        if (!payload || !payload.plan) throw new Error('this HTML file has no embedded plan');
        p = normalizePlan(payload.plan, report);
      } else p = parsePlanJSON(text, report);
    } catch (e) {
      return toast(`Import failed: ${e.message}`, 'error', 7000);
    }
    const existing = storage.load(p.id);
    if (existing) {
      const r = await modal({
        title: 'Plan already exists',
        body: `<p>This browser already has a plan with the same ID: “${esc(existing.name)}” (saved ${esc(fmtStamp(existing.updatedAt))}).</p>`,
        actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Import as copy', value: 'copy' }, { label: 'Replace it', value: 'replace', primary: true }],
      });
      if (r.value === 'cancel') return undefined;
      if (r.value === 'copy') {
        p.id = uid();
        p.name = `${p.name} (imported)`.slice(0, 200);
      }
    }
    addPlan(p);
    toast(`Imported “${p.name}”.${droppedNote(report)}`, report.droppedLinks.length ? 'warn' : 'info', 6000);
    return undefined;
  }

  const exportJSON = () => download(safeFilename(store.plan.name, 'json'), serializePlan(store.plan), 'application/json');
  const exportCSV = () => download(safeFilename(store.plan.name, 'csv'), toCSV(store.plan, store.d.tree), 'text/csv;charset=utf-8');
  function droppedNote(report) {
    const n = (report.droppedLinks || []).length;
    return n ? ` ${n} circular or invalid link${n === 1 ? ' was' : 's were'} removed.` : '';
  }

  // ---- save into the .html file -------------------------------------------
  // Chromium: write in place through a File System Access handle remembered per
  // plan and page in IndexedDB. Elsewhere: download the updated file.
  const pickerFn = typeof window.showSaveFilePicker === 'function' ? (o) => window.showSaveFilePicker(o) : null;
  const saver = createFileSaver({
    showSaveFilePicker: pickerFn,
    registry: createHandleRegistry(idbKV()),
    href: location.href,
    download: (name, html) => download(name, html, 'text/html;charset=utf-8'),
    confirm: confirmOverwrite,
  });
  let fileState = initialSaveState(!!opened && opened.source === 'saved');
  const fileStampFor = (id) => (opened && opened.file.plan.id === id ? opened.file.stamp : null);
  saver.bind(store.plan.id, fileStampFor(store.plan.id));
  const setFileState = (ev) => {
    fileState = saveReducer(fileState, ev);
    updateSaveState();
  };
  const SHARE_HINT = 'Replace the original file with the downloaded one to share your edits.';

  async function confirmOverwrite(c) {
    const body = c.kind === 'changed'
      ? `<p>“${esc(c.fileName)}” has been changed since you opened it${c.stamp ? ` (saved ${esc(fmtStamp(c.stamp))})` : ''}, probably by someone else.</p><p>Overwriting replaces those changes with the version shown here.</p>`
      : `<p>“${esc(c.fileName)}” no longer holds this plan${c.name ? ` (it now holds “${esc(c.name)}”)` : ''}.</p><p>Overwriting replaces its contents with this plan.</p>`;
    const r = await modal({
      title: 'File changed on disk',
      body,
      actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Save as…', value: 'saveas' }, { label: 'Overwrite', value: 'overwrite', danger: true }],
    });
    return r.value;
  }

  async function saveToFile(saveAs = false) {
    if (store.readOnly) return store.emit('readonly');
    if (fileState.status === 'saving') return undefined;
    store.flush();
    const planId = store.plan.id;
    const stamp = new Date().toISOString();
    const html = embedPayload(sourceHtml, buildPayload(store.plan, { at: stamp }));
    const name = safeFilename(store.plan.name, 'html');
    setFileState({ type: 'start' });
    let r;
    try {
      r = await saver.save({ planId, html, stamp, saveAs, suggestedName: suggestedFileName(location.href, name), downloadName: name });
    } catch (e) {
      r = { status: 'failed', error: (e && e.message) || String(e) };
    }
    if (store.plan.id !== planId) return undefined;
    if (r.status === 'saved') {
      setFileState({ type: 'success', at: Date.now(), target: 'file' });
      toast(`Saved to “${r.name}”.`, 'info', 2500);
    } else if (r.status === 'downloaded') {
      setFileState({ type: 'success', at: Date.now(), target: 'download' });
      toast(r.reason === 'denied' ? `No permission to write the file, so “${r.name}” was downloaded. ${SHARE_HINT}` : SHARE_HINT, 'info', 8000);
    } else if (r.status === 'cancelled') setFileState({ type: 'cancel' });
    else {
      setFileState({ type: 'fail', error: r.error });
      toast(`Could not save${r.name ? ` “${r.name}”` : ''}: ${r.error}. Try File → Save as…`, 'error', 8000);
    }
    return undefined;
  }

  function showBanner(text) {
    q('.banner-text').textContent = text;
    q('.banner').hidden = false;
  }
  const hideBanner = () => {
    q('.banner').hidden = true;
  };

  async function useFileVersion() {
    const f = opened && opened.file;
    if (!f) return;
    if (!f.readOnly && !(await confirmBox('Open the version stored in this file? Your newer edits saved in this browser will be replaced by it.', { ok: 'Use file version', danger: true }))) return;
    hideBanner();
    store.flush();
    store.readOnly = f.readOnly;
    store.presenter = f.presenter;
    const p = clonePlan(f.plan);
    if (f.readOnly) store.load(p, { save: false });
    else addPlan(p);
    toast(f.readOnly ? 'Showing the file version (read-only). Your saved edits are still in this browser.' : 'Showing the file version.', 'info', 5000);
  }

  function exportPresenterCopy() {
    store.flush();
    download(safeFilename(`${store.plan.name} (read-only)`, 'html'), embedPayload(sourceHtml, buildPayload(store.plan, { presenter: true })), 'text/html;charset=utf-8');
    toast('Read-only presenter copy downloaded. It opens read-only; “Unlock editing” in it makes an editable copy in that browser.', 'info', 6000);
  }
  function exportPNG() {
    const go = () => exportGanttPNG(app).then(() => toast('Gantt PNG downloaded.')).catch((e) => toast(e.message, 'error'));
    if (store.view !== 'plan') {
      setView('plan');
      setTimeout(go, 50);
    } else go();
  }
  function printPlan() {
    buildPrint(app, printRoot);
    window.print();
  }
  window.addEventListener('beforeprint', () => buildPrint(app, printRoot));
  window.addEventListener('afterprint', () => clearPrint(printRoot));

  function fileMenu(anchor) {
    const ro = store.readOnly;
    const items = [];
    if (!ro) {
      items.push(
        { heading: 'Plan' },
        { label: 'New plan…', action: newPlan },
        { label: 'Duplicate plan', action: duplicatePlan },
        { label: 'Rename plan…', action: renamePlan },
        { label: 'Delete plan…', danger: true, action: deletePlan },
        { sep: true },
        { heading: 'Import' },
        { label: 'Import JSON file…', hint: 'or drop a file', action: pickFile },
        { label: 'Paste table (Excel, Planner, Smartsheet)…', action: () => openPasteImport(app) },
        { sep: true }
      );
    }
    items.push({ heading: 'Export' });
    if (!ro) items.push({ label: 'Save', hint: `${K}+S`, action: () => saveToFile(false) }, { label: 'Save as…', hint: `Shift+${K}+S`, action: () => saveToFile(true) });
    items.push(
      { label: 'Export JSON', action: exportJSON },
      { label: 'Export CSV', action: exportCSV },
      { label: 'Export read-only presenter copy (.html)', action: exportPresenterCopy },
      { label: 'Export Gantt as PNG', action: exportPNG },
      { label: 'Print…', hint: `${K}+P`, action: printPlan },
      { sep: true }
    );
    if (ro) items.push({ label: 'Unlock editing', action: unlock });
    else items.push({ label: 'Load sample plan', action: () => addPlan(samplePlan()) });
    items.push({ label: 'Keyboard shortcuts & help', hint: '?', action: showHelp });
    openMenu(anchor, items, { label: 'File' });
  }

  async function unlock() {
    let p = clonePlan(store.plan);
    const existing = storage.load(p.id);
    if (existing) {
      const newer = (Date.parse(existing.updatedAt) || 0) > (Date.parse(p.updatedAt) || 0);
      const saved = `“${esc(existing.name)}” (saved ${esc(fmtStamp(existing.updatedAt))})`;
      const r = await modal({
        title: 'Unlock editing',
        body: newer
          ? `<p>This browser has newer edits of ${saved} than this file.</p><p>Open your edits, keep both, or replace your edits with the file version? Replacing loses your edits.</p>`
          : `<p>This browser already has ${saved}.</p><p>Keep both, or replace the saved plan with this copy?</p>`,
        actions: newer
          ? [{ label: 'Cancel', value: 'cancel' }, { label: 'Replace my edits', value: 'replace', danger: true }, { label: 'Keep both', value: 'copy' }, { label: 'Open my edits', value: 'saved', primary: true }]
          : [{ label: 'Cancel', value: 'cancel' }, { label: 'Replace saved plan', value: 'replace' }, { label: 'Keep both', value: 'copy', primary: true }],
      });
      if (r.value === 'cancel') return;
      if (r.value === 'saved') p = existing;
      if (r.value === 'copy') {
        p.id = uid();
        p.name = `${p.name} (copy)`.slice(0, 200);
      }
    }
    store.readOnly = false;
    store.presenter = false;
    hideBanner();
    addPlan(p);
    toast(persistent ? 'Editing unlocked. Changes are saved in this browser.' : 'Editing unlocked, but browser storage is unavailable: use Export JSON to keep changes.', persistent ? 'info' : 'error', 6000);
  }

  // ---- toolbar menus --------------------------------------------------------
  function baselineMenu(anchor) {
    const p = store.plan;
    const has = !!p.baselineSavedAt;
    openMenu(anchor, [
      { label: has ? 'Save baseline again (replace)' : 'Save baseline', disabled: store.readOnly, action: async () => {
        if (has && !(await confirmBox(`Replace the baseline saved ${fmtStamp(p.baselineSavedAt)}?`, { ok: 'Replace' }))) return;
        store.commit('Save baseline', (pl) => {
          saveBaseline(pl);
          pl.settings.showBaseline = true;
        }, { touch: false, schedule: false });
        toast('Baseline saved. Ghost bars and the Variance column show slippage from here.');
      } },
      { label: 'Show baseline & variance', checked: !!p.settings.showBaseline, disabled: !has, action: () => store.commit('Show baseline', (pl) => {
        pl.settings.showBaseline = !pl.settings.showBaseline;
      }, UI) },
      { label: 'Clear baseline', danger: true, disabled: !has || store.readOnly, action: () => store.commit('Clear baseline', (pl) => {
        clearBaseline(pl);
        pl.settings.showBaseline = false;
      }, { touch: false, schedule: false }) },
      ...(has ? [{ sep: true }, { heading: `Saved ${fmtStamp(p.baselineSavedAt)}` }] : []),
    ], { label: 'Baseline' });
  }

  function columnsMenu(anchor) {
    const cols = columnState(store.plan).filter((c) => !c.fixed);
    openMenu(anchor, [
      { heading: 'Show columns' },
      ...cols.map((c) => ({
        label: c.key === 'progress' ? 'Progress %' : c.key === 'duration' ? 'Duration' : c.label,
        checked: c.visible,
        keepOpen: true,
        action: (on) => store.commit('Columns', (p) => {
          const cs = (p.settings.columns = p.settings.columns || {});
          cs[c.key] = { ...(cs[c.key] || {}), visible: on, explicit: true };
        }, UI),
      })),
      { sep: true },
      { label: 'Reset columns & widths', action: () => store.commit('Reset columns', (p) => {
        p.settings.columns = null;
      }, UI) },
    ], { label: 'Columns' });
  }

  function conflictsMenu(anchor) {
    const o = store.d.tree.outline;
    openMenu(anchor, [
      { heading: 'Violated dependencies' },
      ...store.d.conflicts.map((c) => ({
        label: `${o.get(c.predId)} → ${o.get(c.succId)} (${c.type}${formatLag(c.lag)}): ${c.days} day${c.days === 1 ? '' : 's'} early`,
        action: () => {
          if (store.view !== 'plan') setView('plan');
          reveal(c.succId);
          select(c.succId, { col: 'start' });
          app.grid.ensureVisible(c.succId);
          app.grid.focus();
        },
      })),
      { sep: true },
      { label: 'Turn on Auto-schedule to fix all', disabled: store.readOnly, action: toggleAuto },
    ], { label: 'Conflicts' });
  }

  function toggleAuto() {
    const on = !store.plan.settings.autoSchedule;
    store.commit(on ? 'Auto-schedule on' : 'Auto-schedule off', (p) => {
      p.settings.autoSchedule = on;
    }, { touch: true });
    toast(on ? 'Auto-schedule on: successors move to satisfy their links.' : 'Auto-schedule off: violated links are drawn in red and listed under Conflicts.');
  }

  // ---- filters, views, theme, presenter ------------------------------------
  const search = q('.search');
  let searchTimer = 0;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setFilter('text', search.value), 120);
  });
  root.querySelectorAll('[data-filter]').forEach((sel) => sel.addEventListener('change', () => setFilter(sel.dataset.filter, sel.value)));
  function setFilter(k, v) {
    store.filter = { ...store.filter, [k]: v };
    store.ui(true);
  }
  function clearFilters() {
    store.filter = { text: '', owner: '', status: '', section: '', overdue: false };
    search.value = '';
    store.ui(true);
  }

  function setView(v) {
    store.view = v;
    store.ui();
    if (v === 'plan') app.grid.focus();
  }

  function togglePresenter() {
    store.presenter = !store.presenter;
    store.ui();
  }

  function cycleTheme() {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    applyTheme(theme);
    storage.setPrefs({ theme });
    store.ui();
  }

  function showHelp() {
    const rows = [
      ['↑ ↓ ← →', 'Move between cells (Shift+↑/↓ extends the selection)'],
      ['Enter / F2', 'Edit the cell. Enter on the # column opens the task card'],
      ['Shift+Enter', 'Open the task card'],
      ['Type any key', 'Start editing the cell'],
      ['Esc', 'Cancel editing / close the card. Press again to let Tab leave the grid'],
      ['Tab / Shift+Tab', 'Indent / outdent the selected tasks'],
      [`Insert or ${K}+Enter`, 'New task below; Shift+Insert = new section'],
      ['Delete', 'Delete the selected rows (asks first)'],
      ['Alt+Shift+↑/↓', 'Move rows up / down'],
      ['Alt+← / Alt+→ or Space', 'Collapse / expand a summary task or section'],
      [`${K}+Z / Shift+${K}+Z`, 'Undo / redo (also Ctrl+Y)'],
      [`${K}+F`, 'Search'],
      [`${K}+S`, 'Save the plan into this .html file (Edge / Chrome write it in place; other browsers download an updated copy)'],
      [`Shift+${K}+S`, 'Save as: write to a new file'],
      ['Gantt', 'Drag a bar to move it, drag its right edge to change the finish. Drag the small circle at a bar’s start or finish onto another bar to link them (drop on the left half → successor start, right half → successor finish). Click an arrow to edit or delete it; double-click a bar to open the card.'],
      ['Predecessors', 'Type outline numbers or #IDs with optional type and lag: 3, 1.2FS+2d, #7SS-1d, 4FF+1d, 5SF'],
      ['Board', 'Drag cards between columns; Shift+←/→ moves the focused card'],
      ['Grid rows', 'Drag the # cell to reorder; drop on the middle of a task to make it a subtask'],
    ];
    modal({
      title: 'Keyboard shortcuts & tips',
      wide: true,
      body: `<table class="kbd-table">${rows.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join('')}</table><h3 class="help-h">How to share</h3><ol class="help-share"><li>Put this .html file on OneDrive, Teams or SharePoint (or any shared folder).</li><li>Open it in Edge or Chrome, for example from the synced OneDrive folder.</li><li>Edit, then press <b>Save</b> (${esc(K)}+S). The first time, pick the original file to overwrite it; after that Save writes straight to it.</li><li>In Safari or Firefox, Save downloads an updated copy: replace the original file with it.</li></ol><p class="hint">Edits are also autosaved in this browser (localStorage) as a safety net. Export JSON for backups; File → Export read-only presenter copy makes a version others cannot edit.</p>`,
      actions: [{ label: 'Close', value: 'cancel', primary: true }],
    });
  }

  // ---- header & toolbar wiring ---------------------------------------------
  const ACTS = {
    'use-file': useFileVersion,
    save: () => saveToFile(false),
    'banner-close': hideBanner,
    'add-task': addTask,
    'add-section': () => addSection(),
    indent: app.indent,
    outdent: app.outdent,
    delete: app.deleteSelection,
    undo: () => store.undo() || toast('Nothing to undo.'),
    redo: () => store.redo() || toast('Nothing to redo.'),
    'expand-all': () => setCollapsedAll(false),
    'collapse-all': () => setCollapsedAll(true),
    fit: () => store.commit('Zoom', (p) => {
      p.settings.zoom = 'fit';
    }, UI),
    today: () => app.gantt.scrollToDay(today()),
    auto: toggleAuto,
    critical: () => store.commit('Critical path', (p) => {
      p.settings.showCritical = !p.settings.showCritical;
    }, UI),
    baseline: baselineMenu,
    columns: columnsMenu,
    conflicts: conflictsMenu,
    'f-overdue': () => setFilter('overdue', !store.filter.overdue),
    'f-clear': clearFilters,
    file: fileMenu,
    plans: plansMenu,
    'view-plan': () => setView('plan'),
    'view-board': () => setView('board'),
    'view-logs': () => setView('logs'),
    present: togglePresenter,
    theme: cycleTheme,
    unlock,
    help: showHelp,
  };
  for (const scope of [q('.top'), q('.banner'), q('.toolbar')]) {
    scope.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && scope.contains(b) && ACTS[b.dataset.act]) ACTS[b.dataset.act](b, e);
    });
  }
  q('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = VIEWS.indexOf(store.view) + (e.key === 'ArrowRight' ? 1 : -1);
    const v = VIEWS[(i + VIEWS.length) % VIEWS.length];
    setView(v);
    q(`[data-act="view-${v}"]`).focus();
  });
  root.querySelectorAll('[data-set]').forEach((sel) =>
    sel.addEventListener('change', () => store.commit('Setting', (p) => {
      p.settings[sel.dataset.set] = sel.value;
    }, UI))
  );
  q('.plan-name').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (!v) {
      e.target.value = store.plan.name;
      return;
    }
    store.commit('Rename plan', (p) => {
      p.name = v.slice(0, 200);
    }, { touch: false, schedule: false });
  });
  q('.plan-name').addEventListener('keydown', (e) => e.key === 'Enter' && e.target.blur());
  root.querySelectorAll('[data-p]').forEach((inp) =>
    inp.addEventListener('change', () => {
      const f = inp.dataset.p;
      const v = inp.value.trim();
      if (f === 'start' && !isISODate(v)) {
        toast('Enter a valid start date.', 'error');
        return render();
      }
      if (f === 'statusDate' && v && !isISODate(v)) return render();
      store.commit(`Edit plan ${f}`, (p) => {
        p[f] = v.slice(0, 200);
      }, { touch: false, schedule: false });
      return undefined;
    })
  );

  // splitter
  const sp = q('.splitter');
  const viewPlan = q('.view-plan');
  const clampW = (w) => Math.round(Math.max(220, Math.min(window.innerWidth - 220, w)));
  const gridWidth = () => clampW(store.plan.settings.gridWidth || Math.min(820, window.innerWidth * 0.5));
  const saveGridWidth = (w) => store.commit('Resize panes', (p) => {
    p.settings.gridWidth = w;
  }, UI);
  sp.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sp.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = q('.grid-pane').getBoundingClientRect().width;
    let w = w0;
    const mv = (ev) => {
      w = clampW(w0 + ev.clientX - x0);
      viewPlan.style.setProperty('--grid-w', `${w}px`);
    };
    const up = () => {
      sp.removeEventListener('pointermove', mv);
      sp.removeEventListener('pointerup', up);
      saveGridWidth(w);
    };
    sp.addEventListener('pointermove', mv);
    sp.addEventListener('pointerup', up);
  });
  sp.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    saveGridWidth(clampW(gridWidth() + (e.key === 'ArrowRight' ? 40 : -40)));
  });

  // ---- render -------------------------------------------------------------
  const setVal = (el, v) => {
    if (document.activeElement !== el && el.value !== v) el.value = v;
  };
  function fillSelect(sel, opts, all) {
    const sig = JSON.stringify(opts);
    if (sel.dataset.sig !== sig) {
      sel.innerHTML = `<option value="">${esc(all)}</option>${opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}`;
      sel.dataset.sig = sig;
    }
    sel.value = store.filter[sel.dataset.filter] || '';
    sel.classList.toggle('on', !!sel.value);
  }

  function updateSaveState() {
    const el = q('.save-state');
    const btn = q('[data-act="save"]');
    const unsaved = !store.readOnly && hasUnsaved(fileState);
    btn.classList.toggle('primary', unsaved);
    el.classList.toggle('dirty', unsaved);
    if (store.readOnly) {
      el.textContent = store.embedded ? 'Shared copy' : '';
      el.classList.remove('err');
      el.title = '';
      return;
    }
    let text = saveStatusText(fileState);
    let err = fileState.status === 'failed';
    const browser = !persistent ? 'browser storage unavailable' : store.saveState === 'error' ? 'browser storage full' : '';
    if (browser) {
      text += ` · not autosaved (${browser})`;
      err = true;
    }
    el.textContent = text;
    el.classList.toggle('err', err);
    const target = saver.fileName ? `“${saver.fileName}”` : 'the .html file';
    el.title = `${fileState.status === 'failed' ? `${fileState.error}. ` : ''}Edits are autosaved in this browser. ${saver.supported ? `Save (${K}+S) writes them into ${target}.` : `Save (${K}+S) downloads an updated copy of the file.`}`;
  }

  function renderHeader() {
    const p = store.plan;
    setVal(q('.plan-name'), p.name);
    root.querySelectorAll('[data-p]').forEach((inp) => setVal(inp, p[inp.dataset.p] || ''));
    const st = planStats(p, store.d.tree);
    const n = store.d.conflicts.length;
    q('.stats').innerHTML = `<span class="chip" title="Tasks excluding summaries">${st.tasks} tasks</span>
<span class="chip" title="Duration-weighted progress"><span class="bar-mini" aria-hidden="true"><span style="width:${st.percent}%"></span></span><b>${st.percent}%</b>&nbsp;done</span>
<span class="chip">Finish&nbsp;<b>${esc(fmtDateLong(st.finish))}</b></span>
<button type="button" class="chip${st.overdue ? ' bad' : ''}" data-act="f-overdue" aria-pressed="${!!store.filter.overdue}" title="Filter overdue tasks"><b>${st.overdue}</b>&nbsp;overdue</button>
${n ? `<button type="button" class="chip conf" data-act="conflicts" aria-haspopup="menu" title="Dependencies that are not satisfied">⚠ <b>${n}</b>&nbsp;conflict${n === 1 ? '' : 's'}</button>` : ''}`;
  }

  function renderToolbar() {
    const s = store.plan.settings;
    const pressed = (act, v) => root.querySelectorAll(`[data-act="${act}"]`).forEach((b) => b.setAttribute('aria-pressed', String(!!v)));
    pressed('auto', s.autoSchedule);
    pressed('critical', s.showCritical);
    pressed('f-overdue', store.filter.overdue);
    pressed('present', store.presenter);
    q('[data-act="undo"]').disabled = !store.undoStack.length;
    q('[data-act="redo"]').disabled = !store.redoStack.length;
    q('[data-act="theme"]').textContent = `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`;
    q('[data-act="present"]').textContent = store.presenter ? 'Exit presenter' : 'Present';
    root.querySelectorAll('[data-set]').forEach((sel) => setVal(sel, s[sel.dataset.set]));
    const tasks = store.d.tree.tasks;
    fillSelect(q('[data-filter="owner"]'), [...new Set(tasks.map((t) => t.owner).filter(Boolean))].sort().map((o) => [o, o]), 'All owners');
    fillSelect(q('[data-filter="status"]'), STATUSES.map((x) => [x, x]), 'All statuses');
    fillSelect(q('[data-filter="section"]'), store.plan.rows.filter((r) => !isTask(r)).map((r) => [String(r.id), r.name]), 'All sections');
    if (document.activeElement !== search) search.value = store.filter.text;
    q('.filters').classList.toggle('active', !!store.d.matches);
    for (const v of VIEWS) q(`[data-act="view-${v}"]`).setAttribute('aria-selected', String(store.view === v));
  }

  function render() {
    const b = document.body.classList;
    b.toggle('presenter', store.presenter);
    b.toggle('readonly', store.readOnly);
    for (const v of VIEWS) {
      b.toggle(`view-${v}-on`, store.view === v);
      q(`.view-${v}`).hidden = store.view !== v;
    }
    viewPlan.style.setProperty('--grid-w', `${gridWidth()}px`);
    renderHeader();
    renderToolbar();
    updateSaveState();
    if (store.view === 'plan') {
      app.grid.render();
      app.gantt.render();
    } else if (store.view === 'board') app.board.render();
    else app.logs.render();
    card.render();
    document.title = `${store.plan.name} · Planboard`;
  }

  app.grid = createGrid(app, q('.grid-pane'));
  app.gantt = createGantt(app, q('.gantt-pane'));
  app.board = createBoard(app, q('.view-board'));
  app.logs = createLogs(app, q('.view-logs'));
  const card = createCard(app, q('.card'));

  store.on((kind, data) => {
    if (kind === 'change') {
      render();
      if (data && data.moved && data.moved.size) toast(`Auto-schedule moved ${data.moved.size} task${data.moved.size === 1 ? '' : 's'}.`, 'info', 2500);
    } else if (kind === 'error') toast(data, 'error', 6000);
    else if (kind === 'warn') toast(data, 'warn', 6000);
    else if (kind === 'edit') fileState = saveReducer(fileState, { type: 'edit' });
    else if (kind === 'load') {
      fileState = initialSaveState(false);
      saver.bind(store.plan.id, fileStampFor(store.plan.id)).then(updateSaveState);
    } else if (kind === 'readonly') toast('This is a read-only copy. Click “Unlock editing” to make changes.');
    else if (kind === 'saved') updateSaveState();
  });

  // ---- global keys, drag & drop files, lifecycle ---------------------------
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (mod(e) && !e.altKey && k === 'z') {
      if (isTyping(e)) return;
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (mod(e) && !e.altKey && k === 'y' && !isTyping(e)) {
      e.preventDefault();
      store.redo();
    } else if (mod(e) && !e.altKey && k === 's') {
      e.preventDefault();
      if (isTyping(e)) e.target.blur();
      const saveAs = e.shiftKey;
      setTimeout(() => saveToFile(saveAs));
    } else if (mod(e) && !e.altKey && k === 'f') {
      e.preventDefault();
      search.focus();
      search.select();
    } else if (k === 'Escape' && !isMenuOpen()) {
      if (store.cardId != null) closeCard();
      else if (document.activeElement === search && search.value) clearFilters();
    } else if (k === '?' && !isTyping(e)) {
      e.preventDefault();
      showHelp();
    }
  });

  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    document.body.classList.add('drop-on');
  });
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('drop-on');
  });
  document.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('drop-on');
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  window.addEventListener('beforeunload', (e) => {
    store.flush();
    if (!store.readOnly && hasUnsaved(fileState)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('pagehide', () => store.flush());
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 120);
  });

  render();
  if (opened && opened.source === 'saved') showBanner('Showing your saved edits (newer than this file).');
  else if (opened && fileReport.droppedLinks.length) toast(droppedNote(fileReport).trim(), 'warn', 6000);
  if (!store.persistent && !persistent && !store.readOnly) toast('Browser storage is unavailable (private mode?): changes will not be saved. Use Export JSON.', 'error', 8000);
  if (store.readOnly) toast('Read-only shared copy. Click “Unlock editing” to make changes.', 'info', 5000);
  else app.grid.focus();
  window.planboard = app;
  return app;
}
