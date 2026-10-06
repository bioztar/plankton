// Popup menus (toolbar menus, section actions, colour palette).
import { escapeHtml as esc } from '../../util/escape.js';

let current = null;

function outside(e) {
  if (!current) return;
  if (current.menu.contains(e.target)) return;
  if (current.anchor.contains(e.target)) current.anchor.dataset.justClosed = '1';
  closeMenu(false);
}

export function closeMenu(refocus = true) {
  if (!current) return;
  const { menu, anchor } = current;
  current = null;
  menu.remove();
  document.removeEventListener('pointerdown', outside, true);
  anchor.setAttribute('aria-expanded', 'false');
  if (refocus && anchor.focus && document.contains(anchor)) anchor.focus({ preventScroll: true });
}

export const isMenuOpen = () => !!current;

/** items: [{ label | html, action, checked, radio, disabled, danger, hint, keepOpen } | { sep: true } | { heading }] */
export function openMenu(anchor, items, { label = 'Menu' } = {}) {
  if (anchor.dataset.justClosed) {
    delete anchor.dataset.justClosed;
    return;
  }
  closeMenu(false);
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  menu.innerHTML = items
    .map((it, i) => {
      if (it.sep) return '<div class="m-sep" role="separator"></div>';
      if (it.heading) return `<div class="m-hd" role="presentation">${esc(it.heading)}</div>`;
      const role = it.checked != null ? (it.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem';
      return `<button type="button" role="${role}" class="m-it${it.danger ? ' danger' : ''}" data-i="${i}"${it.checked != null ? ` aria-checked="${!!it.checked}"` : ''}${it.disabled ? ' disabled' : ''}><span class="m-ck" aria-hidden="true">${it.checked ? '✓' : ''}</span><span class="m-l">${it.html || esc(it.label)}</span>${it.hint ? `<span class="m-k">${esc(it.hint)}</span>` : ''}</button>`;
    })
    .join('');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const left = Math.min(r.left, window.innerWidth - w - 8);
  let top = r.bottom + 4;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  current = { menu, anchor };
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', outside, true);
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b || b.disabled) return;
    const it = items[Number(b.dataset.i)];
    if (it.keepOpen) {
      it.checked = !it.checked;
      b.setAttribute('aria-checked', String(it.checked));
      b.querySelector('.m-ck').textContent = it.checked ? '✓' : '';
      if (it.action) it.action(it.checked);
      return;
    }
    closeMenu(true);
    if (it.action) it.action();
  });
  menu.addEventListener('keydown', (e) => {
    const btns = [...menu.querySelectorAll('.m-it:not([disabled])')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length];
      if (n) n.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      btns[e.key === 'Home' ? 0 : btns.length - 1].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  });
  const first = menu.querySelector('.m-it[aria-checked="true"]:not([disabled])') || menu.querySelector('.m-it:not([disabled])');
  if (first) first.focus();
}

export function openPalette(anchor, currentColor, palette) {
  return new Promise((resolve) => {
    openMenu(
      anchor,
      palette.map((p) => ({
        html: `<span class="sw" style="background:${p.color}"></span>${esc(p.name)}`,
        checked: p.color.toLowerCase() === String(currentColor).toLowerCase(),
        radio: true,
        action: () => resolve(p.color),
      })),
      { label: 'Section colour' }
    );
  });
}
