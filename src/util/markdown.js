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
  // Control characters are dropped up front: they are never meaningful in a
  // description and \u0000 / \u0001 are used as placeholders below.
  const text = String(src == null ? '' : src).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
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

const CANON_LINK = / target="_blank" rel="noopener noreferrer"/g;
const inlineMd = (s) => inline(escapeHtml(s)).replace(/~~([^~]+)~~/g, '<s>$1</s>').replace(CANON_LINK, ' rel="noopener noreferrer" target="_blank"');
const LIST_RE = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/**
 * Markdown to description HTML (headings, lists incl. nested and checklists,
 * quotes, code, tables, rules, inline formatting). Output uses only the
 * description allow-list and is already in sanitizeHtml's canonical form.
 */
export function markdownToHtml(src) {
  const text = String(src == null ? '' : src).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inlineMd).join('<br>')}</p>`);
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre>${escapeHtml(code.join('\n')) || '<br>'}</pre>`);
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara();
      const lvl = Math.min(3, h[1].length);
      out.push(`<h${lvl}>${inlineMd(h[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flushPara();
      const q = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) q.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      out.push(`<blockquote>${markdownToHtml(q.join('\n'))}</blockquote>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushPara();
      const head = cellsOf(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) body.push(cellsOf(lines[i++]));
      const row = (cells, t) => `<tr>${cells.map((c) => `<${t}>${inlineMd(c)}</${t}>`).join('')}</tr>`;
      out.push(`<table><thead>${row(head, 'th')}</thead>${body.length ? `<tbody>${body.map((r) => row(r, 'td')).join('')}</tbody>` : ''}</table>`);
      continue;
    }
    if (LIST_RE.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && (LIST_RE.test(lines[i]) || (items.length && /^\s{2,}\S/.test(lines[i]) && !LIST_RE.test(lines[i])))) {
        const m = LIST_RE.exec(lines[i]);
        if (m) items.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), text: m[3] });
        else items[items.length - 1].text += `\n${lines[i].trim()}`;
        i++;
      }
      out.push(listHtml(items));
      continue;
    }
    if (!line.trim()) flushPara();
    else para.push(line);
    i++;
  }
  flushPara();
  return out.join('');
}

function listHtml(items) {
  let out = '';
  const stack = [];
  for (const it of items) {
    while (stack.length && it.indent < stack[stack.length - 1].indent) out += `</li></${stack.pop().tag}>`;
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) {
      const tag = it.ordered ? 'ol' : 'ul';
      stack.push({ indent: it.indent, tag });
      out += `<${tag}><li>`;
    } else out += '</li><li>';
    const ck = /^\[([ xX])\]\s+(.*)$/s.exec(it.text);
    const body = (ck ? ck[2] : it.text).split('\n').map(inlineMd).join('<br>');
    out += ck ? `<input type="checkbox"${ck[1] === ' ' ? '' : ' checked'}> ${body}` : body;
  }
  while (stack.length) out += `</li></${stack.pop().tag}>`;
  return out;
}

/** Does pasted plain text look like Markdown (rather than ordinary prose)? */
export function looksLikeMarkdown(text) {
  const s = String(text || '');
  return (
    /^\s{0,3}#{1,6}\s+\S/m.test(s) ||
    /^\s*([-*+]|\d{1,3}[.)])\s+\S/m.test(s) ||
    /^\s{0,3}>\s?\S/m.test(s) ||
    /^\s*```/m.test(s) ||
    /\*\*[^*\n]+\*\*/.test(s) ||
    /\[[^\]\n]+\]\((https?:|mailto:)[^)\s]+\)/.test(s) ||
    (/^\s*\|.*\|\s*$/m.test(s) && TABLE_SEP.test(s.split('\n').find((l, k, a) => k > 0 && TABLE_SEP.test(l)) || ''))
  );
}

/** Plain text to paragraphs (blank line) and line breaks, escaped. */
export function textToHtml(text) {
  return String(text == null ? '' : text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim())
    .map((p) => `<p>${p.split('\n').map((l) => escapeHtml(l)).join('<br>')}</p>`)
    .join('');
}
