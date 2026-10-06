// Logs view: editable Risks, Decisions and Open questions tables (stored in the plan JSON).
import { escapeHtml as esc } from '../../util/escape.js';
import { LOG_STATUSES, LEVELS } from '../../model/plan.js';
import { preserveFocus, on, deferWhileFocused } from '../dom.js';

const DEFS = {
  risks: {
    title: 'Risks',
    one: 'risk',
    cols: [['risk', 'Risk', 'area', '28%'], ['impact', 'Impact', 'level', '9%'], ['likelihood', 'Likelihood', 'level', '9%'], ['mitigation', 'Mitigation', 'area', '28%'], ['owner', 'Owner', 'text', '12%'], ['status', 'Status', 'status', '11%']],
  },
  decisions: {
    title: 'Decisions',
    one: 'decision',
    cols: [['decision', 'Decision', 'area', '52%'], ['by', 'By', 'text', '16%'], ['date', 'Date', 'date', '14%'], ['status', 'Status', 'status', '14%']],
  },
  questions: {
    title: 'Open questions',
    one: 'question',
    cols: [['question', 'Question', 'area', '36%'], ['owner', 'Owner', 'text', '13%'], ['answer', 'Answer', 'area', '36%'], ['status', 'Status', 'status', '11%']],
  },
};

export function createLogs(app, root) {
  const render = deferWhileFocused(root, renderNow);
  const store = app.store;
  let pendingFocus = null;

  function field(kind, e, [f, label, type]) {
    const key = `${kind}-${e.id}-${f}`;
    const v = e[f] || '';
    const ro = store.readOnly ? ' disabled' : '';
    const a = `data-log="${kind}" data-eid="${e.id}" data-f="${f}" data-key="${key}" aria-label="${esc(label)}"${ro}`;
    if (type === 'area') return `<textarea rows="2" ${a}>${esc(v)}</textarea>`;
    if (type === 'level') return `<select ${a}><option value=""></option>${LEVELS.map((l) => `<option${l === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    if (type === 'status') return `<select ${a}>${LOG_STATUSES[kind].map((l) => `<option${l === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    if (type === 'date') return `<input type="date" value="${esc(v)}" ${a}>`;
    return `<input value="${esc(v)}" ${a}>`;
  }

  function renderNow() {
    const logs = store.plan.logs;
    const html = Object.entries(DEFS)
      .map(([kind, def]) => {
        const list = logs[kind];
        const open = list.filter((e) => e.status === LOG_STATUSES[kind][0]).length;
        const rows = list
          .map(
            (e) =>
              `<tr data-eid="${e.id}">${def.cols.map((c) => `<td>${field(kind, e, c)}</td>`).join('')}<td class="log-act">${store.readOnly ? '' : `<button type="button" class="btn ic" data-act="del" data-log="${kind}" data-eid="${e.id}" aria-label="Delete ${def.one}">×</button>`}</td></tr>`
          )
          .join('');
        return `<section class="log-sec" aria-labelledby="lh-${kind}"><h2 id="lh-${kind}">${def.title} <span class="cnt">${list.length} · ${open} ${esc(LOG_STATUSES[kind][0].toLowerCase())}</span></h2>
<table class="log"><colgroup>${def.cols.map((c) => `<col style="width:${c[3]}">`).join('')}<col style="width:40px"></colgroup>
<thead><tr>${def.cols.map((c) => `<th scope="col">${c[1]}</th>`).join('')}<th><span class="sr-only">Actions</span></th></tr></thead>
<tbody>${rows || `<tr><td colspan="${def.cols.length + 1}" class="muted">No ${def.title.toLowerCase()} yet.</td></tr>`}</tbody></table>
${store.readOnly ? '' : `<button type="button" class="btn sm log-add" data-act="add" data-log="${kind}">+ Add ${def.one}</button>`}</section>`;
      })
      .join('');
    preserveFocus(root, () => {
      root.innerHTML = `<div class="logs">${html}</div>`;
    });
    if (pendingFocus) {
      const n = root.querySelector(`[data-key="${pendingFocus}"]`);
      if (n) n.focus();
      pendingFocus = null;
    }
  }

  const opts = { schedule: false, touch: false };
  on(root, 'change', '[data-f]', (e, el) => {
    const kind = el.dataset.log;
    const id = Number(el.dataset.eid);
    store.commit(
      'Edit log',
      (plan) => {
        const entry = plan.logs[kind].find((x) => x.id === id);
        if (entry) entry[el.dataset.f] = el.value.slice(0, 4000);
      },
      opts
    );
  });
  on(root, 'click', '[data-act]', (e, el) => {
    const kind = el.dataset.log;
    if (el.dataset.act === 'add') {
      store.commit(
        'Add log entry',
        (plan) => {
          const list = plan.logs[kind];
          const id = list.reduce((m, x) => Math.max(m, x.id), 0) + 1;
          const entry = { id };
          for (const [f] of DEFS[kind].cols) entry[f] = '';
          entry.status = LOG_STATUSES[kind][0];
          list.push(entry);
          pendingFocus = `${kind}-${id}-${DEFS[kind].cols[0][0]}`;
        },
        opts
      );
    } else if (el.dataset.act === 'del') {
      const id = Number(el.dataset.eid);
      store.commit(
        'Delete log entry',
        (plan) => {
          plan.logs[kind] = plan.logs[kind].filter((x) => x.id !== id);
        },
        opts
      );
      app.toast('Entry deleted (Ctrl/⌘+Z to undo).');
    }
  });

  return { render };
}
