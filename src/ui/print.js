// Print layout: landscape pages, each with a slice of the grid and the matching
// Gantt rows (with a repeated time-scale header), built just before printing.
import { renderGantt, HEADER_H } from './gantt/render.js';
import { projectRange, fitPpd } from './gantt/scale.js';
import { escapeHtml as esc } from '../util/escape.js';
import { fmtDate } from './format.js';
import { planStats } from '../model/stats.js';
import { parseISO, toYMD, todayISO } from '../schedule/calendar.js';

const ROWS_PER_PAGE = 24;
const ROW_H = 22;
const GANTT_W = 600;

export function buildPrint(app, root) {
  const store = app.store;
  const d = store.d;
  const plan = store.plan;
  const rows = d.visible;
  const range = projectRange(d.tree.tasks, app.todayDay());
  const ppd = fitPpd(range, GANTT_W);
  const stats = planStats(plan, d.tree);
  const year = toYMD(parseISO(plan.start))[0];
  const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const out = [];
  for (let p = 0; p < pages; p++) {
    const from = p * ROWS_PER_PAGE;
    const to = Math.min(rows.length, from + ROWS_PER_PAGE);
    const gridRows = [];
    for (let i = from; i < to; i++) {
      const r = rows[i];
      if (r.kind === 'section') {
        gridRows.push(`<div class="pp-row pp-sec" style="--sec:${r.color}"><span class="pp-name">${esc(r.name)}</span></div>`);
        continue;
      }
      const sum = d.tree.isSummary(r.id);
      const tint = d.sectionColor.get(r.id);
      gridRows.push(
        `<div class="pp-row${sum ? ' pp-sum' : ''}"${tint ? ` style="--tint:${tint}"` : ''}><span class="pp-num">${esc(d.tree.outline.get(r.id))}</span><span class="pp-name" style="padding-left:${r.level * 12}px">${r.milestone ? '◆ ' : ''}${esc(r.name)}</span><span class="pp-d">${esc(fmtDate(r.start, year))}</span><span class="pp-d">${esc(fmtDate(r.finish, year))}</span><span class="pp-n">${r.milestone ? 0 : r.duration}d</span><span class="pp-n">${r.progress}%</span></div>`
      );
    }
    const { svg } = renderGantt({
      rows, tree: d.tree, from, to, range, ppd, rowH: ROW_H, header: true, indexOf: d.indexOf, sectionColor: d.sectionColor,
      critical: d.critical, done: d.done, conflicts: d.conflictKeys, showBaseline: plan.settings.showBaseline, labelMode: plan.settings.labelMode,
      todayDay: app.todayDay(), prefix: `p${p}`,
    });
    out.push(`<section class="pp">
<header class="pp-h"><strong>${esc(plan.name)}</strong><span>${stats.tasks} tasks · ${stats.percent}% done · finish ${esc(fmtDate(stats.finish, year))}${plan.owner ? ` · owner ${esc(plan.owner)}` : ''}</span><span>Printed ${todayISO()} · page ${p + 1} of ${pages}</span></header>
<div class="pp-body"><div class="pp-grid"><div class="pp-row pp-hrow" style="height:${HEADER_H}px"><span class="pp-num">#</span><span class="pp-name">Task</span><span class="pp-d">Start</span><span class="pp-d">Finish</span><span class="pp-n">Dur.</span><span class="pp-n">%</span></div>${gridRows.join('')}</div><div class="pp-gantt">${svg}</div></div>
</section>`);
  }
  root.innerHTML = out.join('');
}

export function clearPrint(root) {
  root.innerHTML = '';
}
