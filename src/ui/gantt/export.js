// "Export PNG of Gantt": SVG → <img> → <canvas> → PNG, no libraries.
import { renderGantt, GANTT_CSS, HEADER_H } from './render.js';
import { escapeHtml as esc } from '../../util/escape.js';
import { download, safeFilename } from '../dom.js';
import { todayISO } from '../../schedule/calendar.js';

export function resolveVars(css) {
  const cs = getComputedStyle(document.documentElement);
  return css.replace(/var\((--[\w-]+)\)/g, (_, n) => cs.getPropertyValue(n).trim() || '#888');
}

export function ganttSVG(app, { rowH = 26, nameW = 300 } = {}) {
  const store = app.store;
  const d = store.d;
  const { range, ppd } = app.gantt.metrics();
  const s = store.plan.settings;
  const chart = renderGantt({
    rows: d.visible, tree: d.tree, range, ppd, rowH, header: true, indexOf: d.indexOf, sectionColor: d.sectionColor,
    critical: d.critical, conflicts: d.conflictKeys, showBaseline: s.showBaseline, labelMode: s.labelMode,
    todayDay: app.todayDay(), prefix: 'x',
  });
  const titleH = 34;
  const W = nameW + chart.width;
  const H = titleH + chart.height;
  const names = [];
  d.visible.forEach((r, i) => {
    const y = titleH + HEADER_H + i * rowH;
    if (r.kind === 'section') {
      names.push(`<rect x="0" y="${y}" width="${nameW}" height="${rowH}" style="fill:${r.color}" fill-opacity=".22"/><text x="10" y="${y + rowH / 2 + 4}" font-weight="700">${esc(r.name)}</text>`);
    } else {
      const bold = d.tree.isSummary(r.id) ? ' font-weight="700"' : '';
      names.push(`<text x="${8}" y="${y + rowH / 2 + 4}" class="hs">${esc(d.tree.outline.get(r.id))}</text><text x="${44 + r.level * 14}" y="${y + rowH / 2 + 4}"${bold}>${esc(r.name.length > 48 ? r.name.slice(0, 47) + '…' : r.name)}</text>`);
    }
  });
  const css = resolveVars(GANTT_CSS);
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fff';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="gsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${css}</style>
<rect width="${W}" height="${H}" fill="${bg}"/>
<text x="10" y="22" font-size="15" font-weight="700">${esc(store.plan.name)}</text><text x="${W - 10}" y="22" text-anchor="end" class="hs">Exported ${todayISO()}</text>
<rect class="hb" x="0" y="${titleH}" width="${nameW}" height="${HEADER_H}"/><text x="10" y="${titleH + 28}" class="ht">Task</text>
<line class="hl" x1="${nameW}" y1="${titleH}" x2="${nameW}" y2="${H}"/>
${names.join('')}
<svg x="${nameW}" y="${titleH}" width="${chart.width}" height="${chart.height}">${chart.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>
</svg>`;
  return { svg, width: W, height: H };
}

export async function exportGanttPNG(app) {
  const { svg, width, height } = ganttSVG(app);
  const scale = Math.max(0.25, Math.min(2, 16000 / width, 16000 / height, Math.sqrt(16e6 / (width * height))));
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('Could not render the chart image.'));
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('The browser could not create the PNG (chart too large?).');
  download(safeFilename(`${app.store.plan.name} - Gantt`, 'png'), blob);
}
