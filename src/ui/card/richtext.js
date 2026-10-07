// WYSIWYG description editor: contenteditable + a small toolbar, no libraries.
// Pasted HTML (Word / Outlook / OneNote / web) and the editor's own HTML always
// go through sanitizeHtml before they are stored; Markdown-looking plain text is
// converted on paste.
import { escapeHtml as esc } from '../../util/escape.js';
import { sanitizeHtml } from '../../util/sanitize.js';
import { markdownToHtml, looksLikeMarkdown, textToHtml, safeUrl } from '../../util/markdown.js';
import { promptBox } from '../dialogs/modal.js';
import { mod } from '../dom.js';

const TOOLS = [
  ['h1', 'H1', 'Heading 1'],
  ['h2', 'H2', 'Heading 2'],
  ['h3', 'H3', 'Heading 3'],
  ['p', '¶', 'Normal text'],
  null,
  ['bold', '<b>B</b>', 'Bold (Ctrl+B)', true],
  ['italic', '<i>I</i>', 'Italic (Ctrl+I)', true],
  ['underline', '<u>U</u>', 'Underline (Ctrl+U)', true],
  ['strikeThrough', '<s>S</s>', 'Strikethrough', true],
  null,
  ['ul', '•≡', 'Bulleted list'],
  ['ol', '1≡', 'Numbered list'],
  ['check', '☑', 'Checklist'],
  ['quote', '❝', 'Quote'],
  ['code', '&lt;/&gt;', 'Code block'],
  null,
  ['link', '🔗', 'Link (Ctrl+K)'],
  ['table', '▦', 'Insert table'],
  ['hr', '―', 'Horizontal rule'],
  ['clear', 'T<sub>x</sub>', 'Clear formatting'],
];

export function toolbarHTML() {
  return `<div class="rt-bar" role="toolbar" aria-label="Description formatting">${TOOLS.map((t) =>
    t ? `<button type="button" class="rt-b" data-rt="${t[0]}" title="${esc(t[2])}" aria-label="${esc(t[2])}"${t[3] ? ' aria-pressed="false"' : ''}>${t[1]}</button>` : '<span class="rt-sep" aria-hidden="true"></span>'
  ).join('')}</div>`;
}

/** Clipboard → sanitized description HTML. */
export function pasteToHtml(cd) {
  const html = cd.getData('text/html');
  if (html && html.trim()) {
    const s = sanitizeHtml(html);
    if (s.replace(/<[^>]+>/g, '').trim() || /<(hr|table|input)/.test(s)) return s;
  }
  const text = cd.getData('text/plain');
  if (!text) return '';
  return looksLikeMarkdown(text) ? markdownToHtml(text) : textToHtml(text);
}

const TABLE = '<table><thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr></thead><tbody><tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table><p><br></p>';

/**
 * Wire an editor. `onChange(html, ownerId)` receives sanitized HTML (debounced and on blur).
 * Returns { set(html, ownerId), flush() }.
 */
