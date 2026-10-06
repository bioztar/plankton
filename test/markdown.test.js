import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, safeUrl } from '../src/util/markdown.js';
import { escapeHtml, jsonForScript } from '../src/util/escape.js';

test('basic markdown subset', () => {
  assert.equal(renderMarkdown('**bold** and *it* and _it2_'), '<p><strong>bold</strong> and <em>it</em> and <em>it2</em></p>');
  assert.equal(renderMarkdown('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(renderMarkdown('a\nb\n\nc'), '<p>a<br>b</p><p>c</p>');
  assert.equal(
    renderMarkdown('[docs](https://example.com/a?b=1&c=2)'),
    '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a></p>'
  );
  assert.match(renderMarkdown('see https://example.com.'), /<a href="https:\/\/example.com"[^>]*>https:\/\/example.com<\/a>\.<\/p>/);
  assert.equal(renderMarkdown('`a*b*`'), '<p><code>a*b*</code></p>');
  assert.equal(renderMarkdown(''), '');
});

test('raw HTML is escaped', () => {
  const out = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)> "q" & \'s\'');
  assert.ok(!out.includes('<script'));
  assert.ok(!out.includes('<img'));
  assert.equal(out, '<p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt; &quot;q&quot; &amp; &#39;s&#39;</p>');
  assert.equal(renderMarkdown('- <b>x</b>'), '<ul><li>&lt;b&gt;x&lt;/b&gt;</li></ul>');
});

test('javascript: and other unsafe links are not rendered as links', () => {
  for (const md of [
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](data:text/html;base64,AAAA)',
    '[x](vbscript:msgbox)',
    '[x](https://a.com"onmouseover="alert(1))',
    '[x](//evil.example)',
  ]) {
    const out = renderMarkdown(md);
    assert.ok(!/<a\b/.test(out), `${md} → ${out}`);
    assert.ok(!/href/i.test(out));
  }
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl(' https://ok.example/x '), 'https://ok.example/x');
  assert.equal(safeUrl('mailto:a@b.example'), 'mailto:a@b.example');
});

test('escape helpers', () => {
  assert.equal(escapeHtml('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(escapeHtml(null), '');
  const j = jsonForScript({ s: '</script><script>alert(1)</script>' });
  assert.ok(!j.includes('</script'));
  assert.deepEqual(JSON.parse(j), { s: '</script><script>alert(1)</script>' });
});
