// Gantt SVG renderer (string output). Used by the live chart (a window of rows),
// the print layout and the PNG export. No DOM access.
import { escapeHtml as esc } from '../../util/escape.js';
import { parseISO, weekday } from '../../schedule/calendar.js';
import { ticks } from './scale.js';

export const HEADER_H = 44;

// Shared SVG styles; var(--x) are resolved to concrete colours for PNG export.
export const GANTT_CSS = `
.gsvg{font-family:var(--font);font-size:11px}
.gsvg text{fill:var(--fg)}
.gsvg .we{fill:var(--weekend)}
.gsvg .gl{stroke:var(--grid);stroke-width:1}
.gsvg .hb{fill:var(--panel)}
.gsvg .hl{stroke:var(--line);stroke-width:1}
.gsvg .ht{font-weight:600}
.gsvg .hs{fill:var(--muted)}
.gsvg .today{stroke:var(--today);stroke-width:2}
.gsvg .sr{fill-opacity:.16}
.gsvg .tr{fill-opacity:.06}
.gsvg .b{fill:var(--bar)}
.gsvg .pg{fill:#000;fill-opacity:.3;pointer-events:none}
.gsvg .sum .b{fill:var(--summary)}
.gsvg .sum .pg{fill:var(--accent);fill-opacity:.9}
.gsvg .ms .b{fill:var(--milestone)}
.gsvg .crit .b{stroke:var(--crit);stroke-width:2.2}
.gsvg .sel .b{stroke:var(--accent);stroke-width:2.2}
.gsvg .bl{fill:var(--baseline);fill-opacity:.7}
.gsvg .lbl{font-size:11px}
.gsvg .sum .lbl{font-weight:700}
.gsvg .lk .ln{fill:none;stroke:var(--link);stroke-width:1.3}
.gsvg .lk .hit{fill:none;stroke:transparent;stroke-width:10}
.gsvg .lk.crit .ln{stroke:var(--crit);stroke-width:2}
.gsvg .lk.conf .ln{stroke:var(--conf);stroke-width:1.8;stroke-dasharray:5 3}
.gsvg .mk{fill:var(--link)}
.gsvg .mk-c{fill:var(--crit)}
.gsvg .mk-x{fill:var(--conf)}
.gsvg .mk-h{fill:var(--accent)}
`;

const r1 = (n) => Math.round(n * 10) / 10;

/** Horizontal geometry of a task bar. */
export function barGeom(t, range, ppd) {
  const s = parseISO(t.start) - range.start;
  const f = parseISO(t.finish) - range.start;
  if (t.milestone) {
    const cx = (f + 1) * ppd;
    return { x1: cx - 7, x2: cx + 7, cx, ms: true };
  }
  const x1 = s * ppd;
  const x2 = Math.max(x1 + 3, (f + 1) * ppd);
  return { x1, x2, cx: (x1 + x2) / 2, ms: false };
}

/** Orthogonal arrow path with a distinct route per link type. */
export function linkPath(type, a, b, rowH) {
  const e = 8;
  const fromStart = type === 'SS' || type === 'SF';
  const toStart = type === 'FS' || type === 'SS';
  const px = r1(fromStart ? a.x1 : a.x2);
  const sx = r1(toStart ? b.x1 : b.x2);
  const py = a.y;
  const sy = b.y;
  const dir = sy >= py ? 1 : -1;
  const midY = r1(sy - (dir * rowH) / 2);
  if (type === 'SS') return `M${px},${py}H${r1(Math.min(px, sx) - e)}V${sy}H${sx}`;
  if (type === 'FF') return `M${px},${py}H${r1(Math.max(px, sx) + e)}V${sy}H${sx}`;
  if (type === 'SF') {
    const ox = px - e;
    if (ox >= sx + e) return `M${px},${py}H${ox}V${sy}H${sx}`;
    return `M${px},${py}H${ox}V${midY}H${sx + e}V${sy}H${sx}`;
  }
  const ox = px + e;
  if (ox <= sx - 2) return `M${px},${py}H${ox}V${sy}H${sx}`;
  return `M${px},${py}H${ox}V${midY}H${sx - e}V${sy}H${sx}`;
}

