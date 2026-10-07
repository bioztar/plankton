// Strict allow-list HTML sanitizer for task descriptions (pasted Word / Outlook /
// OneNote / web content and stored HTML). Input is parsed with DOMParser (inert:
// no scripts run, nothing loads), or by the built-in parser in htmlparse.js where
// there is no DOM (Node), and the output is rebuilt from scratch: only the
// allow-listed tags and attributes are written, all text is escaped, so nothing
// from the input can reach the output except through this code.
import { escapeHtml } from './escape.js';
import { safeUrl } from './markdown.js';
import { parseHTML, decodeEntities } from './htmlparse.js';

export const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'input',
];
export const MAX_DESC_HTML = 200000;
const MAX_DEPTH = 120;

// Dropped together with everything inside them.
const DROP = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math',
  'head', 'title', 'meta', 'link', 'base', 'textarea', 'select', 'option', 'optgroup', 'button', 'img', 'image', 'picture',
  'video', 'audio', 'source', 'track', 'canvas', 'map', 'area', 'form', 'xml', 'noembed', 'noframes', 'param', 'dialog',
  'portal', 'datalist', 'output', 'progress', 'meter', 'colgroup', 'col', 'caption', 'xmp', 'plaintext', 'listing',
]);
const VOID = new Set(['br', 'hr', 'input']);
const RENAME = { b: 'strong', i: 'em', strike: 's', del: 's', ins: 'u', h4: 'h3', h5: 'h3', h6: 'h3', tt: 'code', kbd: 'code', samp: 'code', tfoot: 'tbody', dir: 'ul', menu: 'ul' };
const BLOCKS = new Set(['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr']);
// Generic containers: become a paragraph (inline content) or are unwrapped (block content).
const CONTAINERS = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'address', 'figure', 'figcaption', 'center', 'dd', 'dt', 'dl', 'details', 'summary', 'fieldset', 'legend', 'body', 'html']);
const PHRASING_PARENTS = new Set(['p', 'h1', 'h2', 'h3', 'pre', 'strong', 'em', 'u', 's', 'code', 'a']);
const CELL_LIKE = new Set(['li', 'td', 'th']);
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const nameOf = (n) => String(n.localName || n.nodeName || '').toLowerCase();
const attr = (n, a) => (n.getAttribute ? n.getAttribute(a) : null);
const styleOf = (n) => String(attr(n, 'style') || '').toLowerCase();
const classOf = (n) => String(attr(n, 'class') || '').toLowerCase();

function parse(html) {
  const P = globalThis.DOMParser;
  if (!P) return parseHTML(html);
  return new P().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
}

