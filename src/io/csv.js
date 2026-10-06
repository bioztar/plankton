// CSV export (flat, with outline level). Pure.
import { formatLink } from '../schedule/links.js';
import { variance } from '../model/stats.js';

function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  'ID', 'Outline', 'Outline level', 'Section', 'Name', 'Start', 'Finish', 'Duration', 'Progress %',
  'Status', 'Priority', 'Owner', 'Workstream', 'Tags', 'Milestone', 'Predecessors', 'Baseline start',
  'Baseline finish', 'Variance', 'Notes',
];

export function toCSV(plan, tree) {
  const lines = [CSV_COLUMNS.map(cell).join(',')];
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
      ]
        .map(cell)
        .join(',')
    );
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
