// Time scale for the Gantt: zoom levels, date range and header ticks. Pure.
import { parseISO, toYMD, fromYMD, mondayOf, weekday } from '../../schedule/calendar.js';

export const ZOOMS = { day: 32, week: 16, month: 5, quarter: 2 };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function projectRange(tasks, todayDay) {
  let s = Infinity;
  let f = -Infinity;
  for (const t of tasks) {
    const a = parseISO(t.start);
    const b = parseISO(t.finish);
    if (a < s) s = a;
    if (b > f) f = b;
    if (t.baseline) {
      s = Math.min(s, parseISO(t.baseline.start));
      f = Math.max(f, parseISO(t.baseline.finish));
    }
  }
  if (!Number.isFinite(s)) s = f = todayDay;
  return { start: mondayOf(s) - 7, end: mondayOf(f) + 20 };
}

export function fitPpd(range, width) {
  return Math.max(0.4, Math.min(60, width / (range.end - range.start + 1)));
}

function spans(kind, start, end) {
  const out = [];
  let d;
  if (kind === 'day') d = start;
  else if (kind === 'week') d = mondayOf(start);
  else {
    const [y, m] = toYMD(start);
    if (kind === 'month') d = fromYMD(y, m, 1);
    else if (kind === 'quarter') d = fromYMD(y, m - ((m - 1) % 3), 1);
    else d = fromYMD(y, 1, 1);
  }
  while (d <= end) {
    let n;
    if (kind === 'day') n = d + 1;
    else if (kind === 'week') n = d + 7;
    else {
      const [y, m] = toYMD(d);
      const step = kind === 'month' ? 1 : kind === 'quarter' ? 3 : 12;
      n = fromYMD(y + Math.floor((m - 1 + step) / 12), ((m - 1 + step) % 12) + 1, 1);
    }
    out.push([d, n]);
    d = n;
  }
  return out;
}

function label(kind, d, widthPx) {
  const [y, m, dd] = toYMD(d);
  switch (kind) {
    case 'day':
      return widthPx >= 26 ? `${WD[weekday(d)]} ${dd}` : String(dd);
    case 'week':
      return widthPx >= 90 ? `Week of ${dd} ${MON[m - 1]}${widthPx >= 150 ? ' ' + y : ''}` : widthPx >= 44 ? `${dd} ${MON[m - 1]}` : String(dd);
    case 'month':
      return widthPx >= 110 ? `${MONTH[m - 1]} ${y}` : widthPx >= 50 ? `${MON[m - 1]} ${y}` : MON[m - 1];
    case 'quarter':
      return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
    default:
      return String(y);
  }
}

export function tierKinds(ppd) {
  if (ppd >= 22) return ['week', 'day'];
  if (ppd >= 2.8) return ['month', 'week'];
  if (ppd >= 1.1) return ['quarter', 'month'];
  return ['year', 'quarter'];
}

/** Header ticks: { top: [{x, w, label}], bottom: [...] } in px from range.start. */
export function ticks(range, ppd) {
  const [topKind, botKind] = tierKinds(ppd);
  const make = (kind) =>
    spans(kind, range.start, range.end).map(([a, b]) => {
      const s = Math.max(a, range.start);
      const e = Math.min(b, range.end + 1);
      const w = (e - s) * ppd;
      return { x: (s - range.start) * ppd, w, label: label(kind, a, (b - a) * ppd), day: a };
    });
  return { top: make(topKind), bottom: make(botKind), kinds: [topKind, botKind] };
}
