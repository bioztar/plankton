// Task card (side panel) with every task field, predecessors and custom fields.
import { escapeHtml as esc } from '../../util/escape.js';
import { renderMarkdown } from '../../util/markdown.js';
import { STATUSES, PRIORITIES } from '../../model/plan.js';
import { setTaskField, resolveRef, addLink, removeLink, setPredsFromText, predsText } from '../../model/edit.js';
import { LINK_TYPES, LINK_LABELS } from '../../schedule/links.js';
import { fmtStamp } from '../format.js';
import { preserveFocus, on, deferWhileFocused } from '../dom.js';

export function createCard(app, root) {
  const render = deferWhileFocused(root, renderNow);
  const store = app.store;
  let descEdit = false;
  let lastId = null;
  const pinned = new Map();
  let pendingFocus = null;
  root.setAttribute('role', 'complementary');
  root.setAttribute('aria-label', 'Task card');

  const opt = (list, v) => list.map((s) => `<option${s === v ? ' selected' : ''}>${esc(s)}</option>`).join('');

  function html(t) {
    const { tree } = store.d;
    const summary = tree.isSummary(t.id);
    const ro = store.readOnly;
    const dis = (cond) => (cond || ro ? ' disabled' : '');
    const owners = [...new Set(tree.tasks.map((x) => x.owner).filter(Boolean))].sort();
    const streams = [...new Set(tree.tasks.map((x) => x.workstream).filter(Boolean))].sort();
    const succs = tree.tasks.filter((x) => x.preds.some((p) => p.id === t.id));
    const preds = t.preds
      .filter((p) => tree.byId.has(p.id))
      .map((p) => {
        const pt = tree.byId.get(p.id);
        return `<tr data-pred="${p.id}"><td><input class="pr-ref" data-key="pr-ref-${p.id}" value="${esc(tree.outline.get(p.id))}" size="5" aria-label="Predecessor (outline number or #ID)"${dis()}> <span class="pr-name" title="${esc(pt.name)}">${esc(pt.name)}</span></td>
<td><select class="pr-type" data-key="pr-type-${p.id}" aria-label="Link type"${dis()}>${LINK_TYPES.map((x) => `<option value="${x}"${x === p.type ? ' selected' : ''} title="${LINK_LABELS[x]}">${x}</option>`).join('')}</select></td>
<td><input class="pr-lag" type="number" step="1" data-key="pr-lag-${p.id}" value="${p.lag}" aria-label="Lag in working days (negative = lead)"${dis()}></td>
<td>${ro ? '' : `<button type="button" class="btn ic" data-act="pr-del" aria-label="Remove link from ${esc(pt.name)}">×</button>`}</td></tr>`;
      })
      .join('');
    const custom = t.custom
      .map(
        (c, i) =>
          `<div class="cf" data-i="${i}"><input class="cf-k" data-key="cf-k-${i}" value="${esc(c.key)}" placeholder="Field" aria-label="Custom field name"${dis()}><input class="cf-v" data-key="cf-v-${i}" value="${esc(c.value)}" placeholder="Value" aria-label="Custom field value"${dis()}>${ro ? '' : `<button type="button" class="btn ic" data-act="cf-del" aria-label="Remove field">×</button>`}</div>`
      )
      .join('');
    const desc = descEdit && !ro
      ? `<textarea data-f="desc" data-key="desc" rows="6" placeholder="Supports **bold**, *italic*, - bullet lists and [links](https://example.com)">${esc(t.desc)}</textarea>`
      : `<div class="md">${t.desc ? renderMarkdown(t.desc) : '<p class="muted">No description.</p>'}</div>`;
    return `<div class="card-head">
<span class="card-outline" title="Outline number · ID #${t.id}">${esc(tree.outline.get(t.id))}</span>
<input class="card-name" data-f="name" data-key="name" value="${esc(t.name)}" aria-label="Task name"${dis()}>
<button type="button" class="btn ic" data-act="prev" aria-label="Previous task" title="Previous task">↑</button>
<button type="button" class="btn ic" data-act="next" aria-label="Next task" title="Next task">↓</button>
<button type="button" class="btn ic" data-act="close" aria-label="Close task card" title="Close (Esc)">×</button>
</div>
<div class="card-body">
${summary ? '<p class="hint">Summary task: dates, duration and progress roll up from its subtasks.</p>' : ''}
<div class="fgrid">
<label class="fld">Start<input type="date" data-f="start" data-key="start" value="${t.start}"${dis(summary)}></label>
<label class="fld">Finish<input type="date" data-f="finish" data-key="finish" value="${t.finish}"${dis(summary || t.milestone)}></label>
<label class="fld">Duration (working days)<input type="number" min="0" step="1" data-f="duration" data-key="duration" value="${t.duration}"${dis(summary)}></label>
<label class="fld">Progress %<input type="number" min="0" max="100" step="5" data-f="progress" data-key="progress" value="${t.progress}"${dis(summary)}></label>
<label class="fld">Status<select data-f="status" data-key="status"${dis(summary)}>${opt(STATUSES, t.status)}</select></label>
<label class="fld">Priority<select data-f="priority" data-key="priority"${dis()}>${opt(PRIORITIES, t.priority)}</select></label>
<label class="fld">Owner<input data-f="owner" data-key="owner" value="${esc(t.owner)}" list="dl-owners"${dis()}></label>
<label class="fld">Workstream<input data-f="workstream" data-key="workstream" value="${esc(t.workstream)}" list="dl-streams"${dis()}></label>
<label class="fld span2">Tags (comma-separated)<input data-f="tags" data-key="tags" value="${esc(t.tags.join(', '))}"${dis()}></label>
<label class="chk"><input type="checkbox" data-f="milestone" data-key="milestone"${t.milestone ? ' checked' : ''}${dis(summary)}> Milestone</label>
</div>
<datalist id="dl-owners">${owners.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
<datalist id="dl-streams">${streams.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
<section class="card-sec"><h3>Description ${ro ? '' : `<button type="button" class="btn sm" data-act="desc-toggle">${descEdit ? 'Preview' : 'Edit'}</button>`}</h3>${desc}</section>
<section class="card-sec"><h3>Predecessors</h3>
${preds ? `<table class="preds"><thead><tr><th>Task</th><th>Type</th><th>Lag</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${preds}</tbody></table>` : '<p class="muted">None.</p>'}
${ro ? '' : `<div class="pr-add-row"><input class="pr-add" data-key="pr-add" placeholder="Add: 3, 1.2FS+2d, #7SS-1d" aria-label="Add predecessors"><button type="button" class="btn sm" data-act="pr-add">Add</button></div>`}
<p class="hint">FS finish→start · SS start→start · FF finish→finish · SF start→finish. Lag in working days, negative = lead. Refer to tasks by outline number or #ID.</p>
${succs.length ? `<p class="succ">Successors: ${succs.map((x) => `<button type="button" class="chip-link" data-open="${x.id}">${esc(tree.outline.get(x.id))} ${esc(x.name)}</button>`).join(' ')}</p>` : ''}
</section>
<section class="card-sec"><h3>Notes</h3><textarea data-f="notes" data-key="notes" rows="3"${dis()}>${esc(t.notes)}</textarea></section>
<section class="card-sec"><h3>Custom fields</h3>${custom || '<p class="muted">None.</p>'}${ro ? '' : '<button type="button" class="btn sm" data-act="cf-add">+ Add field</button>'}</section>
<footer class="card-foot"><span class="stamp">ID #${t.id} · Created ${esc(fmtStamp(t.createdAt))} · Updated ${esc(fmtStamp(t.updatedAt))}</span>${ro ? '' : '<button type="button" class="btn danger sm" data-act="delete">Delete task</button>'}</footer>
</div>`;
  }

  function renderNow() {
    const id = store.cardId;
    const t = id != null ? store.d.tree.byId.get(id) : null;
    if (!t || t.kind === 'section') {
      root.hidden = true;
      document.body.classList.remove('card-open');
      lastId = null;
      return;
    }
    if (id !== lastId) {
      descEdit = !t.desc;
      lastId = id;
    }
    root.hidden = false;
    document.body.classList.add('card-open');
    preserveFocus(root, () => {
      root.innerHTML = html(t);
    });
    if (pendingFocus) {
      const n = root.querySelector(`[data-key="${pendingFocus}"]`);
      if (n) n.focus();
      pendingFocus = null;
    }
  }

  const commitTask = (label, fn) => store.commit(label, (plan) => fn(plan.rows.find((r) => r.id === store.cardId), plan));

  on(root, 'change', '[data-f]', (e, el) => {
    const f = el.dataset.f;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    const id = store.cardId;
    if (f === 'name' && !String(v).trim()) {
      app.toast('Task name cannot be empty.', 'error');
      return render();
    }
    let pin;
    if (f === 'start' || f === 'finish' || f === 'duration') {
      const prev = pinned.get(id);
      pin = prev && prev !== f ? prev : undefined;
      pinned.set(id, f);
    }
    commitTask(`Edit ${f}`, (t) => setTaskField(t, f, v, pin) || undefined);
    return undefined;
  });

  on(root, 'change', '.pr-ref, .pr-type, .pr-lag', (e, el) => {
    const tr = el.closest('tr');
    const oldId = Number(tr.dataset.pred);
    const ref = tr.querySelector('.pr-ref').value;
    const type = tr.querySelector('.pr-type').value;
    const lag = parseInt(tr.querySelector('.pr-lag').value, 10) || 0;
    const newId = resolveRef(store.d.tree, ref);
    if (newId == null) {
      app.toast(`No task "${ref}".`, 'error');
      return render();
    }
    commitTask('Edit link', (t, plan) => {
      const idx = t.preds.findIndex((p) => p.id === oldId);
      if (newId !== oldId) removeLink(plan.rows, oldId, t.id);
      const err = addLink(plan.rows, newId, t.id, type, lag);
      if (err) return err;
      if (newId !== oldId && idx >= 0) {
        const cur = plan.rows.find((r) => r.id === t.id);
        const link = cur.preds.pop();
        cur.preds.splice(idx, 0, link);
      }
      return undefined;
    });
    return undefined;
  });

  on(root, 'change', '.cf-k, .cf-v', (e, el) => {
    const i = Number(el.closest('.cf').dataset.i);
    const key = el.classList.contains('cf-k') ? 'key' : 'value';
    commitTask('Edit custom field', (t) => {
      t.custom[i][key] = el.value.slice(0, key === 'key' ? 200 : 2000);
    });
  });

  const addPreds = () => {
    const input = root.querySelector('.pr-add');
    const text = input.value.trim();
    if (!text) return;
    commitTask('Add predecessor', (t, plan) => {
      const cur = predsText(t, store.d.tree);
      const errs = setPredsFromText(plan.rows, t.id, cur ? `${cur}, ${text}` : text);
      if (errs.length) setTimeout(() => app.toast(errs.join(' '), 'error', 7000));
    });
    pendingFocus = 'pr-add';
  };
  on(root, 'keydown', '.pr-add', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addPreds();
    }
  });

  on(root, 'click', '[data-act], [data-open]', (e, el) => {
    if (el.dataset.open) return app.openCard(Number(el.dataset.open));
    const act = el.dataset.act;
    const id = store.cardId;
    switch (act) {
      case 'close':
        return app.closeCard();
      case 'prev':
      case 'next': {
        const tasks = store.d.visible.filter((r) => r.kind !== 'section');
        const i = tasks.findIndex((r) => r.id === id);
        const n = tasks[i + (act === 'next' ? 1 : -1)];
        if (n) app.openCard(n.id, { focus: false });
        return undefined;
      }
      case 'desc-toggle':
        descEdit = !descEdit;
        pendingFocus = descEdit ? 'desc' : null;
        return render();
      case 'pr-del': {
        const pid = Number(el.closest('tr').dataset.pred);
        return commitTask('Remove link', (t, plan) => removeLink(plan.rows, pid, t.id));
      }
      case 'pr-add':
        return addPreds();
      case 'cf-add':
        pendingFocus = `cf-k-${store.d.tree.byId.get(id).custom.length}`;
        return commitTask('Add custom field', (t) => {
          t.custom.push({ key: '', value: '' });
        });
      case 'cf-del': {
        const i = Number(el.closest('.cf').dataset.i);
        return commitTask('Remove custom field', (t) => {
          t.custom.splice(i, 1);
        });
      }
      case 'delete':
        return app.deleteRows([id]);
      default:
        return undefined;
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      app.closeCard();
    }
  });

  return {
    render,
    focusName() {
      const n = root.querySelector('.card-name');
      if (n) n.focus();
    },
  };
}