export function createRichText(wrap, { onChange }) {
  const ed = wrap.querySelector('.rt-ed');
  const bar = wrap.querySelector('.rt-bar');
  let owner = null;
  let saved = '';
  let timer = 0;
  let range = null;

  const exec = (cmd, arg = null) => document.execCommand(cmd, false, arg);

  function flush() {
    clearTimeout(timer);
    timer = 0;
    if (owner == null) return;
    const h = sanitizeHtml(ed.innerHTML);
    if (h === saved) return;
    saved = h;
    onChange(h, owner);
  }
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  };

  function saveRange() {
    const s = window.getSelection();
    if (s.rangeCount && ed.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange();
  }
  function restore() {
    if (document.activeElement !== ed) ed.focus({ preventScroll: true });
    if (range) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
    }
  }
  function closestIn(sel) {
    const s = window.getSelection();
    let n = s.anchorNode;
    if (n && n.nodeType === 3) n = n.parentNode;
    const hit = n && n.closest ? n.closest(sel) : null;
    return hit && ed.contains(hit) ? hit : null;
  }

  function updateState() {
    for (const b of bar.querySelectorAll('[aria-pressed]')) {
      let on = false;
      try {
        on = document.queryCommandState(b.dataset.rt);
      } catch (e) {
        on = false;
      }
      b.setAttribute('aria-pressed', String(!!on));
    }
  }

  async function link() {
    saveRange();
    const cur = closestIn('a');
    const url = await promptBox('Link', 'Web address (https://…) or mailto:', cur ? cur.getAttribute('href') : 'https://');
    restore();
    if (url == null) return;
    if (!url.trim()) {
      exec('unlink');
      return;
    }
    const href = safeUrl(/^[\w-]+(\.[\w-]+)+/.test(url.trim()) ? `https://${url.trim()}` : url.trim());
    if (!href) return;
    const s = window.getSelection();
    if (s.isCollapsed) exec('insertHTML', `<a href="${esc(href)}">${esc(href)}</a>`);
    else exec('createLink', href);
  }

  function checklist() {
    if (!closestIn('li')) exec('insertUnorderedList');
    const li = closestIn('li');
    if (!li) return;
    const first = li.firstChild;
    if (first && first.nodeType === 1 && first.matches('input[type=checkbox]')) return;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    li.insertBefore(document.createTextNode(' '), li.firstChild);
    li.insertBefore(cb, li.firstChild);
  }

  function run(cmd) {
    restore();
    exec('styleWithCSS', false);
    switch (cmd) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'p':
        exec('formatBlock', `<${cmd}>`);
        break;
      case 'quote':
        exec('formatBlock', '<blockquote>');
        break;
      case 'code':
        exec('formatBlock', '<pre>');
        break;
      case 'ul':
        exec('insertUnorderedList');
        break;
      case 'ol':
        exec('insertOrderedList');
        break;
      case 'check':
        checklist();
        break;
      case 'link':
        link();
        return;
      case 'table':
        exec('insertHTML', TABLE);
        break;
      case 'hr':
        exec('insertHorizontalRule');
        break;
      case 'clear':
        exec('removeFormat');
        exec('unlink');
        exec('formatBlock', '<p>');
        break;
      default:
        exec(cmd);
    }
    updateState();
    later();
  }

  bar.addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-rt]')) e.preventDefault();
  });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rt]');
    if (b) run(b.dataset.rt);
  });
  ed.addEventListener('focus', () => {
    try {
      exec('defaultParagraphSeparator', 'p');
    } catch (e) {
      /* older browsers */
    }
  });
  ed.addEventListener('input', later);
  ed.addEventListener('blur', () => {
    saveRange();
    flush();
  });
  for (const ev of ['keyup', 'mouseup']) ed.addEventListener(ev, () => {
    saveRange();
    updateState();
  });
  ed.addEventListener('paste', (e) => {
    if (!e.clipboardData) return;
    e.preventDefault();
    const h = pasteToHtml(e.clipboardData);
    // a trailing block (table, list…) would leave the caret inside it
    if (h) exec('insertHTML', /<\/(table|ul|ol|pre|blockquote)>$/.test(h) ? `${h}<p><br></p>` : h);
    later();
  });
  ed.addEventListener('drop', (e) => {
    // dropped content goes through the same sanitizer as paste
    if (!e.dataTransfer || (e.dataTransfer.files && e.dataTransfer.files.length)) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    const pos = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (pos) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(pos);
    }
    const h = pasteToHtml(e.dataTransfer);
    if (h) exec('insertHTML', h);
    later();
  });
  ed.addEventListener('keydown', (e) => {
    if (mod(e) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      link();
    }
  });
  ed.addEventListener('click', (e) => {
    const cb = e.target.closest('input[type=checkbox]');
    if (cb) {
      setTimeout(() => {
        if (cb.checked) cb.setAttribute('checked', '');
        else cb.removeAttribute('checked');
        flush();
      });
      return;
    }
    const a = e.target.closest('a[href]');
    if (a && (mod(e) || e.shiftKey)) {
      e.preventDefault();
      const href = safeUrl(a.getAttribute('href'));
      if (href) window.open(href, '_blank', 'noopener,noreferrer');
    }
  });

  return {
    set(html, id) {
      if (id === owner && document.activeElement === ed) return;
      if (id !== owner) flush();
      const clean = sanitizeHtml(html);
      owner = id;
      saved = clean;
      if (ed.innerHTML !== clean) ed.innerHTML = clean;
    },
    flush,
    focus: () => ed.focus(),
  };
}
