// Paste-import dialog: paste TSV/CSV, map columns, choose date order, preview, import.
import { escapeHtml as esc } from '../../util/escape.js';
import { parseDelimited, detectColumns, detectDateOrder, importTable, IMPORT_FIELDS } from '../../io/paste.js';
import { computeTree } from '../../model/tree.js';
import { createPlan } from '../../model/plan.js';
import { sanitizeLinks } from '../../schedule/engine.js';
import { formatLink } from '../../schedule/links.js';
import { modal } from './modal.js';

const ORDER_TEXT = {
  mdy: 'Detected M/D/YYYY.',
  dmy: 'Detected D/M/YYYY.',
  iso: 'Detected ISO dates (YYYY-MM-DD).',
  ambiguous: 'Ambiguous dates (e.g. 03/04): please choose.',
  none: '',
};

const droppedNote = (n) => (n ? ` ${n} circular or invalid link${n === 1 ? ' was' : 's were'} removed.` : '');

export async function openPasteImport(app, initialText = '') {
  const store = app.store;
  const st = { table: [], headers: [], mapping: {}, sig: '', userOrder: false, result: null };
  const body = `<p class="hint">Copy rows <b>including the header row</b> from Excel, Planner, Smartsheet or MS Project and paste them here (tab- or comma-separated). Nesting comes from an Outline level / WBS column (1, 1.2, 1.2.1) or from leading spaces in the name.</p>
<textarea class="pi-text" rows="8" spellcheck="false" placeholder="Name&#9;Start&#9;Finish&#9;Owner&#9;Predecessors&#10;Kick-off&#9;2026-03-02&#9;2026-03-03&#9;PM&#9;&#10;  Requirements&#9;3/4/2026&#9;3/10/2026&#9;BA&#9;1" aria-label="Pasted table"></textarea>
<div class="pi-opts">
<label class="chk"><input type="checkbox" class="pi-header" checked> First row is a header</label>
<fieldset class="pi-dates"><legend>Dates like 03/04/2026 mean</legend>
<label><input type="radio" name="pi-order" value="mdy" checked> M/D/YYYY (March 4)</label>
<label><input type="radio" name="pi-order" value="dmy"> D/M/YYYY (3 April)</label>
<span class="pi-detected" aria-live="polite"></span></fieldset>
<fieldset><legend>Import into</legend>
<label><input type="radio" name="pi-target" value="append" checked> This plan (append at end)</label>
<label><input type="radio" name="pi-target" value="new"> A new plan</label></fieldset>
</div>
<div class="pi-map" aria-label="Column mapping"></div>
<div class="pi-warn" aria-live="polite"></div>
<div class="pi-preview"><p class="muted" style="padding:8px">Preview appears here.</p></div>`;

  let dlgRef = null;
  const opts = () => ({
    mapping: st.mapping,
    hasHeader: dlgRef.querySelector('.pi-header').checked,
    dateOrder: dlgRef.querySelector('input[name="pi-order"]:checked').value,
  });

  function renderMapping(dlg) {
    const targets = [...IMPORT_FIELDS, ...(store.plan.fields || []).map((f) => ({ key: `cf_${f.id}`, label: `${f.name} (custom column)` }))];
    const fieldOpts = (i) =>
      `<option value="">— ignore —</option>${targets.map((f) => `<option value="${f.key}"${st.mapping[f.key] === i ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}`;
    dlg.querySelector('.pi-map').innerHTML = st.headers
      .map((h, i) => `<label class="pi-col"><span class="pi-src" title="${esc(h)}">${esc(h || `Column ${i + 1}`)}</span><select data-col="${i}" aria-label="Map column ${esc(h || i + 1)}">${fieldOpts(i)}</select></label>`)
      .join('');
  }

  function update(dlg) {
    const text = dlg.querySelector('.pi-text').value;
    const hasHeader = dlg.querySelector('.pi-header').checked;
    if (!text.trim()) {
      st.table = [];
      st.result = null;
      dlg.querySelector('.pi-map').innerHTML = '';
      dlg.querySelector('.pi-preview').innerHTML = '<p class="muted" style="padding:8px">Preview appears here.</p>';
      dlg.querySelector('.pi-warn').textContent = '';
      return;
    }
    st.table = parseDelimited(text);
    const width = st.table.reduce((m, r) => Math.max(m, r.length), 0);
    st.headers = hasHeader ? Array.from({ length: width }, (_, i) => st.table[0][i] || '') : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    const sig = `${hasHeader}|${st.headers.join('\u0001')}`;
    if (sig !== st.sig) {
      st.sig = sig;
      st.mapping = hasHeader ? detectColumns(st.headers, store.plan.fields || []) : { name: 0 };
      renderMapping(dlg);
    }
    const rows = hasHeader ? st.table.slice(1) : st.table;
    const vals = [];
    for (const k of ['start', 'finish']) if (st.mapping[k] != null) for (const r of rows) vals.push(r[st.mapping[k]]);
    const det = detectDateOrder(vals);
    const fs = dlg.querySelector('.pi-dates');
    if (!st.userOrder && (det === 'mdy' || det === 'dmy')) dlg.querySelector(`input[name="pi-order"][value="${det}"]`).checked = true;
    fs.classList.toggle('attn', det === 'ambiguous' && !st.userOrder);
    dlg.querySelector('.pi-detected').textContent = ORDER_TEXT[det] || '';
    preview(dlg);
  }

  function preview(dlg) {
    if (st.mapping.name == null) {
      st.result = null;
      dlg.querySelector('.pi-preview').innerHTML = '<p class="warn" style="padding:8px">Map one column to “Name”.</p>';
      return;
    }
    const scratch = { ...store.plan, rows: [], nextId: store.plan.nextId };
    st.result = importTable(scratch, st.table, opts());
    const { rows, warnings } = st.result;
    const tree = computeTree(rows);
    const tasks = rows.filter((r) => r.kind !== 'section').length;
    const body = rows
      .slice(0, 300)
      .map((r) => {
        if (r.kind === 'section') return `<tr class="pv-sec"><td colspan="7"><span class="sw" style="background:${r.color}"></span>${esc(r.name)}</td></tr>`;
        const preds = r.preds.map((p) => formatLink(tree.outline.get(p.id), p.type, p.lag)).join(', ');
        return `<tr><td>${esc(tree.outline.get(r.id))}</td><td style="padding-left:${8 + r.level * 16}px">${r.milestone ? '◆ ' : ''}${esc(r.name)}</td><td>${r.start}</td><td>${r.finish}</td><td>${r.milestone ? 0 : r.duration}d</td><td>${esc(r.owner)}</td><td>${esc(preds)}</td></tr>`;
      })
      .join('');
    dlg.querySelector('.pi-preview').innerHTML = `<table><thead><tr><th>#</th><th>Name (${tasks} tasks)</th><th>Start</th><th>Finish</th><th>Dur.</th><th>Owner</th><th>Predecessors</th></tr></thead><tbody>${body}</tbody></table>`;
    dlg.querySelector('.pi-warn').innerHTML = warnings.length ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}: ${warnings.slice(0, 12).map(esc).join(' · ')}${warnings.length > 12 ? ' …' : ''}` : '';
  }

  const r = await modal({
    title: 'Paste import',
    wide: true,
    body,
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'Import', value: 'import', primary: true }],
    onMount: (dlg) => {
      dlgRef = dlg;
      const ta = dlg.querySelector('.pi-text');
      ta.value = initialText;
      ta.addEventListener('input', () => update(dlg));
      dlg.querySelector('.pi-header').addEventListener('change', () => update(dlg));
      dlg.querySelectorAll('input[name="pi-order"]').forEach((n) =>
        n.addEventListener('change', () => {
          st.userOrder = true;
          update(dlg);
        })
      );
      dlg.querySelector('.pi-map').addEventListener('change', (e) => {
        const sel = e.target.closest('select[data-col]');
        if (!sel) return;
        const col = Number(sel.dataset.col);
        for (const k of Object.keys(st.mapping)) if (st.mapping[k] === col) delete st.mapping[k];
        if (sel.value) st.mapping[sel.value] = col;
        renderMapping(dlg);
        update(dlg);
      });
      if (initialText) update(dlg);
    },
    onAction: (v, dlg) => {
      update(dlg);
      if (!st.result || !st.result.rows.some((x) => x.kind !== 'section')) {
        app.toast('Nothing to import yet: paste a table and map a Name column.', 'error');
        return false;
      }
      return { ...opts(), table: st.table, target: dlg.querySelector('input[name="pi-target"]:checked').value };
    },
  });
  if (r.value !== 'import') return;
  const { table, target, ...o } = r.data;
  if (target === 'new') {
    const plan = createPlan({ name: 'Imported plan' });
    const res = importTable(plan, table, o);
    plan.rows = res.rows;
    const dropped = sanitizeLinks(plan.rows).length;
    const starts = plan.rows.filter((x) => x.kind !== 'section').map((x) => x.start).sort();
    if (starts.length) plan.start = starts[0];
    app.addPlan(plan);
    app.toast(`Imported ${starts.length} tasks into a new plan.${droppedNote(dropped)}`, dropped ? 'warn' : 'info');
  } else {
    let n = 0;
    let dropped = 0;
    store.commit('Paste import', (plan) => {
      const res = importTable(plan, table, o);
      plan.rows.push(...res.rows);
      n = res.rows.filter((x) => x.kind !== 'section').length;
      dropped = sanitizeLinks(plan.rows).length;
    });
    app.toast(`Imported ${n} tasks.${droppedNote(dropped)}`, dropped ? 'warn' : 'info');
  }
}
