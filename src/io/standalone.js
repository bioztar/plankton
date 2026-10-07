// The app's own HTML with a plan embedded (Save / read-only presenter copy). Pure string ops.
import { jsonForScript } from '../util/escape.js';
import { serializePlan } from '../model/plan.js';

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

/**
 * The JSON embedded in a saved file; `history` = embedded versions (see versions.js). Saves are editable; only `presenter: true`
 * (Export read-only presenter copy) produces a read-only file, marked mode:'presenter'.
 */
export function buildPayload(plan, { presenter = false, at = new Date().toISOString(), history = null } = {}) {
  const data = JSON.parse(serializePlan(plan, false));
  if (presenter) return { app: 'planboard', mode: 'presenter', readOnly: true, presenter: true, exportedAt: at, plan: data };
  const out = { app: 'planboard', mode: 'edit', readOnly: false, presenter: false, savedAt: at, plan: data };
  if (history && history.length) out.history = history;
  return out;
}

/** Only explicit presenter copies open read-only; v1 "standalone copies" (no mode) open editable. */
export function isPresenterCopy(payload) {
  return !!payload && payload.mode === 'presenter' && payload.readOnly !== false;
}

/** Identifies one written version of a file. */
export function payloadStamp(payload) {
  return (payload && (payload.savedAt || payload.exportedAt)) || null;
}

const stampMs = (s) => Date.parse(s) || 0;

/**
 * Decide what an HTML file with an embedded payload opens. `saved` is this
 * browser's stored plan with the same id (or null). Edits saved here that are
 * newer than the file win, opened editable; otherwise the file's plan opens,
 * editable unless the file is a read-only presenter copy.
 */
export function resolveBoot(payload, saved) {
  if (!payload || !payload.plan) return null;
  const ro = isPresenterCopy(payload);
  const file = { plan: payload.plan, readOnly: ro, presenter: ro && payload.presenter !== false, stamp: payloadStamp(payload) };
  if (saved && saved.id === file.plan.id && stampMs(saved.updatedAt) > stampMs(file.plan.updatedAt)) {
    return { source: 'saved', plan: saved, readOnly: false, presenter: false, file };
  }
  return { source: 'file', plan: file.plan, readOnly: file.readOnly, presenter: file.presenter, file };
}
