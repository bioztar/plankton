// Tiny markdown subset: **bold**, *italic* / _italic_, `code`, [links](https://…),
// bare URLs, "- " / "* " bullet lists, paragraphs and line breaks.
// Input is escaped first, so raw HTML can never get through; only http(s) and
// mailto links become <a> elements.
import { escapeHtml } from './escape.js';

const SAFE_URL = /^(https?:\/\/|mailto:)[^\s"'<>`]+$/i;

export function safeUrl(url) {
  const u = String(url || '').trim();
  return SAFE_URL.test(u) ? u : null;
}

function unescapeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function link(text, rawUrl) {
  const url = safeUrl(unescapeEntities(rawUrl));
  if (!url) return text;
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
}

function inline(escaped) {
  const codes = [];
  let s = escaped.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  const links = [];
  const stash = (html) => {
    links.push(html);
    return `\u0001${links.length - 1}\u0001`;
  };
  s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, t, u) => stash(link(t, u)));
  s = s.replace(/(^|[\s(])((?:https?:\/\/|mailto:)[^\s<]+[^\s<.,;:!?)])/gi, (_, pre, u) => pre + stash(link(u, u)));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => links[+i]);
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
  return s;
}

/** Render the markdown subset to safe HTML. */
export function renderMarkdown(src) {
  const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(escapeHtml(l))).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<ul>${list.map((l) => `<li>${inline(escapeHtml(l))}</li>`).join('')}</ul>`);
    list = null;
  };
  for (const line of lines) {
    const m = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (m) {
      flushPara();
      (list = list || []).push(m[1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join('');
}