export function renderHeader(range, ppd, width, opts = {}) {
  const t = ticks(range, ppd);
  const h = HEADER_H;
  const out = [`<rect class="hb" x="0" y="0" width="${width}" height="${h}"/>`];
  for (const k of t.top) {
    out.push(`<line class="hl" x1="${r1(k.x)}" y1="0" x2="${r1(k.x)}" y2="${h}"/>`);
    const vx = Math.max(k.x, 0);
    if (k.x + k.w - vx > String(k.label).length * 7 + 10) out.push(`<text class="ht" x="${r1(vx + 5)}" y="16">${esc(k.label)}</text>`);
  }
  for (const k of t.bottom) {
    out.push(`<line class="hl" x1="${r1(k.x)}" y1="22" x2="${r1(k.x)}" y2="${h}"/>`);
    if (k.w >= 12 && (k.w < 30 || k.x + k.w - Math.max(k.x, 0) > String(k.label).length * 6 + 8)) {
      const tx = k.w < 30 ? k.x + k.w / 2 : Math.max(k.x, 0) + 4;
      out.push(`<text class="hs" x="${r1(tx)}" y="37"${k.w < 30 ? ' text-anchor="middle"' : ''}>${esc(k.label)}</text>`);
    }
  }
  out.push(`<line class="hl" x1="0" y1="22" x2="${width}" y2="22"/><line class="hl" x1="0" y1="${h - 0.5}" x2="${width}" y2="${h - 0.5}"/>`);
  if (opts.todayDay != null && opts.todayDay >= range.start && opts.todayDay <= range.end) {
    const x = r1((opts.todayDay - range.start + 0.5) * ppd);
    out.push(`<line class="today" x1="${x}" y1="22" x2="${x}" y2="${h}"/>`);
  }
  return out.join('');
}

/**
 * o: { rows (display list), tree, from, to, range, ppd, rowH, header (bool),
 *      indexOf: Map id→display index, sectionColor: Map id→colour, critical, conflicts: Set "p>s",
 *      showBaseline, labelMode, selection: Set, todayDay, interactive, prefix, styles (css string) }
 */
