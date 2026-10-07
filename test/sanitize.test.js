import './minidom.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeHtml, htmlToText, firstLine, ALLOWED_TAGS } from '../src/util/sanitize.js';
import { markdownToHtml, looksLikeMarkdown, textToHtml } from '../src/util/markdown.js';

const fixture = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const tagsIn = (html) => [...html.matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1]);
const attrsIn = (html) => [...html.matchAll(/<[a-z0-9]+((?:\s[^>]*)?)>/g)].flatMap((m) => [...m[1].matchAll(/\s([a-z-]+)(?:=|\s|$)/g)].map((x) => x[1]));

function assertSafe(out) {
  for (const t of tagsIn(out)) assert.ok(ALLOWED_TAGS.includes(t), `tag ${t} in ${out}`);
  for (const a of attrsIn(out)) assert.ok(['href', 'rel', 'target', 'colspan', 'rowspan', 'type', 'checked'].includes(a), `attr ${a} in ${out}`);
  assert.ok(!/javascript:|data:|vbscript:/i.test(out.replace(/>[^<]*</g, '><')), `unsafe url in ${out}`);
  assert.ok(!/\son\w+=/i.test(out.replace(/>[^<]*</g, '><')), `handler in ${out}`);
  assert.equal(sanitizeHtml(out), out, 'sanitizer is idempotent');
}

test('hostile input: scripts, handlers, iframes, svg, styles, images', () => {
  const cases = {
    '<script>alert(1)</script><p>ok</p>': '<p>ok</p>',
    '<p onclick="alert(1)" onmouseover=alert(2)>hi</p>': '<p>hi</p>',
    '<img src=x onerror=alert(1)>text': '<p>text</p>',
    '<img src="data:image/png;base64,AAAA">': '',
    '<img src="https://tracker.example/pixel.gif">': '',
    '<iframe src="https://evil.example"></iframe><p>after</p>': '<p>after</p>',
    '<svg><script>alert(1)</script><a xlink:href="javascript:alert(1)">x</a></svg><p>y</p>': '<p>y</p>',
    '<svg onload=alert(1)><circle/></svg>': '',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>': '',
    '<style>body{display:none}</style><p style="background:url(javascript:alert(1));color:red">styled</p>': '<p>styled</p>',
    '<p style="position:fixed;top:0;left:0;width:100%;height:100%">overlay</p>': '<p>overlay</p>',
    '<object data="x.swf"></object><embed src="x.swf"><p>z</p>': '<p>z</p>',
    '<form action="https://evil.example"><input name=pw><button>Go</button></form>': '',
    '<p>a<!-- secret comment -->b</p>': '<p>ab</p>',
    '<meta http-equiv="refresh" content="0;url=https://evil.example"><link rel=stylesheet href=//evil.example/x.css><base href="https://evil.example/">t': '<p>t</p>',
    '<template><img src=x onerror=alert(1)></template>t': '<p>t</p>',
    '<div id="x" class="y" data-foo="1" title="t" aria-label="l">plain</div>': '<p>plain</p>',
    '<input type="text" value="x"><input type="checkbox" checked onclick="alert(1)">done': '<p><input type="checkbox" checked>done</p>',
    '<input type="image" src="x">': '',
    '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>': '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  };
  for (const [inp, want] of Object.entries(cases)) {
    const out = sanitizeHtml(inp);
    assert.equal(out, want, inp);
    assertSafe(out);
  }
});

test('hostile input: link schemes', () => {
  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'jav&#x09;ascript:alert(1)', 'jav&#x0A;ascript:alert(1)', '&#106;avascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'vbscript:msgbox(1)', '//evil.example/x', 'file:///etc/passwd']) {
    const out = sanitizeHtml(`<a href="${href}">click</a>`);
    assert.equal(out, '<p>click</p>', href);
  }
  assert.ok(!/onmouseover/.test(sanitizeHtml('<a href="https://a.example" onmouseover="alert(1)">x</a>')));
  assert.equal(
    sanitizeHtml('<a href="https://ok.example/a?b=1&amp;c=2" target="_self" rel="opener" onclick="x()">ok</a>'),
    '<p><a href="https://ok.example/a?b=1&amp;c=2" rel="noopener noreferrer" target="_blank">ok</a></p>'
  );
  assert.equal(sanitizeHtml('<a href="mailto:a@b.example">mail</a>'), '<p><a href="mailto:a@b.example" rel="noopener noreferrer" target="_blank">mail</a></p>');
  assert.equal(sanitizeHtml('<a href="https://x.example"><a href="https://y.example">in</a></a>').match(/<a /g).length, 1);
});

