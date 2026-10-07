// CSV export (flat, with outline level). Pure.
import { formatLink } from '../schedule/links.js';
import { variance } from '../model/stats.js';
import { formatValue } from '../model/fields.js';
import { descText } from '../util/sanitize.js';

// Spreadsheet formula injection guard: prefix ' to text a spreadsheet would
// evaluate. Plain numbers ("-2") and list bullets ("- item", "+ item") are kept
// unless they also contain formula / DDE syntax.
export function needsFormulaGuard(s) {
  if (/^[=@\t\r]/.test(s)) return true;
  if (!/^[+-]/.test(s)) return false;
  if (/^[+-]\d+([.,]\d+)?%?$/.test(s)) return false;
  return !(/^[+-] /.test(s) && !/[=|!@]|\w\s*\(/.test(s));
}

function cell(v) {
  let s = v == null ? '' : String(v);
  if (needsFormulaGuard(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  'ID', 'Outline', 'Outline level', 'Section', 'Name', 'Start', 'Finish', 'Duration', 'Progress %',
  'Status', 'Priority', 'Owner', 'Workstream', 'Tags', 'Milestone', 'Predecessors', 'Baseline start',
  'Baseline finish', 'Variance', 'Notes', 'Description',
];

export function toCSV(plan, tree) {
  const fields = plan.fields || [];
  const lines = [[...CSV_COLUMNS, ...fields.map((f) => f.name)].map(cell).join(',')];
  for (const r of plan.rows) {
    if (r.kind === 'section') continue;
    const sec = tree.byId.get(tree.sectionOf.get(r.id));
    const v = variance(r);
    lines.push(
      [
        r.id,
        tree.outline.get(r.id),
        r.level + 1,
        sec ? sec.name : '',
        r.name,
        r.start,
        r.finish,
        r.duration,
        r.progress,
        r.status,
        r.priority,
        r.owner,
        r.workstream,
        (r.tags || []).join('; '),
        r.milestone ? 'Yes' : '',
        r.preds.map((p) => formatLink(p.id, p.type, p.lag)).join(', '),
        r.baseline ? r.baseline.start : '',
        r.baseline ? r.baseline.finish : '',
        v == null ? '' : v,
        r.notes,
        descText(r),
        ...fields.map((f) => formatValue(f, r.values && r.values[f.id])),
      ]
        .map(cell)
        .join(',')
    );
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
