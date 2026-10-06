// Display formatting (dates are formatted from day numbers, never via local Date parsing).
import { parseISO, toYMD, weekday } from '../schedule/calendar.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Mon 5 Oct" (year appended when it differs from refYear). */
export function fmtDate(iso, refYear) {
  const d = parseISO(iso);
  if (Number.isNaN(d)) return '';
  const [y, m, dd] = toYMD(d);
  return `${WD[weekday(d)]} ${dd} ${MON[m - 1]}${refYear && y !== refYear ? ` ${y}` : ''}`;
}

export function fmtDateLong(iso) {
  const d = parseISO(iso);
  if (Number.isNaN(d)) return '—';
  const [y, m, dd] = toYMD(d);
  return `${WD[weekday(d)]} ${dd} ${MON[m - 1]} ${y}`;
}

export function fmtStamp(stamp) {
  if (!stamp) return '—';
  const t = new Date(stamp);
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString();
}

export function fmtVariance(v) {
  if (v == null) return '';
  if (v === 0) return '0d';
  return `${v > 0 ? '+' : ''}${v}d`;
}

export const statusSlug = (s) => String(s).toLowerCase().replace(/\s+/g, '-');