test('hostile input: nested noscript / mutation-XSS shapes', () => {
  const cases = [
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
    '<noscript><noscript></noscript><img src=x onerror=alert(1)></noscript>',
    '<p><noscript><style></noscript><img src=x onerror=alert(1)></style></noscript></p>',
    '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
    '<math><mi><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src=1>">',
    '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
    '<xmp><img src=x onerror=alert(1)></xmp>',
    '<title><img src=x onerror=alert(1)></title>',
    '<textarea><img src=x onerror=alert(1)></textarea>',
    '<![CDATA[<img src=x onerror=alert(1)>]]>',
    '<!--><img src=x onerror=alert(1)>-->',
    '<a href="javascript&colon;alert(1)">x</a>',
    `${'<div>'.repeat(500)}deep${'</div>'.repeat(500)}`,
  ];
  for (const c of cases) {
    const out = sanitizeHtml(c);
    assertSafe(out);
    assert.ok(!/<img|onerror|<style|<script|<noscript|<svg|<textarea/i.test(out), `${c} → ${out}`);
  }
});

test('keeps allowed structure: headings, lists, tables, inline, breaks', () => {
  const html = '<h1>T</h1><h4>Deep</h4><p>a <b>b</b> <i>c</i> <u>u</u> <strike>s</strike> <code>x</code><br>line2</p>' +
    '<ul><li>one<ul><li>nested</li></ul></li><li><input type="checkbox"> todo</li></ul><ol><li>first</li></ol>' +
    '<blockquote><p>quote</p></blockquote><pre><code>let a = 1;\n  b()</code></pre><hr>' +
    '<table><thead><tr><th colspan="2" style="x">H</th></tr></thead><tbody><tr><td rowspan="2">1</td><td>2</td></tr></tbody></table>';
  const out = sanitizeHtml(html);
  assert.equal(
    out,
    '<h1>T</h1><h3>Deep</h3><p>a <strong>b</strong> <em>c</em> <u>u</u> <s>s</s> <code>x</code><br>line2</p>' +
      '<ul><li>one<ul><li>nested</li></ul></li><li><input type="checkbox"> todo</li></ul><ol><li>first</li></ol>' +
      '<blockquote><p>quote</p></blockquote><pre>let a = 1;\n  b()</pre><hr>' +
      '<table><thead><tr><th colspan="2">H</th></tr></thead><tbody><tr><td rowspan="2">1</td><td>2</td></tr></tbody></table>'
  );
  assertSafe(out);
});

test('Word paste fixture keeps headings, nested lists, numbering, table and formatting', () => {
  const out = sanitizeHtml(fixture('word.html'));
  assertSafe(out);
  assert.ok(!/mso|MsoNormal|Ignore|·|<o:|clip_image|StartFragment|font-family/i.test(out), out);
  assert.match(out, /^<h1>Rollout plan<\/h1>/);
  assert.match(out, /<p>Agree <strong>scope<\/strong>, <em>roles<\/em> and the <u>timeline<\/u> with <a href="https:\/\/intranet.example.com\/rollout" rel="noopener noreferrer" target="_blank">the sponsor<\/a>\.<\/p>/);
  assert.match(out, /<ul><li>First bullet<ul><li>Nested bullet<\/li><\/ul><\/li><li>Second bullet<\/li><\/ul>/);
  assert.match(out, /<ol><li>Step one<\/li><li>Step <strong>two<\/strong><\/li><\/ol>/);
  assert.match(out, /<table><tbody><tr><td><strong>Wave<\/strong><\/td><td><strong>Users<\/strong><\/td><\/tr><tr><td>Pilot<\/td><td>25<\/td><\/tr><\/tbody><\/table>/);
  assert.match(out, /<p>After image<\/p>$/);
});

test('Outlook paste fixture keeps paragraphs, lists, links and line breaks', () => {
  const out = sanitizeHtml(fixture('outlook.html'));
  assertSafe(out);
  assert.ok(!/mso|font-face|WordSection|color/i.test(out), out);
  assert.match(out, /^<p>Hi team,<\/p>/);
  assert.match(out, /<p>Please review the open items before <strong>Friday<\/strong>:<\/p>/);
  assert.match(out, /<ul><li>Licences – see <a href="https:\/\/contoso.sharepoint.com\/sites\/it\/Lic.xlsx" rel="noopener noreferrer" target="_blank">tracker<\/a><\/li><li><em>Training<\/em> dates<\/li><\/ul>/);
  assert.match(out, /<p>Thanks,<br>Alex<\/p>/);
  assert.match(out, /mailto:alex@contoso.example/);
});

