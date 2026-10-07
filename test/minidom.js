// Minimal HTML parser exposing the DOMParser subset used by src/util/sanitize.js,
// so sanitizer tests run in Node without dependencies. The app itself uses the
// browser's DOMParser. Lenient like a browser: unknown end tags are ignored,
// raw-text elements (script, style, …) swallow everything up to their end tag.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'image']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', middot: '·', hellip: '…', mdash: '—', ndash: '–', bull: '•' };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '\ufffd';
    }
    return ENT[e.toLowerCase()] ?? m;
  });

class Node {
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
    if (!el.attrs.has(k)) el.attrs.set(k, decode(m[2] ?? m[3] ?? m[4] ?? ''));
  }
}

export function parseHTML(html) {
  const doc = new Node(9, '#document');
  const htmlEl = new Node(1, 'html');
  const body = new Node(1, 'body');
  doc.append(htmlEl);
  htmlEl.append(body);
  doc.body = body;
  const stack = [body];
  const top = () => stack[stack.length - 1];
  const s = String(html);
  let i = 0;
  const text = (t) => {
    if (!t) return;
    const n = new Node(3, '#text');
    n.nodeValue = decode(t);
    top().append(n);
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
      const c = new Node(8, '#comment');
      top().append(c);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (s[i + 1] === '!' || s[i + 1] === '?') {
      const end = s.indexOf('>', i);
      if (!/^<!doctype/i.test(s.slice(i, i + 9))) top().append(new Node(8, '#comment'));
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(s.slice(i));
    if (!m) {
      text('<');
      i++;
      continue;
    }
    i += m[0].length;
    const name = m[2].toLowerCase();
    if (m[1]) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].nodeName === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    if (name === 'html' || name === 'body' || name === 'head') continue;
    const el = new Node(1, name);
    parseAttrs(m[3], el);
    if (name === 'p' || /^h[1-6]$/.test(name) || name === 'li' || name === 'tr' || name === 'td' || name === 'th') {
      const closes = { p: ['p'], li: ['li', 'p'], tr: ['tr', 'td', 'th'], td: ['td', 'th', 'p'], th: ['td', 'th', 'p'] }[name] || ['p'];
      if (closes.includes(top().nodeName)) stack.pop();
    }
    top().append(el);
    if (RAW.has(name)) {
      const end = s.toLowerCase().indexOf(`</${name}`, i);
      const t = new Node(3, '#text');
      t.nodeValue = s.slice(i, end < 0 ? s.length : end);
      el.append(t);
      i = end < 0 ? s.length : s.indexOf('>', end) + 1 || s.length;
      continue;
    }
    if (!VOID.has(name)) stack.push(el);
  }
  return doc;
}

export class MiniDOMParser {
  parseFromString(html) {
    const m = /<body>([\s\S]*)<\/body><\/html>$/.exec(html);
    return parseHTML(m ? m[1] : html);
  }
}

if (!globalThis.DOMParser) globalThis.DOMParser = MiniDOMParser;
