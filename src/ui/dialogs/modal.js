// Modal dialogs on the native <dialog> element.
import { escapeHtml as esc } from '../../util/escape.js';

let seq = 0;

/**
 * modal({ title, body (HTML), actions: [{ label, value, primary, danger }], wide, onMount(dlg), onAction(value, dlg) })
 * Resolves { value, data } where data is what onAction returned. onAction returning false keeps the dialog open.
 */
export function modal({ title, body = '', actions = [{ label: 'OK', value: 'ok', primary: true }], wide = false, onMount, onAction }) {
  return new Promise((resolve) => {
    const id = `mdl-${++seq}`;
    const dlg = document.createElement('dialog');
    dlg.className = `modal${wide ? ' wide' : ''}`;
    dlg.setAttribute('aria-labelledby', id);
    dlg.innerHTML = `<div class="m-head"><h2 id="${id}">${esc(title)}</h2><button type="button" class="btn ic m-x" data-v="cancel" aria-label="Close dialog">×</button></div>
<div class="m-body">${body}</div>
<div class="m-foot">${actions.map((a) => `<button type="button" class="btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}" data-v="${esc(a.value)}">${esc(a.label)}</button>`).join('')}</div>`;
    document.body.appendChild(dlg);
    let result = { value: 'cancel' };
    const prevFocus = document.activeElement;
    dlg.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-v]');
      if (!b || !dlg.contains(b)) return;
      const v = b.dataset.v;
      if (v !== 'cancel' && onAction) {
        const r = await onAction(v, dlg);
        if (r === false) return;
        result = { value: v, data: r };
      } else result = { value: v };
      dlg.close();
    });
    dlg.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !['checkbox', 'radio', 'file'].includes(e.target.type)) {
        const p = dlg.querySelector('.m-foot .primary');
        if (p) {
          e.preventDefault();
          p.click();
        }
      }
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
      resolve(result);
    });
    dlg.showModal();
    if (onMount) onMount(dlg);
    const f = dlg.querySelector('.m-body input, .m-body textarea, .m-body select') || dlg.querySelector('.m-foot .primary') || dlg.querySelector('.m-foot .btn');
    if (f) f.focus();
  });
}

export async function confirmBox(message, { ok = 'OK', danger = false, title = 'Please confirm' } = {}) {
  const r = await modal({
    title,
    body: `<p>${esc(message)}</p>`,
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: ok, value: 'ok', primary: !danger, danger }],
  });
  return r.value === 'ok';
}

export async function promptBox(title, label, value = '') {
  const r = await modal({
    title,
    body: `<label class="fld">${esc(label)}<input class="m-input" value="${esc(value)}" maxlength="200"></label>`,
    actions: [{ label: 'Cancel', value: 'cancel' }, { label: 'OK', value: 'ok', primary: true }],
    onMount: (dlg) => setTimeout(() => dlg.querySelector('.m-input').select()),
    onAction: (v, dlg) => {
      const s = dlg.querySelector('.m-input').value.trim();
      return s ? s : false;
    },
  });
  return r.value === 'ok' ? r.data : null;
}
