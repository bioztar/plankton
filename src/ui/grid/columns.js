// Grid column definitions and per-plan visibility / width settings.
export const COLUMNS = [
  { key: 'num', label: '#', width: 52, fixed: true },
  { key: 'name', label: 'Task name', width: 300, fixed: true, edit: 'text' },
  { key: 'start', label: 'Start', width: 104, edit: 'date', align: 'r' },
  { key: 'finish', label: 'Finish', width: 104, edit: 'date', align: 'r' },
  { key: 'duration', label: 'Dur.', width: 56, edit: 'text', align: 'r', title: 'Duration in working days' },
  { key: 'progress', label: '%', width: 64, edit: 'text', align: 'r', title: 'Progress %' },
  { key: 'owner', label: 'Owner', width: 120, edit: 'text' },
  { key: 'preds', label: 'Predecessors', width: 116, edit: 'text', title: 'e.g. 3, 1.2FS+2d, #7SS-1d' },
  { key: 'status', label: 'Status', width: 104, edit: 'select' },
  { key: 'priority', label: 'Priority', width: 80, edit: 'select', hidden: true },
  { key: 'workstream', label: 'Workstream', width: 120, edit: 'text', hidden: true },
  { key: 'variance', label: 'Variance', width: 76, align: 'r', hidden: (plan) => !plan.settings.showBaseline, title: 'Finish vs. baseline (working days)' },
  { key: 'id', label: 'ID', width: 52, align: 'r', hidden: true, title: 'Task ID (use #ID in predecessors)' },
];

export function columnState(plan) {
  const s = plan.settings.columns || {};
  return COLUMNS.map((c) => {
    const user = s[c.key] || {};
    const dflt = typeof c.hidden === 'function' ? !c.hidden(plan) : !c.hidden;
    return {
      ...c,
      visible: c.fixed ? true : user.explicit ? !!user.visible : dflt,
      width: user.width || c.width,
    };
  });
}

export function visibleColumns(plan) {
  return columnState(plan).filter((c) => c.visible);
}
