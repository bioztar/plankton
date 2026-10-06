// Working-day calendar (Mon–Fri). Dates are stored as ISO "YYYY-MM-DD" strings and
// handled internally as integer day numbers (days since 1970-01-01, UTC), so no
// timezone can shift a date.

const DAY_MS = 86400000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2200;
/** Upper bound for a task duration and |lag|, in working days (~38 years). */
export const MAX_DURATION = 10000;
export const MAX_LAG = 10000;

/** Coerce to an integer in [lo, hi]; non-numbers become `dflt`. */
export function clampInt(v, lo, hi, dflt = 0) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

export const clampDuration = (v, dflt = 0) => clampInt(v, 0, MAX_DURATION, dflt);
export const clampLag = (v) => clampInt(v, -MAX_LAG, MAX_LAG, 0);

export function isISODate(s) {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < MIN_YEAR || y > MAX_YEAR || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

// Date.UTC maps years 0–99 to 1900–1999, so set the full year explicitly.
function utcMs(y, m0, d) {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m0, d);
  return dt.getTime();
}

export function daysInMonth(y, m) {
  return new Date(utcMs(y, m, 0)).getUTCDate();
}

export function fromYMD(y, m, d) {
  return Math.round(utcMs(y, m - 1, d) / DAY_MS);
}

export function toYMD(day) {
  const dt = new Date(day * DAY_MS);
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

export function parseISO(s) {
  const m = ISO_RE.exec(s || '');
  if (!m) return NaN;
  return fromYMD(+m[1], +m[2], +m[3]);
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

export function toISO(day) {
  const [y, m, d] = toYMD(day);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Today in the user's local calendar, as a day number. */
export function today(now = new Date()) {
  return fromYMD(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function todayISO(now = new Date()) {
  return toISO(today(now));
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(day) {
  return (((day + 3) % 7) + 7) % 7;
}

export function isWorkday(day) {
  return weekday(day) < 5;
}

// Day 0 of the working-day index is Monday 1969-12-29 (day -3).
/** Number of working days in [origin, day). Weekend days map to the following Monday. */
export function wdIndex(day) {
  const m = day + 3;
  const week = Math.floor(m / 7);
  const dow = m - week * 7;
  return week * 5 + Math.min(dow, 5);
}

export function fromWdIndex(i) {
  const week = Math.floor(i / 5);
  const d = i - week * 5;
  return week * 7 + d - 3;
}

export function nextWorkday(day) {
  return fromWdIndex(wdIndex(day));
}

export function prevWorkday(day) {
  const w = weekday(day);
  return w < 5 ? day : day - (w - 4);
}

/** Move k working days from day (a weekend start snaps forward to Monday first). */
export function addWorkdays(day, k) {
  return fromWdIndex(wdIndex(day) + k);
}

/** Count of working days in the inclusive range [a, b] (0 when b < a). */
export function workdaysInclusive(a, b) {
  if (b < a) return 0;
  return wdIndex(b + 1) - wdIndex(a);
}

/** Signed working-day distance from a to b (b − a), after snapping both to workdays. */
export function workdayDiff(a, b) {
  return wdIndex(nextWorkday(b)) - wdIndex(nextWorkday(a));
}

/** Finish date for a task of `dur` working days starting on `start` (inclusive). */
export function finishFromDuration(start, dur) {
  const s = nextWorkday(start);
  return dur <= 0 ? s : addWorkdays(s, dur - 1);
}

export function startFromDuration(finish, dur) {
  const f = prevWorkday(finish);
  return dur <= 0 ? f : addWorkdays(f, -(dur - 1));
}

export function durationFromDates(start, finish) {
  return Math.max(0, workdaysInclusive(start, finish));
}

// ISO-string conveniences ---------------------------------------------------

export function addWorkdaysISO(iso, k) {
  return toISO(addWorkdays(parseISO(iso), k));
}

export function addDaysISO(iso, k) {
  return toISO(parseISO(iso) + k);
}

export function finishFromDurationISO(startIso, dur) {
  return toISO(finishFromDuration(parseISO(startIso), dur));
}

export function durationISO(startIso, finishIso) {
  return durationFromDates(parseISO(startIso), parseISO(finishIso));
}

export function mondayOf(day) {
  return day - weekday(day);
}

/**
 * Apply an edit to one of start / finish / duration and recompute the third.
 * `pinned` is the other field the user last edited (it is kept); the remaining
 * field is recomputed. Defaults: start keeps duration, finish and duration keep start.
 * Returns { start, finish, duration } (ISO strings + integer).
 */
export function applyDateEdit(task, field, value, pinned) {
  let start = parseISO(task.start);
  let finish = parseISO(task.finish);
  let dur = clampDuration(task.duration);
  const milestone = !!task.milestone;
  const defaults = { start: 'duration', finish: 'start', duration: 'start' };
  if (!pinned || pinned === field) pinned = defaults[field];
  if (field === 'start') start = nextWorkday(parseISO(value));
  else if (field === 'finish') finish = prevWorkday(parseISO(value));
  else dur = clampDuration(value);
  if (Number.isNaN(start) || Number.isNaN(finish)) return null;
  const recompute = ['start', 'finish', 'duration'].find((f) => f !== field && f !== pinned);
  if (recompute === 'finish') {
    if (milestone) dur = 0;
    finish = finishFromDuration(start, dur);
  } else if (recompute === 'duration') {
    if (finish < start) {
      if (field === 'start') finish = start;
      else start = finish;
    }
    dur = milestone ? 0 : Math.max(1, durationFromDates(start, finish));
    if (milestone) finish = start;
  } else {
    if (milestone) dur = 0;
    start = startFromDuration(finish, dur);
  }
  return { start: toISO(start), finish: toISO(finish), duration: dur };
}
