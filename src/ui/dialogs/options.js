// "Edit options…" dialog for Status, Priority and custom single-select columns:
// add, rename, reorder (drag or ↑/↓), delete (choosing where tasks move), a
// colour per option and, for Status, "counts as complete".
import { modal } from './modal.js';
import { escapeHtml as esc } from '../../util/escape.js';
import { getOptionList, optionUsage, applyOptionList, OPTION_COLORS, MAX_LIST_OPTIONS } from '../../model/options.js';
import { findField } from '../../model/fields.js';

const TITLES = { status: 'Status', priority: 'Priority' };

export async function openOptionsEditor(app, target) {
  const store = app.store;
  if (store.readOnly) return store.emit('readonly');
  const builtIn = target === 'status' || target === 'priority';
  const field = builtIn ? null : findField(store.plan, target);
  if (!builtIn && !field) return undefined;
  const title = builtIn ? TITLES[target] : field.name;
  const items = getOptionList(store.plan, target).map((o) => {
    const x = typeof o === 'string' ? { name: o } : o;
    return { from: x.name, name: x.name, color: x.color || '', complete: !!x.complete, deleted: false, moveTo: null, used: optionUsage(store.plan, target, x.name) };
  });
  let result = null;
  let dragFrom = -1;

  const rowHTML = (it, i) => {
    if (it.deleted) {
      const alive = items.filter((x) => !x.deleted && x.name.trim());
      const choose = it.used
        ? ` · move its ${it.used} task${it.used === 1 ? '' : 's'} to <select class="opt-move" data-i="${i}" aria-label="Move tasks using ${esc(it.from)} to">${builtIn ? '' : `<option value=""${it.moveTo === '' ? ' selected' : ''}>(no value)</option>`}<option value="" disabled${it.moveTo == null ? ' selected' : ''}>choose…</option>${alive.map((x) => `<option${x.name === it.moveTo ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
        : '';
      return `<li class="opt-row deleted" data-i="${i}"><span class="opt-gone">“${esc(it.from)}” will be deleted${choose}</span><button type="button" class="btn sm" data-a="undel" data-i="${i}">Keep</button></li>`;
    }
    return `<li class="opt-row" data-i="${i}" draggable="true">
<span class="drag" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
${builtIn ? `<input type="color" class="opt-color" data-i="${i}" value="${esc(it.color || OPTION_COLORS[i % OPTION_COLORS.length])}" aria-label="Colour of ${esc(it.name)}">` : ''}
<input class="opt-name" data-i="${i}" value="${esc(it.name)}" maxlength="${builtIn ? 60 : 100}" aria-label="Option name" placeholder="Option name">
${target === 'status' ? `<label class="opt-done" title="Tasks with this status count as complete: green row, ✓, 100 %"><input type="checkbox" class="opt-cmp" data-i="${i}"${it.complete ? ' checked' : ''}> counts as complete</label>` : ''}
<span class="opt-use muted">${it.used ? `${it.used} task${it.used === 1 ? '' : 's'}` : ''}</span>
<button type="button" class="btn ic sm" data-a="up" data-i="${i}" aria-label="Move ${esc(it.name)} up" title="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
<button type="button" class="btn ic sm" data-a="down" data-i="${i}" aria-label="Move ${esc(it.name)} down" title="Move down"${i === items.length - 1 ? ' disabled' : ''}>↓</button>
<button type="button" class="btn ic sm danger" data-a="del" data-i="${i}" aria-label="Delete ${esc(it.name)}" title="Delete">✕</button></li>`;
  };

  const r = await modal({
    title: `Edit options: ${title}`,
    wide: true,
    body: `<p class="hint">Renaming updates every task that uses the option. Drag ⋮⋮ (or use ↑/↓) to reorder${builtIn ? '; the first option is the default for new tasks' : ''}.</p>
<ul class="opt-list" aria-label="Options"></ul>
<button type="button" class="btn sm opt-add" data-a="add">+ Add option</button>
<p class="warn opt-err" aria-live="polite"></p>`,
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Save options', value: 'ok', primary: true }],
    onMount: (dlg) => {
      const list = dlg.querySelector('.opt-list');
      const err = dlg.querySelector('.opt-err');
      const draw = (focusI, sel = '.opt-name') => {
        list.innerHTML = items.map(rowHTML).join('');
        if (focusI != null) {
          const n = list.querySelector(`${sel}[data-i="${focusI}"]`) || list.querySelector(`[data-i="${focusI}"] .opt-name`);
          if (n) n.focus();
        }
      };
      const swap = (i, j) => {
        if (j < 0 || j >= items.length) return;
        [items[i], items[j]] = [items[j], items[i]];
      };
      list.addEventListener('input', (e) => {
        const i = Number(e.target.dataset.i);
        if (e.target.classList.contains('opt-name')) items[i].name = e.target.value;
        if (e.target.classList.contains('opt-color')) items[i].color = e.target.value;
      });
      list.addEventListener('change', (e) => {
        const i = Number(e.target.dataset.i);
        if (e.target.classList.contains('opt-cmp')) items[i].complete = e.target.checked;
        if (e.target.classList.contains('opt-move')) items[i].moveTo = e.target.value;
        if (e.target.classList.contains('opt-name')) draw(); // refresh "move to" choices
      });
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        const i = Number(b.dataset.i);
        err.textContent = '';
        if (b.dataset.a === 'add') {
          if (items.filter((x) => !x.deleted).length >= MAX_LIST_OPTIONS) return void (err.textContent = `At most ${MAX_LIST_OPTIONS} options.`);
          items.push({ from: null, name: '', color: OPTION_COLORS[items.length % OPTION_COLORS.length], complete: false, deleted: false, moveTo: null, used: 0 });
          return draw(items.length - 1);
        }
        if (b.dataset.a === 'up' || b.dataset.a === 'down') {
          const j = i + (b.dataset.a === 'up' ? -1 : 1);
          swap(i, j);
          return draw(j, `[data-a="${b.dataset.a}"]`);
        }
        if (b.dataset.a === 'del') {
          if (items[i].from == null) items.splice(i, 1);
          else items[i].deleted = true;
          return draw();
        }
        if (b.dataset.a === 'undel') {
          items[i].deleted = false;
          items[i].moveTo = null;
          return draw(i);
        }
        return undefined;
      });
      list.addEventListener('dragstart', (e) => {
        const li = e.target.closest('.opt-row');
        if (!li || e.target.closest('input')) return;
        dragFrom = Number(li.dataset.i);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragFrom));
        li.classList.add('dragging');
      });
      list.addEventListener('dragover', (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        list.querySelectorAll('.drop-before').forEach((n) => n.classList.remove('drop-before'));
        const li = e.target.closest('.opt-row');
        if (li) li.classList.add('drop-before');
      });
      list.addEventListener('drop', (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        const li = e.target.closest('.opt-row');
        const to = li ? Number(li.dataset.i) : items.length - 1;
        const [it] = items.splice(dragFrom, 1);
        items.splice(to, 0, it);
        dragFrom = -1;
        draw();
      });
      list.addEventListener('dragend', () => {
        dragFrom = -1;
        draw();
      });
      draw();
    },
    onAction: (v, dlg) => {
      let err = null;
      store.commit(`Edit ${title} options`, (p) => {
        const res = applyOptionList(p, target, items.map(({ from, name, color, complete, deleted, moveTo }) => ({ from, name, color, complete, deleted, moveTo })));
        if (res.error) {
          err = res.error;
          return false;
        }
        result = res;
        return undefined;
      });
      if (err) {
        dlg.querySelector('.opt-err').textContent = err;
        return false;
      }
      return true;
    },
  });
  if (r.value === 'ok' && result) {
    const parts = [];
    if (result.renamed) parts.push(`${result.renamed} task${result.renamed === 1 ? '' : 's'} renamed`);
    if (result.moved) parts.push(`${result.moved} moved`);
    app.toast(`${title} options saved${parts.length ? ` (${parts.join(', ')})` : ''}.`);
  }
  return result;
}