test('web, Google Docs and OneNote shapes', () => {
  assert.equal(
    sanitizeHtml('<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700">Bold</span> and <span style="font-style:italic">it</span></p><ul><li dir="ltr"><p dir="ltr"><span>Item</span></p></li></ul></b>'),
    '<p><strong>Bold</strong> and <em>it</em></p><ul><li>Item</li></ul>'
  );
  assert.equal(
    sanitizeHtml('<div style="direction:ltr"><table border="1"><tr><td><p style="margin:0in;font-family:Calibri">Cell A</p></td><td><p>Line 1</p><p>Line 2</p></td></tr></table></div>'),
    '<table><tbody><tr><td>Cell A</td><td>Line 1<br>Line 2</td></tr></tbody></table>'
  );
  assert.equal(sanitizeHtml('<div>one</div><div>two<div>three</div></div>'), '<p>one</p><p>two</p><p>three</p>');
  assert.equal(sanitizeHtml('plain <span>text</span>'), '<p>plain text</p>');
});

test('markdown → HTML (migration and plain-text paste)', () => {
  assert.equal(markdownToHtml('Agree scope, roles and the **4-week timeline**.'), '<p>Agree scope, roles and the <strong>4-week timeline</strong>.</p>');
  assert.equal(markdownToHtml('# Title\n## Sub\n#### Deep'), '<h1>Title</h1><h2>Sub</h2><h3>Deep</h3>');
  assert.equal(markdownToHtml('- one\n  - nested\n- two'), '<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>');
  assert.equal(markdownToHtml('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(markdownToHtml('- [ ] todo\n- [x] done'), '<ul><li><input type="checkbox"> todo</li><li><input type="checkbox" checked> done</li></ul>');
  assert.equal(markdownToHtml('> quoted'), '<blockquote><p>quoted</p></blockquote>');
  assert.equal(markdownToHtml('```\n<b>x</b>\n```'), '<pre>&lt;b&gt;x&lt;/b&gt;</pre>');
  assert.equal(markdownToHtml('a\n\n---\n\nb'), '<p>a</p><hr><p>b</p>');
  assert.equal(markdownToHtml('| A | B |\n|---|---|\n| 1 | 2 |'), '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  assert.equal(markdownToHtml('[docs](https://example.com) ~~old~~'), '<p><a href="https://example.com" rel="noopener noreferrer" target="_blank">docs</a> <s>old</s></p>');
  assert.equal(markdownToHtml('<script>alert(1)</script> [x](javascript:alert(1))'), '<p>&lt;script&gt;alert(1)&lt;/script&gt; x</p>');
  for (const md of ['# T\n\n- a\n  - b\n\n1. x\n\n> q\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] done', 'Kick-off with **sponsor**\n- agenda\n- [notes](https://x.example)']) {
    const h = markdownToHtml(md);
    assert.equal(sanitizeHtml(h), h, 'markdown output is already canonical');
  }
  assert.equal(looksLikeMarkdown('# Heading\ntext'), true);
  assert.equal(looksLikeMarkdown('- a\n- b'), true);
  assert.equal(looksLikeMarkdown('some **bold** words'), true);
  assert.equal(looksLikeMarkdown('Just a sentence. And another one.'), false);
  assert.equal(textToHtml('a\nb\n\nc <d>'), '<p>a<br>b</p><p>c &lt;d&gt;</p>');
});

test('plain text from description HTML (CSV, search, previews)', () => {
  const h = '<h1>Plan</h1><p>Agree <strong>scope</strong> &amp; roles<br>next</p><ul><li>one<ul><li>two</li></ul></li><li><input type="checkbox" checked> done</li></ul><table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>';
  assert.equal(htmlToText(h), 'Plan\nAgree scope & roles\nnext\n- one\n  - two\n- [x] done\nA | B');
  assert.equal(firstLine(htmlToText(h)), 'Plan');
  assert.equal(firstLine('\n\n- [ ] task one\nmore'), 'task one');
  assert.equal(firstLine('x'.repeat(200), 20).length, 20);
  assert.equal(htmlToText(''), '');
});
