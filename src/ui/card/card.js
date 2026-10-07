// Task details panel: large editable name, a compact fields strip (incl. custom
// columns), the rich-text description, then links, notes, per-task custom
// fields and timestamps. Resizable (left edge) and maximizable.
import { escapeHtml as esc } from '../../util/escape.js';
import { sanitizeHtml } from '../../util/sanitize.js';
import { safeUrl } from '../../util/markdown.js';
import { STATUSES, PRIORITIES } from '../../model/plan.js';
import { setTaskField, resolveRef, addLink, removeLink, setPredsFromText, predsText } from '../../model/edit.js';
import { setFieldValue, findField, formatValue } from '../../model/fields.js';
import { LINK_TYPES, LINK_LABELS } from '../../schedule/links.js';
import { fmtStamp } from '../format.js';
import { preserveFocus, on, deferWhileFocused } from '../dom.js';
import { toolbarHTML, createRichText } from './richtext.js';

const MIN_W = 360;

export function createCard(app, root) {
  const render = deferWhileFocused(root, renderNow);
  const store = app.store;
  const pinned = new Map();
  let pendingFocus = null;
  let maximized = !!app.storage.prefs().cardMax;
  root.setAttribute('role', 'complementary');
  root.setAttribute('aria-label', 'Task details');
  root.innerHTML = `<div class="card-rs" role="separator" aria-orientation="vertical" aria-label="Resize task details (←/→)" tabindex="0" title="Drag to resize"></div>
<div class="card-head"></div>
<div class="card-body">
<div class="cd-top"></div>
<section class="card-sec cd-desc" aria-label="Description"><h3>Description</h3>
<div class="rt rt-edit">${toolbarHTML()}<div class="rt-ed rt-doc" contenteditable="true" data-key="desc" role="textbox" aria-multiline="true" aria-label="Description" spellcheck="true" data-placeholder="Add a description… Paste from Word, Outlook, OneNote or a web page: headings, lists, tables and links are kept."></div></div>
<div class="rt-view rt-doc" hidden></div>
</section>
<div class="cd-rest"></div>
</div>`;
  const head = root.querySelector('.card-head');
  const top = root.querySelector('.cd-top');
  const rest = root.querySelector('.cd-rest');
  const rtEdit = root.querySelector('.rt-edit');
  const rtView = root.querySelector('.rt-view');
  const rich = createRichText(rtEdit, {
    onChange: (html, id) => store.commit('Edit description', (plan) => {
      const t = plan.rows.find((r) => r.id === id);
      if (!t) return false;
      return setTaskField(t, 'descHtml', html) || undefined;
    }),
  });

  const opt = (list, v) => list.map((s) => `<option${s === v ? ' selected' : ''}>${esc(s)}</option>`).join('');

  function customControl(f, t, dis) {
    const v = t.values ? t.values[f.id] : undefined;
    const a = `data-cf="${f.id}" data-key="cf-${f.id}" aria-label="${esc(f.name)}"${dis}`;
    switch (f.type) {
      case 'checkbox':
        return `<input type="checkbox" ${a}${v ? ' checked' : ''}>`;
      case 'select':
        return `<select ${a}><option value=""></option>${f.options.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      case 'date':
        return `<input type="date" ${a} value="${esc(v || '')}">`;
      case 'number':
        return `<input type="text" inputmode="decimal" class="num" ${a} value="${esc(formatValue(f, v))}">`;
      case 'url': {
        const href = v && safeUrl(v);
        return `<span class="fs-url"><input type="url" ${a} value="${esc(v || '')}" placeholder="https://">${href ? `<a class="btn ic sm" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="Open link" title="Open link">↗</a>` : ''}</span>`;
      }
      case 'person':
        return `<input ${a} value="${esc(v || '')}" list="dl-owners">`;
      default:
        return `<input ${a} value="${esc(v || '')}">`;
    }
  }

  function headHTML(t) {
    const { tree } = store.d;
    return `<span class="card-outline" title="Outline number · ID #${t.id}">${esc(tree.outline.get(t.id))}</span><span class="card-title">Task details</span>
<button type="button" class="btn ic" data-act="prev" aria-label="Previous task" title="Previous task">↑</button>
<button type="button" class="btn ic" data-act="next" aria-label="Next task" title="Next task">↓</button>
<button type="button" class="btn ic" data-act="max" aria-pressed="${maximized}" aria-label="${maximized ? 'Restore panel size' : 'Maximize'}" title="${maximized ? 'Restore' : 'Maximize (full window)'}">${maximized ? '🗗' : '⤢'}</button>
<button type="button" class="btn ic" data-act="close" aria-label="Close task details" title="Close (Esc)">×</button>`;
  }

  function topHTML(t) {
    const { tree } = store.d;
    const summary = tree.isSummary(t.id);
    const ro = store.readOnly;
    const dis = (cond) => (cond || ro ? ' disabled' : '');
    const owners = [...new Set(tree.tasks.map((x) => x.owner).filter(Boolean))].sort();
    const streams = [...new Set(tree.tasks.map((x) => x.workstream).filter(Boolean))].sort();
    const fields = store.plan.fields || [];
    const fs = (label, ctl, cls = '') => `<label class="fs${cls}"><span>${esc(label)}</span>${ctl}</label>`;
    return `<textarea class="card-name" data-f="name" data-key="name" rows="1" aria-label="Task name" placeholder="Task name"${dis()}>${esc(t.name)}</textarea>
${summary ? '<p class="hint">Summary task: dates, duration, progress and status roll up from its subtasks.</p>' : ''}
<div class="fstrip">
${fs('Start', `<input type="date" data-f="start" data-key="start" value="${t.start}"${dis(summary)}>`)}
${fs('Finish', `<input type="date" data-f="finish" data-key="finish" value="${t.finish}"${dis(summary || t.milestone)}>`)}
${fs('Duration', `<input type="number" min="0" step="1" data-f="duration" data-key="duration" value="${t.duration}" title="Working days"${dis(summary)}>`, ' w-xs')}
${fs('Progress %', `<input type="number" min="0" max="100" step="5" data-f="progress" data-key="progress" value="${t.progress}"${dis(summary)}>`, ' w-xs')}
${fs('Status', `<select data-f="status" data-key="status"${dis(summary)}>${opt(STATUSES, t.status)}</select>`)}
${fs('Priority', `<select data-f="priority" data-key="priority"${dis()}>${opt(PRIORITIES, t.priority)}</select>`)}
${fs('Owner', `<input data-f="owner" data-key="owner" value="${esc(t.owner)}" list="dl-owners"${dis()}>`)}
${fs('Workstream', `<input data-f="workstream" data-key="workstream" value="${esc(t.workstream)}" list="dl-streams"${dis()}>`)}
<label class="fs fs-chk"><span>Milestone</span><input type="checkbox" data-f="milestone" data-key="milestone"${t.milestone ? ' checked' : ''}${dis(summary)}></label>
${fs('Tags', `<input data-f="tags" data-key="tags" value="${esc(t.tags.join(', '))}" placeholder="comma-separated"${dis()}>`, ' w-l')}
${fields.map((f) => fs(f.name, customControl(f, t, dis()), ` fs-cf${f.type === 'checkbox' ? ' fs-chk' : ''}${f.type === 'url' || f.type === 'text' ? ' w-l' : ''}`)).join('')}
</div>
<datalist id="dl-owners">${owners.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
<datalist id="dl-streams">${streams.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`;
  }

  function restHTML(t) {
    const { tree } = store.d;
    const ro = store.readOnly;
    const dis = () => (ro ? ' disabled' : '');
    const succs = tree.tasks.filter((x) => x.preds.some((p) => p.id === t.id));
    const preds = t.preds
      .filter((p) => tree.byId.has(p.id))
      .map((p) => {
        const pt = tree.byId.get(p.id);
        return `<tr data-pred="${p.id}"><td><input class="pr-ref" data-key="pr-ref-${p.id}" value="${esc(tree.outline.get(p.id))}" size="5" aria-label="Predecessor (outline number or #ID)"${dis()}> <button type="button" class="pr-name chip-link" data-open="${p.id}" title="Open ${esc(pt.name)}">${esc(pt.name)}</button></td>
<td><select class="pr-type" data-key="pr-type-${p.id}" aria-label="Link type"${dis()}>${LINK_TYPES.map((x) => `<option value="${x}"${x === p.type ? ' selected' : ''} title="${LINK_LABELS[x]}">${x}</option>`).join('')}</select></td>
<td><input class="pr-lag" type="number" step="1" data-key="pr-lag-${p.id}" value="${p.lag}" aria-label="Lag in working days (negative = lead)"${dis()}></td>
<td>${ro ? '' : `<button type="button" class="btn ic" data-act="pr-del" aria-label="Remove link from ${esc(pt.name)}">×</button>`}</td></tr>`;
      })
      .join('');
    const custom = t.custom
      .map(
        (c, i) =>
          `<div class="cf" data-i="${i}"><input class="cf-k" data-key="cf-k-${i}" value="${esc(c.key)}" placeholder="Field" aria-label="Custom field name"${dis()}><input class="cf-v" data-key="cf-v-${i}" value="${esc(c.value)}" placeholder="Value" aria-label="Custom field value"${dis()}>${ro ? '' : `${c.key.trim() ? `<button type="button" class="btn sm" data-act="cf-promote" title="Make “${esc(c.key)}” a column for every task">Show as column</button>` : ''}<button type="button" class="btn ic" data-act="cf-del" aria-label="Remove field">×</button>`}</div>`
      )
      .join('');
    return `<div class="cd-cols">
<section class="card-sec"><h3>Predecessors</h3>
${preds ? `<table class="preds"><thead><tr><th>Task</th><th>Type</th><th>Lag</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${preds}</tbody></table>` : '<p class="muted">None.</p>'}
${ro ? '' : `<div class="pr-add-row"><input class="pr-add" data-key="pr-add" placeholder="Add: 3, 1.2FS+2d, #7SS-1d" aria-label="Add predecessors"><button type="button" class="btn sm" data-act="pr-add">Add</button></div>`}
<p class="hint">FS finish→start · SS start→start · FF finish→finish · SF start→finish. Lag in working days, negative = lead.</p></section>
<section class="card-sec"><h3>Successors</h3>${succs.length ? `<p class="succ">${succs.map((x) => `<button type="button" class="chip-link" data-open="${x.id}">${esc(tree.outline.get(x.id))} ${esc(x.name)}</button>`).join(' ')}</p>` : '<p class="muted">None.</p>'}</section>
</div>
<section class="card-sec"><h3>Notes</h3><textarea data-f="notes" data-key="notes" rows="3"${dis()}>${esc(t.notes)}</textarea></section>
<section class="card-sec"><h3>Custom fields <span class="muted h-note">(this task only — “Show as column” adds one to every task)</span></h3>${custom || '<p class="muted">None.</p>'}${ro ? '' : '<button type="button" class="btn sm" data-act="cf-add">+ Add field</button>'}</section>
<footer class="card-foot"><span class="stamp">ID #${t.id} · Created ${esc(fmtStamp(t.createdAt))} · Updated ${esc(fmtStamp(t.updatedAt))}</span>${ro ? '' : '<button type="button" class="btn danger sm" data-act="delete">Delete task</button>'}</footer>`;
  }

  function applySize() {
    root.classList.toggle('max', maximized);
    const w = Number(app.storage.prefs().cardWidth) || 0;
    root.style.width = !maximized && w ? `${clampW(w)}px` : '';
  }
  const clampW = (w) => Math.max(Math.min(window.innerWidth, Math.max(MIN_W, window.innerWidth * 0.5)), Math.min(window.innerWidth, w));

  function fitName() {
    const n = top.querySelector('.card-name');
    if (!n) return;
    n.style.height = 'auto';
    n.style.height = `${n.scrollHeight}px`;
  }

  function renderNow() {
    const id = store.cardId;
    const t = id != null ? store.d.tree.byId.get(id) : null;
    if (!t || t.kind === 'section') {
      if (!root.hidden) rich.flush();
      root.hidden = true;
      document.body.classList.remove('card-open');
      return;
    }
    root.hidden = false;
    document.body.classList.add('card-open');
    applySize();
    preserveFocus(root, () => {
      head.innerHTML = headHTML(t);
      top.innerHTML = topHTML(t);
      rest.innerHTML = restHTML(t);
    });
    fitName();
    const ro = store.readOnly;
    rtEdit.hidden = ro;
    rtView.hidden = !ro;
    if (ro) rtView.innerHTML = sanitizeHtml(t.descHtml) || '<p class="muted">No description.</p>';
    else rich.set(t.descHtml || '', t.id);
    if (pendingFocus) {
      const n = root.querySelector(`[data-key="${pendingFocus}"]`);
      if (n) n.focus();
      pendingFocus = null;
    }
  }

  const commitTask = (label, fn) => store.commit(label, (plan) => fn(plan.rows.find((r) => r.id === store.cardId), plan));

  on(root, 'input', '.card-name', fitName);
  on(root, 'keydown', '.card-name', (e, el) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    }
  });
  on(root, 'change', '[data-f]', (e, el) => {
    const f = el.dataset.f;
    const v = el.type === 'checkbox' ? el.checked : f === 'name' ? el.value.replace(/\s*\n\s*/g, ' ') : el.value;
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

  on(root, 'change', '[data-cf]', (e, el) => {
    const field = findField(store.plan, el.dataset.cf);
    if (!field) return;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    const ok = commitTask(`Edit ${field.name}`, (t) => setFieldValue(t, field, v) || undefined);
    if (!ok) render();
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

  function step(dir) {
    const tasks = store.d.visible.filter((r) => r.kind !== 'section');
    const i = tasks.findIndex((r) => r.id === store.cardId);
    const n = tasks[i + dir];
    if (n) app.openCard(n.id, { focus: false });
  }

  on(root, 'click', '[data-act], [data-open]', (e, el) => {
    if (el.dataset.open) return app.openCard(Number(el.dataset.open), { focus: false });
    const act = el.dataset.act;
    const id = store.cardId;
    switch (act) {
      case 'close':
        return app.closeCard();
      case 'prev':
        return step(-1);
      case 'next':
        return step(1);
      case 'max':
        maximized = !maximized;
        app.storage.setPrefs({ cardMax: maximized });
        pendingFocus = null;
        renderNow();
        root.querySelector('[data-act="max"]').focus();
        return undefined;
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
      case 'cf-promote': {
        const i = Number(el.closest('.cf').dataset.i);
        return app.promoteCustomKey(store.d.tree.byId.get(id).custom[i].key);
      }
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

  // resize by dragging / arrow keys on the left edge
  const rs = root.querySelector('.card-rs');
  const setWidth = (w) => {
    if (maximized) {
      maximized = false;
      app.storage.setPrefs({ cardMax: false });
      renderNow();
    }
    const cw = Math.round(clampW(w));
    root.style.width = `${cw}px`;
    return cw;
  };
  rs.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    rs.setPointerCapture(e.pointerId);
    let w = root.offsetWidth;
    const onMove = (ev) => {
      w = setWidth(window.innerWidth - ev.clientX);
    };
    const onUp = () => {
      rs.removeEventListener('pointermove', onMove);
      rs.removeEventListener('pointerup', onUp);
      app.storage.setPrefs({ cardWidth: w });
    };
    rs.addEventListener('pointermove', onMove);
    rs.addEventListener('pointerup', onUp);
  });
  rs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    app.storage.setPrefs({ cardWidth: setWidth(root.offsetWidth + (e.key === 'ArrowLeft' ? 40 : -40)) });
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      app.closeCard();
    }
  });

  return {
    render,
    flush: () => rich.flush(),
    focusName() {
      const n = root.querySelector('.card-name');
      if (n) n.focus();
    },
    focusDesc: () => rich.focus(),
  };
}
