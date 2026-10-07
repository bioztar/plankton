// Small inert HTML tokenizer/tree builder exposing the DOM subset read by
// sanitize.js (nodeType, localName, childNodes, getAttribute, textContent).
// Used when DOMParser is unavailable (Node, workers) so sanitizing gives the
// same, idempotent result everywhere. Lenient like a browser: unknown end tags
// are ignored, raw-text elements (script, style, …) swallow up to their end tag.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'image']);
const MAX_NEST = 128;
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', middot: '·', hellip: '…', mdash: '—', ndash: '–', bull: '•',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', euro: '€', pound: '£', reg: '®', trade: '™', times: '×', deg: '°', shy: '\u00ad', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009' };
export const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '\ufffd';
    }
    return ENT[e.toLowerCase()] ?? m;
  });

class LiteNode {
  constructor(type, name) {
    this.nodeType = type;
    this.nodeName = name;
    this.localName = type === 1 ? name : undefined;
    this.childNodes = [];
    this.attrs = new Map();
    this.parentNode = null;
  }
  getAttribute(n) {
    return this.attrs.has(n.toLowerCase()) ? this.attrs.get(n.toLowerCase()) : null;
  }
  hasAttribute(n) {
    return this.attrs.has(n.toLowerCase());
  }
  get textContent() {
    if (this.nodeType === 3) return this.nodeValue;
    if (this.nodeType === 8) return '';
    return this.childNodes.map((c) => c.textContent).join('');
  }
  append(c) {
    c.parentNode = this;
    this.childNodes.push(c);
  }
}

function parseAttrs(src, el) {
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    const k = m[1].toLowerCase();
    if (!el.attrs.has(k)) el.attrs.set(k, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
}

export function parseHTML(html) {
  const doc = new LiteNode(9, '#document');
  const htmlEl = new LiteNode(1, 'html');
  const body = new LiteNode(1, 'body');
  doc.append(htmlEl);
  htmlEl.append(body);
  doc.body = body;
  const stack = [body];
  const top = () => stack[stack.length - 1];
  const s = String(html);
  const lower = s.toLowerCase();
  let i = 0;
  const text = (t) => {
    if (!t) return;
    const p = top();
    const last = p.childNodes[p.childNodes.length - 1];
    if (last && last.nodeType === 3) {
      last.nodeValue += decodeEntities(t);
      return;
    }
    const n = new LiteNode(3, '#text');
    n.nodeValue = decodeEntities(t);
    p.append(n);
  };
  // Linear tag scan: quotes only open after "=", and once a quote char has no
  // later match it is never searched for again, so hostile input such as
  // `<a "` repeated cannot make the scan quadratic.
  const noQuote = { '"': false, "'": false };
  const scanTag = (at) => {
    let j = at + 1;
    const close = s[j] === '/';
    if (close) j++;
    const c0 = s.charCodeAt(j) | 32;
    if (!(c0 >= 97 && c0 <= 122)) return 'text';
    const ns = j;
    while (j < s.length && !/[\s/>]/.test(s[j])) j++;
    const name = lower.slice(ns, j);
    const as = j;
    let prev = '';
    while (j < s.length) {
      const ch = s[j];
      if (ch === '>') return { close, name, attrs: s.slice(as, j), end: j + 1 };
      if ((ch === '"' || ch === "'") && prev === '=' && !noQuote[ch]) {
        const q = s.indexOf(ch, j + 1);
        if (q < 0) noQuote[ch] = true;
        else {
          j = q + 1;
          prev = ch;
          continue;
        }
      }
      if (!/\s/.test(ch)) prev = ch;
      j++;
    }
    return 'eof';
  };
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      text(s.slice(i));
      break;
    }
    text(s.slice(i, lt));
    i = lt;
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      const c = new LiteNode(8, '#comment');
      top().append(c);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (s[i + 1] === '!' || s[i + 1] === '?') {
      const end = s.indexOf('>', i);
      if (!/^<!doctype/i.test(s.slice(i, i + 9))) top().append(new LiteNode(8, '#comment'));
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    const m = scanTag(i);
    if (m === 'eof') {
      // An unterminated tag runs to the end: keep the rest as text.
      text(s.slice(i));
      break;
    }
    if (m === 'text') {
      text('<');
      i++;
      continue;
    }
    i = m.end;
    const name = m.name;
    if (m.close) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].nodeName === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    if (name === 'html' || name === 'body' || name === 'head') continue;
    const el = new LiteNode(1, name);
    parseAttrs(m.attrs, el);
    if (name === 'p' || /^h[1-6]$/.test(name) || name === 'li' || name === 'tr' || name === 'td' || name === 'th') {
      const closes = { p: ['p'], li: ['li', 'p'], tr: ['tr', 'td', 'th'], td: ['td', 'th', 'p'], th: ['td', 'th', 'p'] }[name] || ['p'];
      if (closes.includes(top().nodeName)) stack.pop();
    }
    top().append(el);
    if (RAW.has(name)) {
      const end = lower.indexOf(`</${name}`, i);
      const t = new LiteNode(3, '#text');
      t.nodeValue = s.slice(i, end < 0 ? s.length : end);
      el.append(t);
      i = end < 0 ? s.length : s.indexOf('>', end) + 1 || s.length;
      continue;
    }
    if (!VOID.has(name) && stack.length < MAX_NEST) stack.push(el);
  }
  return doc;
}
