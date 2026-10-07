// File › Version history: the versions embedded in the saved file, newest
// first, with Preview (read-only overlay), Restore and Export JSON.
import { modal } from './modal.js';
import { escapeHtml as esc } from '../../util/escape.js';
import { computeTree, isTask } from '../../model/tree.js';
import { isComplete } from '../../model/options.js';
import { fmtStamp } from '../format.js';

/**
 * o: { versions (oldest first), author, fileName, onAuthor(), onPreview(v), onRestore(v), onExport(v), readOnly }
 */
export function openHistoryPanel(o) {
  const list = [...o.versions].reverse();
  const item = (v) => `<li class="vh-item">
<div class="vh-h"><b>Version ${v.n}</b><span>${esc(fmtStamp(v.savedAt))}</span>${v.author ? `<span>· ${esc(v.author)}</span>` : ''}</div>
<ul class="vh-ch">${(v.changes || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
<div class="vh-act"><button type="button" class="btn sm" data-a="preview" data-n="${v.n}">Preview</button><button type="button" class="btn sm" data-a="restore" data-n="${v.n}"${o.readOnly ? ' disabled' : ''}>Restore</button><button type="button" class="btn sm" data-a="export" data-n="${v.n}">Export JSON</button></div></li>`;
  return modal({
    title: 'Version history',
    wide: true,
    body: `<p class="hint">Every Save adds a version to ${o.fileName ? `“${esc(o.fileName)}”` : 'the file'} (the last 50, at most 5 MB). Restoring is a normal edit: Undo brings the current plan back, Save keeps it.</p>
<p class="vh-me">Your name on new versions: <b class="vh-name">${esc(o.author || '(not set)')}</b> <button type="button" class="btn sm" data-a="author">Change…</button></p>
${list.length ? `<ol class="vh-list">${list.map(item).join('')}</ol>` : '<p class="muted">No versions yet. Each Save adds one.</p>'}`,
    actions: [{ label: 'Close', value: 'cancel', primary: true }],
    onMount: (dlg) => {
      dlg.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        if (b.dataset.a === 'author') {
          const name = await o.onAuthor();
          if (name != null) dlg.querySelector('.vh-name').textContent = name || '(not set)';
          return;
        }
        const v = o.versions.find((x) => x.n === Number(b.dataset.n));
        if (!v) return;
        if (b.dataset.a === 'preview') o.onPreview(v);
        else if (b.dataset.a === 'export') o.onExport(v);
        else if (b.dataset.a === 'restore' && (await o.onRestore(v))) dlg.close();
      });
    },
  });
}

const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`) || 0;

/** Read-only overlay of a version: outline table with mini timeline bars. Resolves 'restore' or 'cancel'. */
export async function previewVersion(plan, v, { readOnly = false } = {}) {
  const tree = computeTree(plan.rows);
  const tasks = plan.rows.filter(isTask);
  const min = Math.min(...tasks.map((t) => dayMs(t.start)));
  const max = Math.max(...tasks.map((t) => dayMs(t.finish) + 864e5));
  const span = Math.max(864e5, max - min);
  const rows = plan.rows.map((r) => {
    if (!isTask(r)) return `<tr class="vp-sec" style="--sec:${esc(r.color || '#888')}"><td></td><td colspan="8">${esc(r.name)}</td></tr>`;
    const done = isComplete(plan, r.status);
    const left = tasks.length ? ((dayMs(r.start) - min) / span) * 100 : 0;
    const width = r.milestone ? 0 : Math.max(0.6, ((dayMs(r.finish) + 864e5 - dayMs(r.start)) / span) * 100);
    const bar = r.milestone
      ? `<span class="vp-ms${done ? ' done' : ''}" style="left:${left.toFixed(2)}%"></span>`
      : `<span class="vp-bar${done ? ' done' : ''}${tree.isSummary(r.id) ? ' sum' : ''}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></span>`;
    return `<tr class="${done ? 'done' : ''}${tree.isSummary(r.id) ? ' sum' : ''}"><td class="muted">${esc(tree.outline.get(r.id) || '')}</td><td style="padding-left:${6 + r.level * 14}px">${done ? '<span class="done-ck">✓</span>' : ''}${esc(r.name)}</td><td>${esc(r.start)}</td><td>${esc(r.milestone ? '' : r.finish)}</td><td class="r">${r.milestone ? '0' : r.duration}d</td><td class="r">${r.progress}%</td><td>${esc(r.status)}</td><td>${esc(r.owner)}</td><td class="vp-tl">${bar}</td></tr>`;
  });
  const r = await modal({
    title: `Preview: version ${v.n} · ${fmtStamp(v.savedAt)} (read-only)`,
    wide: true,
    body: `<p class="hint"><b>${esc(plan.name)}</b> · ${tasks.length} task${tasks.length === 1 ? '' : 's'}${v.author ? ` · saved by ${esc(v.author)}` : ''}</p>
<div class="vp-wrap"><table class="vp"><thead><tr><th>#</th><th>Task</th><th>Start</th><th>Finish</th><th>Dur.</th><th>%</th><th>Status</th><th>Owner</th><th>Timeline</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`,
    actions: [{ label: 'Close', value: 'cancel' }, ...(readOnly ? [] : [{ label: 'Restore this version', value: 'restore', primary: true }])],
  });
  return r.value;
}
