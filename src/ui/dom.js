// Small DOM helpers.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Delegated event listener. */
export function on(root, type, selector, handler, opts) {
  root.addEventListener(
    type,
    (e) => {
      const target = selector ? e.target.closest && e.target.closest(selector) : root;
      if (target && root.contains(target)) handler(e, target);
    },
    opts
  );
}

export function el(tag, attrs = {}, html) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  if (html != null) e.innerHTML = html;
  return e;
}

export function download(filename, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFilename(name, ext) {
  const base = String(name || 'plan').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'plan';
  return `${base}.${ext}`;
}

let toastBox;
export function toast(msg, kind = 'info', ms = 3500) {
  if (!toastBox) {
    toastBox = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastBox);
  }
  while (toastBox.children.length >= 3) toastBox.firstChild.remove();
  const t = el('div', { class: `toast toast-${kind}` });
  t.textContent = msg;
  toastBox.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/** Re-render a container while keeping focus / caret on the element with the same data-key. */
export function preserveFocus(root, render) {
  const a = document.activeElement;
  const key = a && root.contains(a) ? a.getAttribute('data-key') : null;
  let sel = null;
  if (key && 'selectionStart' in a) {
    try {
      sel = [a.selectionStart, a.selectionEnd];
    } catch (e) {
      sel = null;
    }
  }
  render();
  if (key) {
    const n = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (n) {
      n.focus({ preventScroll: true });
      if (sel && n.setSelectionRange) {
        try {
          n.setSelectionRange(sel[0], sel[1]);
        } catch (e) {
          /* not a text input */
        }
      }
    }
  }
}

export function isTyping(e) {
  const t = e.target;
  if (!t || !t.closest) return false;
  return !!t.closest('input, textarea, select, [contenteditable="true"]');
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
export const mod = (e) => (isMac ? e.metaKey : e.ctrlKey);

// Re-rendering a panel while one of its controls has focus (e.g. inside a
// `change` fired by Tab) would destroy the element focus is about to move to.
// Defer such renders by a tick so preserveFocus sees the new focus target.
export function deferWhileFocused(root, fn) {
  let timer = 0;
  return function run() {
    if (root.contains(document.activeElement)) {
      if (!timer) timer = setTimeout(() => {
        timer = 0;
        fn();
      });
      return;
    }
    clearTimeout(timer);
    timer = 0;
    fn();
  };
}