export function renderGantt(o) {
  const { rows, tree, range, ppd, rowH } = o;
  const from = o.from || 0;
  const to = Math.min(o.to == null ? rows.length : o.to, rows.length);
  const headerH = o.header ? HEADER_H : 0;
  const width = Math.ceil((range.end - range.start + 1) * ppd);
  const height = headerH + Math.max(0, to - from) * rowH;
  const p = o.prefix || 'g';
  const y0 = (i) => headerH + (i - from) * rowH;
  const crit = o.critical;
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="gsvg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );
  if (o.styles) out.push(`<style>${o.styles}</style>`);
  const marker = (id, cls) =>
    `<marker id="${p}-${id}" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="${cls}" d="M0,0.5L8,4L0,7.5z"/></marker>`;
  out.push(`<defs>${marker('m', 'mk')}${marker('mc', 'mk-c')}${marker('mx', 'mk-x')}${marker('mh', 'mk-h')}`);
  const showWeekends = ppd >= 2.8;
  if (showWeekends) {
    let sat = range.start;
    while (weekday(sat) !== 5) sat++;
    out.push(
      `<pattern id="${p}-we" patternUnits="userSpaceOnUse" x="${r1((sat - range.start) * ppd)}" y="0" width="${r1(7 * ppd)}" height="${rowH}"><rect class="we" width="${r1(2 * ppd)}" height="${rowH}"/></pattern>`
    );
  }
  out.push('</defs>');

  // background: section tints, weekends, grid lines, today
  const bg = [];
  for (let i = from; i < to; i++) {
    const r = rows[i];
    const col = r.kind === 'section' ? r.color : o.sectionColor && o.sectionColor.get(r.id);
    if (col) bg.push(`<rect class="${r.kind === 'section' ? 'sr' : 'tr'}" x="0" y="${y0(i)}" width="${width}" height="${rowH}" style="fill:${col}"/>`);
  }
  out.push(bg.join(''));
  if (showWeekends) out.push(`<rect x="0" y="${headerH}" width="${width}" height="${height - headerH}" fill="url(#${p}-we)"/>`);
  const tk = ticks(range, ppd);
  const gl = [];
  for (const k of tk.bottom) gl.push(`<line class="gl" x1="${r1(k.x)}" y1="${headerH}" x2="${r1(k.x)}" y2="${height}"/>`);
  out.push(gl.join(''));
  if (o.todayDay != null && o.todayDay >= range.start && o.todayDay <= range.end) {
    const x = r1((o.todayDay - range.start + 0.5) * ppd);
    out.push(`<line class="today" x1="${x}" y1="${headerH}" x2="${x}" y2="${height}"/>`);
  }

  // links
  const idx = o.indexOf;
  const geom = new Map();
  const g = (id) => {
    if (!geom.has(id)) {
      const t = tree.byId.get(id);
      const b = barGeom(t, range, ppd);
      b.y = r1(y0(idx.get(id)) + rowH / 2);
      geom.set(id, b);
    }
    return geom.get(id);
  };
  const links = [];
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i];
    if (t.kind === 'section' || !t.preds || !t.preds.length) continue;
    for (const l of t.preds) {
      const pi = idx.get(l.id);
      if (pi == null) continue;
      if (Math.max(pi, i) < from || Math.min(pi, i) >= to) continue;
      const key = `${l.id}>${t.id}`;
      const isConf = o.conflicts && o.conflicts.has(key);
      const isCrit = !isConf && crit && crit.links.has(key);
      const d = linkPath(l.type, g(l.id), g(t.id), rowH);
      const m = isConf ? 'mx' : isCrit ? 'mc' : 'm';
      links.push(
        `<g class="lk${isCrit ? ' crit' : ''}${isConf ? ' conf' : ''}" data-link="${key}">${o.interactive ? `<path class="hit" d="${d}"/>` : ''}<path class="ln" d="${d}" marker-end="url(#${p}-${m})"/>${o.interactive ? `<title>${esc(linkTitle(tree, l, t))}</title>` : ''}</g>`
      );
    }
  }
  out.push(`<g class="links">${links.join('')}</g>`);

  // bars
  const bh = Math.round(rowH * 0.56);
  const bars = [];
  for (let i = from; i < to; i++) {
    const t = rows[i];
    if (t.kind === 'section') continue;
    const y = y0(i);
    const cy = y + rowH / 2;
    const b = barGeom(t, range, ppd);
    const summary = tree.isSummary(t.id);
    const cls = ['bar', summary ? 'sum' : '', b.ms ? 'ms' : '', crit && crit.tasks.has(t.id) ? 'crit' : '', o.selection && o.selection.has(t.id) ? 'sel' : '']
      .filter(Boolean)
      .join(' ');
    const color = !summary && !b.ms && o.sectionColor && o.sectionColor.get(t.id);
    const fill = color ? ` style="fill:${color}"` : '';
    const parts = [];
    if (o.showBaseline && t.baseline) {
      const bb = barGeom({ start: t.baseline.start, finish: t.baseline.finish, milestone: t.milestone }, range, ppd);
      if (b.ms) parts.push(`<path class="bl" d="M${r1(bb.cx)},${r1(y + rowH - 9)}l4,4l-4,4l-4,-4z"/>`);
      else parts.push(`<rect class="bl" x="${r1(bb.x1)}" y="${r1(y + rowH - 6)}" width="${r1(bb.x2 - bb.x1)}" height="4" rx="1"/>`);
    }
    if (b.ms) {
      const r = 7;
      parts.push(`<path class="b" d="M${r1(b.cx)},${r1(cy - r)}L${r1(b.cx + r)},${r1(cy)}L${r1(b.cx)},${r1(cy + r)}L${r1(b.cx - r)},${r1(cy)}z"/>`);
    } else if (summary) {
      const ty = r1(cy - 5);
      const h = 7;
      const x1 = r1(b.x1);
      const x2 = r1(b.x2);
      const tip = Math.min(5, (x2 - x1) / 2);
      parts.push(`<path class="b" d="M${x1},${ty}H${x2}V${ty + h + 5}L${r1(x2 - tip)},${ty + h}H${r1(x1 + tip)}L${x1},${ty + h + 5}z"/>`);
      if (t.progress > 0) parts.push(`<rect class="pg" x="${x1}" y="${ty + 2}" width="${r1(((x2 - x1) * t.progress) / 100)}" height="3"/>`);
    } else {
      const by = r1(cy - bh / 2);
      const w = r1(b.x2 - b.x1);
      parts.push(`<rect class="b" x="${r1(b.x1)}" y="${by}" width="${w}" height="${bh}" rx="3"${fill}/>`);
      if (t.progress > 0) parts.push(`<rect class="pg" x="${r1(b.x1)}" y="${r1(cy + bh / 2 - 4)}" width="${r1((w * t.progress) / 100)}" height="4" rx="1"/>`);
      if (o.interactive) parts.push(`<rect class="rz" x="${r1(b.x2 - 5)}" y="${by}" width="7" height="${bh}"/>`);
    }
    if (o.interactive) {
      parts.push(`<circle class="hd" data-h="start" cx="${r1(b.x1 - 7)}" cy="${r1(cy)}" r="4.5"><title>Drag to link from start</title></circle>`);
      parts.push(`<circle class="hd" data-h="finish" cx="${r1(b.x2 + 7)}" cy="${r1(cy)}" r="4.5"><title>Drag to link from finish</title></circle>`);
    }
    const text = o.labelMode === 'owner' ? t.owner : o.labelMode === 'none' ? '' : t.name;
    if (text) parts.push(`<text class="lbl" x="${r1(b.x2 + (o.interactive ? 15 : 6))}" y="${r1(cy + 4)}">${esc(text)}</text>`);
    bars.push(`<g class="${cls}" data-id="${t.id}">${parts.join('')}</g>`);
  }
  out.push(`<g class="bars">${bars.join('')}</g>`);
  if (o.header) out.push(renderHeader(range, ppd, width, { todayDay: o.todayDay }));
  out.push('</svg>');
  return { svg: out.join(''), width, height };
}

const TYPE_NAMES = { FS: 'Finish → Start', SS: 'Start → Start', FF: 'Finish → Finish', SF: 'Start → Finish' };
function linkTitle(tree, l, succ) {
  const lag = l.lag ? ` ${l.lag > 0 ? '+' : ''}${l.lag}d` : '';
  return `${tree.outline.get(l.id)} → ${tree.outline.get(succ.id)}: ${TYPE_NAMES[l.type]}${lag} (click to edit)`;
}
