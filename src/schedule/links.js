// Dependency links: parsing/formatting "4FS+2d" style text and the date maths of
// the four link types. Lag is in working days (negative = lead).
import {
  addWorkdays,
  startFromDuration,
  finishFromDuration,
} from './calendar.js';

export const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'];

export const LINK_LABELS = {
  FS: 'Finish → Start',
  SS: 'Start → Start',
  FF: 'Finish → Finish',
  SF: 'Start → Finish',
};

const TOKEN_RE =
  /^(#?\d+(?:\.\d+)*)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*(d|days?|w|wks?|weeks?|ed|edays?)?)?$/i;

/** Parse one token like "1.2FS+2d", "#7SS-1d", "3". Returns { ref, type, lag } or null. */
export function parseLinkToken(token) {
  const m = TOKEN_RE.exec(String(token).trim());
  if (!m) return null;
  let lag = 0;
  if (m[3]) {
    lag = parseInt(m[4], 10);
    const unit = (m[5] || 'd').toLowerCase();
    if (unit.startsWith('w')) lag *= 5;
    if (m[3] === '-') lag = -lag;
  }
  return { ref: m[1], type: (m[2] || 'FS').toUpperCase(), lag };
}

/** Parse a comma/semicolon separated predecessor list. */
export function parseLinkList(text) {
  const items = [];
  const errors = [];
  for (const raw of String(text || '').split(/[,;]+/)) {
    const tok = raw.trim();
    if (!tok) continue;
    const p = parseLinkToken(tok);
    if (p) items.push(p);
    else errors.push(`Cannot read "${tok}" (use e.g. 3, 1.2FS+2d, #7SS-1d)`);
  }
  return { items, errors };
}

export function formatLag(lag) {
  if (!lag) return '';
  return `${lag > 0 ? '+' : '-'}${Math.abs(lag)}d`;
}

export function formatLink(ref, type, lag) {
  if (type === 'FS' && !lag) return String(ref);
  return `${ref}${type}${formatLag(lag)}`;
}

/**
 * Earliest start (day number) of a successor given its predecessor's dates.
 * pred: { start, finish } day numbers; succ: { duration, milestone }.
 * A milestone sits at the end of its day, so an FS milestone may share the
 * predecessor's finish day.
 */
export function earliestStart(pred, succ, link) {
  const lag = link.lag | 0;
  const dur = succ.milestone ? 0 : Math.max(0, succ.duration | 0);
  switch (link.type) {
    case 'SS':
      return addWorkdays(pred.start, lag);
    case 'FF':
      return startFromDuration(addWorkdays(pred.finish, lag), dur);
    case 'SF':
      return startFromDuration(addWorkdays(pred.start, lag - 1), dur);
    case 'FS':
    default:
      return addWorkdays(pred.finish, (succ.milestone ? 0 : 1) + lag);
  }
}

/**
 * Latest finish (day number) of a predecessor that still lets the successor
 * keep its late dates. succ: { ls, lf, milestone }; pred: { duration, milestone }.
 */
export function latestFinish(pred, succ, link) {
  const lag = link.lag | 0;
  const dur = pred.milestone ? 0 : Math.max(0, pred.duration | 0);
  switch (link.type) {
    case 'SS':
      return finishFromDuration(addWorkdays(succ.ls, -lag), dur);
    case 'FF':
      return addWorkdays(succ.lf, -lag);
    case 'SF':
      return finishFromDuration(addWorkdays(succ.lf, -(lag - 1)), dur);
    case 'FS':
    default:
      return addWorkdays(succ.ls, -((succ.milestone ? 0 : 1) + lag));
  }
}
