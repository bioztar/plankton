// Board view: kanban columns by status; cards drag between columns.
import { escapeHtml as esc } from '../../util/escape.js';
import { statusNames, optionColor } from '../../model/options.js';
import { setTaskField } from '../../model/edit.js';
import { isOverdue, statusDay } from '../../model/stats.js';
import { fmtDate, statusSlug } from '../format.js';
import { parseISO, toYMD } from '../../schedule/calendar.js';
import { preserveFocus } from '../dom.js';
import { descText, firstLine } from '../../util/sanitize.js';

export function createBoard(app, root) {
  const store = app.store;

  function render() {
    const d = store.d;
    const day = statusDay(store.plan);
    const year = toYMD(parseISO(store.plan.start))[0];
    const leaves = d.tree.tasks.filter((t) => !d.tree.isSummary(t.id) && (!d.matches || d.matches.has(t.id)));
    const ro = store.readOnly;
    const plan = store.plan;
    const cols = statusNames(plan).map((s) => {
      const cards = leaves
        .filter((t) => t.status === s)
        .map((t) => {
          const sec = d.tree.byId.get(d.tree.sectionOf.get(t.id));
          const parent = d.tree.byId.get(d.tree.parent.get(t.id));
          const od = isOverdue(t, day, plan);
          return `<article class="bcard${store.selection.has(t.id) ? ' sel' : ''}${d.done.has(t.id) ? ' done' : ''}" draggable="${!ro}" tabindex="0" data-id="${t.id}" data-key="bc-${t.id}" style="--sec:${sec ? sec.color : 'var(--line)'}" aria-label="${esc(t.name)}, ${esc(s)}. Enter opens, Shift+Arrow moves.">
<div class="bc-top"><span class="bc-num">${esc(d.tree.outline.get(t.id))}</span>${sec ? `<span class="bc-sec">${esc(sec.name)}</span>` : ''}${t.priority === 'High' || t.priority === 'Critical' ? `<span class="prio pr-${t.priority.toLowerCase()}">${t.priority}</span>` : ''}</div>
<div class="bc-name">${d.done.has(t.id) ? '<span class="done-ck" aria-label="Complete">✓</span> ' : ''}${t.milestone ? '<span class="ms-ic">◆</span> ' : ''}${esc(t.name)}</div>
${parent ? `<div class="bc-parent">${esc(parent.name)}</div>` : ''}
${firstLine(descText(t)) ? `<div class="bc-desc">${esc(firstLine(descText(t), 120))}</div>` : ''}
<div class="bc-meta"><span>${esc(t.owner || 'Unassigned')}</span><span class="${od ? 'overdue-txt' : ''}">${od ? 'Overdue · ' : ''}${esc(fmtDate(t.finish, year))}</span></div>
<div class="bc-prog" aria-hidden="true"><span style="width:${t.progress}%"></span></div></article>`;
        })
        .join('');
      const n = leaves.filter((t) => t.status === s).length;
      return `<section class="bcol" data-status="${esc(s)}" aria-label="${esc(s)} (${n})"><h3><span class="dot st-${statusSlug(s)}" style="background:${optionColor(plan, 'status', s)}"></span>${esc(s)} <span class="cnt">${n}</span></h3><div class="bcards">${cards || '<p class="muted bc-empty">No tasks</p>'}</div></section>`;
    }).join('');
    preserveFocus(root, () => {
      root.innerHTML = `<div class="board">${cols}</div>`;
    });
  }

  const setStatus = (id, status) => {
    store.commit('Change status', (plan) => setTaskField(plan.rows.find((r) => r.id === id), 'status', status, undefined, plan) || undefined);
  };

  root.addEventListener('dragstart', (e) => {
    const c = e.target.closest('.bcard');
    if (!c) return;
    e.dataTransfer.setData('text/plain', c.dataset.id);
    e.dataTransfer.setData('application/x-planboard-task', c.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('dragging');
  });
  root.addEventListener('dragend', (e) => {
    const c = e.target.closest('.bcard');
    if (c) c.classList.remove('dragging');
    root.querySelectorAll('.bcol.over').forEach((n) => n.classList.remove('over'));
  });
  root.addEventListener('dragover', (e) => {
    const col = e.target.closest('.bcol');
    if (!col || !e.dataTransfer.types.includes('application/x-planboard-task')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    root.querySelectorAll('.bcol.over').forEach((n) => n !== col && n.classList.remove('over'));
    col.classList.add('over');
  });
  root.addEventListener('drop', (e) => {
    const col = e.target.closest('.bcol');
    const id = Number(e.dataTransfer.getData('application/x-planboard-task'));
    if (!col || !id) return;
    e.preventDefault();
    e.stopPropagation();
    col.classList.remove('over');
    setStatus(id, col.dataset.status);
  });
  root.addEventListener('click', (e) => {
    const c = e.target.closest('.bcard');
    if (c) app.openCard(Number(c.dataset.id));
  });
  root.addEventListener('keydown', (e) => {
    const c = e.target.closest('.bcard');
    if (!c) return;
    const id = Number(c.dataset.id);
    if (e.key === 'Enter') {
      e.preventDefault();
      app.openCard(id);
    } else if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const t = store.d.tree.byId.get(id);
      const names = statusNames(store.plan);
      const i = names.indexOf(t.status) + (e.key === 'ArrowRight' ? 1 : -1);
      if (i >= 0 && i < names.length) setStatus(id, names[i]);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cards = [...c.closest('.bcards').querySelectorAll('.bcard')];
      const n = cards[cards.indexOf(c) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (n) n.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const cols = [...root.querySelectorAll('.bcol')];
      const ci = cols.indexOf(c.closest('.bcol')) + (e.key === 'ArrowRight' ? 1 : -1);
      const n = cols[ci] && cols[ci].querySelector('.bcard');
      if (n) n.focus();
    }
  });

  return { render };
}