/** Word / Outlook list paragraph: <p style="mso-list:l0 level2 lfo1">. */
function wordListInfo(n) {
  if (n.nodeType !== 1 || nameOf(n) !== 'p') return null;
  const m = /mso-list:\s*(l\d+)\s+level(\d+)/.exec(styleOf(n));
  if (!m) return null;
  let marker = '';
  const walk = (x) => {
    for (const c of x.childNodes || []) {
      if (c.nodeType === 1 && /mso-list:\s*ignore/.test(styleOf(c))) marker += c.textContent || '';
      else if (c.nodeType === 1) walk(c);
    }
  };
  walk(n);
  marker = marker.replace(/[\s\u00a0]+/g, '');
  const ordered = /^(\(?[0-9]+|\(?[a-z]{1,4})[.)]$/i.test(marker);
  return { list: m[1], level: Math.max(1, Math.min(9, +m[2])), ordered };
}

function inlineWraps(n, tag) {
  const st = styleOf(n);
  if (!st) return [];
  const w = [];
  if (/font-weight:\s*(bold|[6-9]00)/.test(st) && tag !== 'strong') w.push('strong');
  if (/font-style:\s*italic/.test(st) && tag !== 'em') w.push('em');
  if (/text-decoration[^;]*underline/.test(st) && tag !== 'u') w.push('u');
  if (/text-decoration[^;]*line-through/.test(st) && tag !== 's') w.push('s');
  return w;
}

function hasBlockChild(n) {
  for (const c of n.childNodes || []) {
    if (c.nodeType !== 1) continue;
    const t = RENAME[nameOf(c)] || nameOf(c);
    if (BLOCKS.has(t) || CONTAINERS.has(t) || wordListInfo(c)) return true;
  }
  return false;
}

function isBlank(n) {
  return n.nodeType === 3 ? !/[^\s]/.test(n.nodeValue || '') : n.nodeType === 8;
}

function textOut(s, ctx) {
  let t = String(s || '').replace(CONTROL, '');
  if (!ctx.pre) t = t.replace(/[\r\n\t ]+/g, ' ');
  return escapeHtml(t);
}

function isInline(c) {
  if (c.nodeType === 3) return true;
  if (c.nodeType !== 1) return false;
  const t = RENAME[nameOf(c)] || nameOf(c);
  if (BLOCKS.has(t) || CONTAINERS.has(t) || wordListInfo(c)) return false;
  if (t === 'p' && /msotitle|msosubtitle/.test(classOf(c))) return false;
  return !hasBlockChild(c);
}

function children(n, ctx) {
  const kids = Array.from(n.childNodes || []);
  const block = !ctx.phrasing && !ctx.cell;
  let out = '';
  let run = '';
  const flush = () => {
    if (run.replace(/<br>/g, '').trim()) out += `<p>${run.trim()}</p>`;
    run = '';
  };
  for (let i = 0; i < kids.length; i++) {
    const info = wordListInfo(kids[i]);
    if (info) {
      flush();
      const group = [];
      while (i < kids.length) {
        const inf = wordListInfo(kids[i]);
        if (inf) group.push({ n: kids[i], ...inf });
        else if (!isBlank(kids[i])) break;
        i++;
      }
      i--;
      out += wordList(group, ctx);
      continue;
    }
    if (block && isInline(kids[i])) run += node(kids[i], { ...ctx, phrasing: true }, i === kids.length - 1);
    else {
      if (block) flush();
      out += node(kids[i], ctx, i === kids.length - 1);
    }
  }
  if (block) flush();
  return out;
}

function wordList(items, ctx) {
  let out = '';
  const stack = [];
  const close = () => {
    const s = stack.pop();
    out += `</li></${s.tag}>`;
  };
  for (const it of items) {
    while (stack.length && (stack.length > it.level || (stack.length === it.level && stack[stack.length - 1].list !== it.list && it.level === 1))) close();
    if (stack.length === it.level) out += '</li><li>';
    while (stack.length < it.level) {
      const tag = it.ordered ? 'ol' : 'ul';
      stack.push({ tag, list: it.list });
      out += `<${tag}><li>`;
    }
    out += children(it.n, { ...ctx, depth: ctx.depth + 1, phrasing: true, skipIgnore: true });
  }
  while (stack.length) close();
  return out;
}

function node(n, ctx, last) {
  if (n.nodeType === 3) return textOut(n.nodeValue, ctx);
  if (n.nodeType !== 1) return '';
  if (ctx.depth > MAX_DEPTH) return node2p(textOut(n.textContent, ctx), ctx);
  let tag = nameOf(n);
  if (tag.includes(':')) return tag === 'o:p' ? children(n, ctx) : '';
  if (DROP.has(tag)) return '';
  if (ctx.skipIgnore && /mso-list:\s*ignore/.test(styleOf(n))) return '';
  if (/display:\s*none/.test(styleOf(n))) return '';
  const sub = (extra = {}) => children(n, { ...ctx, depth: ctx.depth + 1, ...extra });
  // Google Docs wraps everything in <b style="font-weight:normal">.
  if (tag === 'b' && /font-weight:\s*(normal|[1-4]00)/.test(styleOf(n))) return sub();
  if (tag === 'p' && /msotitle/.test(classOf(n))) tag = 'h1';
  else if (tag === 'p' && /msosubtitle/.test(classOf(n))) tag = 'h2';
  tag = RENAME[tag] || tag;

  if (tag === 'input') {
    if (String(attr(n, 'type') || '').toLowerCase() !== 'checkbox') return '';
    return `<input type="checkbox"${n.hasAttribute && n.hasAttribute('checked') ? ' checked' : ''}>`;
  }
  if (tag === 'br') return '<br>';
  if (tag === 'hr') return ctx.phrasing ? '<br>' : '<hr>';

  if (CONTAINERS.has(tag) || (tag === 'p' && (ctx.phrasing || ctx.cell)) || /^h[123]$/.test(tag) && ctx.phrasing) {
    if (tag !== 'p' && !/^h/.test(tag) && hasBlockChild(n) && !ctx.phrasing) return sub();
    if (ctx.phrasing || ctx.cell) {
      const inner = sub({ phrasing: true });
      return inner + (last || !inner.trim() ? '' : '<br>');
    }
    const inner = sub({ phrasing: true });
    return inner.trim() ? `<p>${inner}</p>` : '';
  }

  if (tag === 'a') {
    const href = safeUrl(attr(n, 'href'));
    const inner = sub({ inLink: true });
    if (!href || ctx.inLink) return inner;
    return `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${inner}</a>`;
  }

  if (['strong', 'em', 'u', 's', 'code'].includes(tag) || !ALLOWED_TAGS.includes(tag)) {
    const known = ALLOWED_TAGS.includes(tag);
    const wraps = inlineWraps(n, known ? tag : '');
    if (tag === 'code' && ctx.pre) return sub();
    let inner = sub();
    if (!inner) return '';
    for (const w of wraps.reverse()) inner = `<${w}>${inner}</${w}>`;
    return known ? `<${tag}>${inner}</${tag}>` : inner;
  }

  // structural tags
  if (tag === 'li') {
    if (!ctx.list) return node2p(sub({ phrasing: true }), ctx);
    return `<li>${sub({ cell: true, list: false, phrasing: false })}</li>`;
  }
  if (tag === 'ul' || tag === 'ol') {
    if (ctx.phrasing) return sub();
    const inner = Array.from(n.childNodes || [])
      .map((c) => (c.nodeType === 1 && nameOf(c) !== 'li' && nameOf(c) !== 'ul' && nameOf(c) !== 'ol' ? (isBlank(c) ? '' : `<li>${node(c, { ...ctx, depth: ctx.depth + 1, cell: true, list: false }, true)}</li>`) : c.nodeType === 1 ? node(c, { ...ctx, depth: ctx.depth + 1, list: true, cell: false }, true) : isBlank(c) ? '' : `<li>${textOut(c.nodeValue, ctx)}</li>`))
      .join('');
    return inner ? `<${tag}>${inner}</${tag}>` : '';
  }
  if (tag === 'table') {
    if (ctx.phrasing || ctx.table) return sub({ phrasing: true });
    const inner = tableRows(n, ctx);
    return inner ? `<table>${inner}</table>` : '';
  }
  if (tag === 'thead' || tag === 'tbody' || tag === 'tr' || tag === 'td' || tag === 'th') {
    // only reached outside a table: keep the content
    return node2p(sub({ phrasing: true }), ctx);
  }
  if (tag === 'pre') {
    if (ctx.phrasing) return sub({ pre: true });
    const inner = sub({ pre: true, phrasing: true });
    return inner ? `<pre>${inner}</pre>` : '';
  }
  // p, h1-h3, blockquote
  if (tag === 'blockquote') {
    if (ctx.phrasing) return sub();
    const inner = hasBlockChild(n) ? sub({ cell: false }) : sub({ phrasing: true });
    return inner.trim() ? `<blockquote>${inner}</blockquote>` : '';
  }
  const inner = sub({ phrasing: true });
  if (!inner.trim()) return tag === 'p' && /\u00a0/.test(n.textContent || '') ? '<p><br></p>' : '';
  return `<${tag}>${inner}</${tag}>`;
}

function node2p(inner, ctx) {
  if (!inner.trim()) return '';
  return ctx.phrasing || ctx.cell ? inner : `<p>${inner}</p>`;
}

function tableRows(table, ctx) {
  const c = { ...ctx, depth: ctx.depth + 1, table: true };
  const groups = [];
  let loose = [];
  const flush = () => {
    if (loose.length) groups.push({ tag: 'tbody', rows: loose });
    loose = [];
  };
  const rowOf = (tr) => {
    const cells = Array.from(tr.childNodes || [])
      .filter((x) => x.nodeType === 1 && ['td', 'th'].includes(nameOf(x)))
      .map((td) => {
        const t = nameOf(td);
        let a = '';
        for (const k of ['colspan', 'rowspan']) {
          const v = parseInt(attr(td, k), 10);
          if (v > 1 && v <= 100) a += ` ${k}="${v}"`;
        }
        return `<${t}${a}>${children(td, { ...c, cell: true, phrasing: false, list: false })}</${t}>`;
      })
      .join('');
    return cells ? `<tr>${cells}</tr>` : '';
  };
  for (const x of Array.from(table.childNodes || [])) {
    if (x.nodeType !== 1) continue;
    const t = RENAME[nameOf(x)] || nameOf(x);
    if (t === 'tr') loose.push(rowOf(x));
    else if (t === 'thead' || t === 'tbody') {
      flush();
      groups.push({ tag: t, rows: Array.from(x.childNodes || []).filter((r) => r.nodeType === 1 && nameOf(r) === 'tr').map(rowOf) });
    }
  }
  flush();
  return groups
    .map((g) => ({ ...g, rows: g.rows.filter(Boolean) }))
    .filter((g) => g.rows.length)
    .map((g) => `<${g.tag}>${g.rows.join('')}</${g.tag}>`)
    .join('');
}

// Only used with String#replace (which resets lastIndex); never with .test().
const EMPTY_INLINE = /<(strong|em|u|s|code|a)\b[^>]*>(\s*)<\/\1>/g;
const TRAILING_BR = /(?<!<(p|li|td|th|h[123])>)(?:<br>)+<\/(p|li|td|th|h[123]|pre)>/g;

function tidy(html) {
  let s = html;
  for (let k = 0; k < 4; k++) {
    const next = s.replace(EMPTY_INLINE, '$2');
    if (next === s) break;
    s = next;
  }
  return s.replace(TRAILING_BR, '</$2>').replace(/<p>\s*<\/p>/g, '').trim();
}

/**
 * Sanitize untrusted HTML to the description allow-list. Returns an HTML string.
 * Over-long input is cut to MAX_DESC_HTML; pass `report` to learn about it
 * (`report.truncated = true`).
 */
export function sanitizeHtml(input, report) {
  const src = String(input == null ? '' : input);
  if (!src.trim()) return '';
  if (src.length > MAX_DESC_HTML * 4 && report) report.truncated = true;
  const doc = parse(src.slice(0, MAX_DESC_HTML * 4));
  let out = tidy(children(doc.body, { depth: 0 }));
  if (out.length > MAX_DESC_HTML) {
    if (report) report.truncated = true;
    // Cut the clean HTML and re-sanitize (closes the open tags); shrink the cut
    // until the closing tags fit too.
    let budget = MAX_DESC_HTML;
    do {
      budget -= Math.max(64, out.length - MAX_DESC_HTML);
      out = tidy(children(parse(out.slice(0, Math.max(0, budget))).body, { depth: 0 }));
    } while (out.length > MAX_DESC_HTML && budget > 0);
  }
  return out;
}

// Descriptions damaged by v1.2's DOM-less fallback hold their own HTML as
// escaped text, wrapped in <p> once per bad round trip: <p>&lt;p&gt;x…</p>.
const ESCAPED_LAYER = /^<p>([^<]*)<\/p>$/;
const HTML_START = /^\s*<(p|h[1-6]|ul|ol|li|div|table|thead|tbody|tr|blockquote|pre|hr|br|section|article)(\s[^<>]*)?\/?>/i;
export const MAX_REPAIR_LEVELS = 6;

/**
 * Undo up to MAX_REPAIR_LEVELS layers of escaped HTML in sanitized description
 * HTML. A layer is only decoded when its whole text is markup: it starts with a
 * block tag and ends with ">". Text such as "<CR>" or "a < b" is left alone.
 * Returns { html, levels }.
 */
export function repairEscapedHtml(html) {
  let s = String(html || '');
  let levels = 0;
  while (levels < MAX_REPAIR_LEVELS) {
    const m = ESCAPED_LAYER.exec(s);
    if (!m) break;
    const inner = decodeEntities(m[1]).trim();
    if (!HTML_START.test(inner) || !inner.endsWith('>')) break;
    s = sanitizeHtml(inner);
    levels++;
  }
  return { html: s, levels };
}

/** Stored description → clean HTML: sanitize, then repair escaped layers. */
export function cleanDescHtml(input, report) {
  const r = repairEscapedHtml(sanitizeHtml(input, report));
  if (report && r.levels) report.repaired = (report.repaired || 0) + 1;
  return r.html;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const decodeEnt = (t) => t.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENT[e]).replace(/\u00a0/g, ' ');

/**
 * Plain text from sanitized description HTML (CSV export, search, previews).
 * Pure string processing: relies on the known, flat shape of sanitizeHtml output.
 */
export function htmlToText(html) {
  const src = String(html || '');
  if (!src) return '';
  const lines = [];
  let cur = '';
  let depth = 0;
  let cells = 0;
  const flush = () => {
    const l = cur.replace(/\s+$/, '');
    if (l.replace(/^\s*-\s*$/, '').trim()) lines.push(l);
    cur = '';
  };
  for (const tok of src.match(/<[^>]*>|[^<]+/g) || []) {
    if (tok[0] !== '<') {
      const parts = decodeEnt(tok).split('\n');
      parts.forEach((x, k) => {
        if (k) flush();
        cur += x;
      });
      continue;
    }
    const m = /^<(\/?)([a-z0-9]+)/.exec(tok);
    if (!m) continue;
    const [, close, t] = m;
    if (t === 'ul' || t === 'ol') {
      flush();
      depth += close ? -1 : 1;
    } else if (t === 'li') {
      flush();
      if (!close) cur = `${'  '.repeat(Math.max(0, depth - 1))}- `;
    } else if (t === 'td' || t === 'th') {
      if (!close && cells++) cur += ' | ';
    } else if (t === 'tr') {
      flush();
      cells = 0;
    } else if (t === 'br' || (close && /^(p|h[123]|pre|blockquote)$/.test(t))) flush();
    else if (t === 'hr') {
      flush();
      lines.push('---');
    } else if (t === 'input') cur += tok.includes('checked') ? '[x]' : '[ ]';
  }
  flush();
  return lines.join('\n').replace(/\] {2,}/g, '] ');
}

const textCache = new Map();

/** Cached plain text of a task's description. */
export function descText(task) {
  const h = (task && task.descHtml) || '';
  if (!h) return '';
  let t = textCache.get(h);
  if (t == null) {
    if (textCache.size > 5000) textCache.clear();
    t = htmlToText(h);
    textCache.set(h, t);
  }
  return t;
}

/** First non-empty line of a description, trimmed to `max` characters. */
export function firstLine(text, max = 140) {
  const l = String(text || '').split('\n').map((x) => x.replace(/^[-\s]*(\[[ x]\]\s*)?/, '').trim()).find(Boolean) || '';
  return l.length > max ? `${l.slice(0, max - 1)}…` : l;
}
