// Edit / delete a dependency link (opened by clicking an arrow in the Gantt).
import { escapeHtml as esc } from '../../util/escape.js';
import { LINK_TYPES, LINK_LABELS } from '../../schedule/links.js';
import { addLink, removeLink } from '../../model/edit.js';
import { modal } from './modal.js';

export async function openLinkEditor(app, predId, succId) {
  const store = app.store;
  const tree = store.d.tree;
  const pred = tree.byId.get(predId);
  const succ = tree.byId.get(succId);
  const link = succ && succ.preds.find((p) => p.id === predId);
  if (!pred || !link) return;
  const ro = store.readOnly;
  const conflict = store.d.conflicts.find((c) => c.predId === predId && c.succId === succId);
  const body = `<p class="lk-desc"><b>${esc(tree.outline.get(predId))} ${esc(pred.name)}</b> → <b>${esc(tree.outline.get(succId))} ${esc(succ.name)}</b></p>
${conflict ? `<p class="warn">This link is violated: the successor is scheduled ${conflict.days} working day${conflict.days === 1 ? '' : 's'} too early.</p>` : ''}
<label class="fld">Type<select class="lk-type"${ro ? ' disabled' : ''}>${LINK_TYPES.map((t) => `<option value="${t}"${t === link.type ? ' selected' : ''}>${t} — ${LINK_LABELS[t]}</option>`).join('')}</select></label>
<label class="fld">Lag in working days (negative = lead)<input type="number" step="1" class="lk-lag" value="${link.lag}"${ro ? ' disabled' : ''}></label>`;
  const r = await modal({
    title: 'Dependency',
    body,
    actions: ro
      ? [{ label: 'Close', value: 'cancel', primary: true }]
      : [{ label: 'Delete link', value: 'del', danger: true }, { label: 'Cancel', value: 'cancel' }, { label: 'Save', value: 'save', primary: true }],
    onAction: (v, dlg) => ({ type: dlg.querySelector('.lk-type').value, lag: parseInt(dlg.querySelector('.lk-lag').value, 10) || 0 }),
  });
  if (r.value === 'save') store.commit('Edit link', (plan) => addLink(plan.rows, predId, succId, r.data.type, r.data.lag) || undefined);
  else if (r.value === 'del') store.commit('Delete link', (plan) => removeLink(plan.rows, predId, succId));
}
