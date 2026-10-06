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

const stampMs = (s) => Date.parse(s) || 0;

/**
 * Decide what an HTML file with an embedded payload opens. `saved` is this
 * browser's stored plan with the same id (or null). Edits saved here that are
 * newer than the file win, opened editable; otherwise the file's plan opens with
 * the payload's flags (read-only + presenter unless they are explicitly false).
 */
export function resolveBoot(payload, saved) {
  if (!payload || !payload.plan) return null;
  const file = { plan: payload.plan, readOnly: payload.readOnly !== false, presenter: payload.presenter !== false };
  if (saved && saved.id === file.plan.id && stampMs(saved.updatedAt) > stampMs(file.plan.updatedAt)) {
    return { source: 'saved', plan: saved, readOnly: false, presenter: false, file };
  }
  return { source: 'file', plan: file.plan, readOnly: file.readOnly, presenter: file.presenter, file };
}
