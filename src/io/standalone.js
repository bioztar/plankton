// "Export standalone copy": the app's own HTML with a plan embedded. Pure string ops.
import { jsonForScript } from '../util/escape.js';

const DATA_RE = /(<script type="application\/json" id="pb-data">)([\s\S]*?)(<\/script>)/;

export function embedPayload(html, payload) {
  if (!DATA_RE.test(html)) throw new Error('Cannot find the data block in this file.');
  return html.replace(DATA_RE, (_, open, _old, close) => open + jsonForScript(payload) + close);
}

export function extractPayload(html) {
  const m = DATA_RE.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[2]);
  } catch (e) {
    return null;
  }
}
