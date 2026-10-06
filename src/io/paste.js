// Paste import: parse TSV/CSV copied from spreadsheets / planning tools,
// auto-detect columns and date order, and turn it into plan rows. Pure.
import { fromYMD, toISO, parseISO, nextWorkday, prevWorkday, startFromDuration, durationFromDates, daysInMonth } from '../schedule/calendar.js';
import { parseLinkToken } from '../schedule/links.js';
import { computeTree, normalizeLevels } from '../model/tree.js';
import { createTask, createSection, STATUSES, PALETTE } from '../model/plan.js';

export const IMPORT_FIELDS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'start', label: 'Start' },
  { key: 'finish', label: 'Finish' },
  { key: 'duration', label: 'Duration' },
  { key: 'owner', label: 'Owner' },
  { key: 'preds', label: 'Predecessors' },
  { key: 'level', label: 'Outline level' },
  { key: 'section', label: 'Section / Bucket' },
  { key: 'notes', label: 'Notes' },
  { key: 'progress', label: 'Progress %' },
  { key: 'status', label: 'Status' },
];

const SYNONYMS = {
  id: ['id', '#', 'task id', 'row', 'row id', 'unique id', 'wbs id'],
  name: ['name', 'task', 'task name', 'title', 'activity', 'item', 'summary', 'work item'],
  start: ['start', 'start date', 'begin', 'begins', 'planned start', 'start time'],
  finish: ['finish', 'end', 'end date', 'finish date', 'due', 'due date', 'planned finish', 'deadline'],
  duration: ['duration', 'dur', 'days', 'work days', 'length'],
  owner: ['owner', 'assigned to', 'assignee', 'resource', 'resource names', 'responsible', 'assigned', 'lead'],
  preds: ['predecessors', 'predecessor', 'depends on', 'dependencies', 'dependency', 'preds'],
  level: ['outline level', 'level', 'outline', 'wbs', 'outline number', 'indent', 'hierarchy'],
  section: ['section', 'bucket', 'bucket name', 'phase', 'workstream', 'stream', 'group', 'category'],
  notes: ['notes', 'note', 'description', 'comments', 'comment', 'details'],
  progress: ['progress', '% complete', 'percent complete', '%', 'complete', '% done', 'pct complete'],
  status: ['status', 'state', 'progress status'],
};

export function detectDelimiter(text) {
  const first = String(text).split(/\r?\n/).find((l) => l.trim()) || '';
  if (first.includes('\t')) return '\t';
  const count = (ch) => {
    let n = 0;
    let q = false;
    for (const c of first) {
      if (c === '"') q = !q;
      else if (c === ch && !q) n++;
    }
    return n;
  };
  const semi = count(';');
  const comma = count(',');
  return semi > comma ? ';' : ',';
}

/** RFC4180-ish parser (quotes, doubled quotes, embedded newlines). */
export function parseDelimited(text, delim = detectDelimiter(text)) {
  const s = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (h) => String(h || '').trim().toLowerCase().replace(/[_*]+/g, ' ').replace(/\s+/g, ' ');

/** Map header cells to fields. Returns { field: columnIndex }. */
export function detectColumns(headers) {
  const map = {};
  const used = new Set();
  const hs = headers.map(norm);
  // exact matches first, then prefix/contains matches
  for (const pass of [0, 1]) {
    for (const f of IMPORT_FIELDS) {
      if (map[f.key] != null) continue;
      const idx = hs.findIndex((h, i) => {
        if (used.has(i) || !h) return false;
        return SYNONYMS[f.key].some((syn) => (pass === 0 ? h === syn : syn.length > 2 && h.startsWith(syn)));
      });
      if (idx >= 0) {
        map[f.key] = idx;
        used.add(idx);
      }
    }
  }
  return map;
}

/** Heuristic: does the first row look like a header row? */
export function looksLikeHeader(row) {
  const m = detectColumns(row);
  return Object.keys(m).length >= 1 && !row.some((c) => parseDateAny(c));
}

const DATE_RE = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?:[ T].*)?$/;

function ymd(y, m, d) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return toISO(fromYMD(y, m, d));
}

/** Parse a date string. order: 'mdy' | 'dmy'. ISO (year first) always accepted. */
export function parseDate(value, order = 'mdy') {
  const s = String(value || '').trim();
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [a, b, c] = [+m[1], +m[2], +m[3]];
  if (m[1].length === 4) return ymd(a, b, c);
  if (m[3].length !== 4 && m[3].length !== 2) return null;
  return order === 'dmy' ? ymd(c, b, a) : ymd(c, a, b);
}

function parseDateAny(value) {
  return parseDate(value, 'mdy') || parseDate(value, 'dmy');
}

/**
 * Inspect date-like values and tell which order(s) are possible:
 * 'iso' | 'mdy' | 'dmy' | 'ambiguous' | 'none'.
 */
export function detectDateOrder(values) {
  let mdy = true;
  let dmy = true;
  let any = false;
  let nonIso = false;
  for (const v of values) {
    const s = String(v || '').trim();
    if (!s) continue;
    const m = DATE_RE.exec(s);
    if (!m) continue;
    any = true;
    if (m[1].length === 4) continue;
    nonIso = true;
    if (!parseDate(s, 'mdy')) mdy = false;
    if (!parseDate(s, 'dmy')) dmy = false;
  }
  if (!any) return 'none';
  if (!nonIso) return 'iso';
  if (mdy && dmy) return 'ambiguous';
  if (mdy) return 'mdy';
  if (dmy) return 'dmy';
  return 'none';
}

/** "5", "5d", "5 days", "2w", "1.5 wks", "0" → working days. */
export function parseDuration(value) {
  const s = String(value || '').trim().toLowerCase();
  const m = /^(\d+(?:[.,]\d+)?)\s*(d|days?|w|wks?|weeks?|h|hrs?|hours?|mo|mons?|months?)?\??$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  const u = m[2] || 'd';
  if (u.startsWith('w')) return Math.round(n * 5);
  if (u.startsWith('h')) return Math.max(n > 0 ? 1 : 0, Math.round(n / 8));
  if (u.startsWith('mo')) return Math.round(n * 20);
  return Math.round(n);
}

// Level column holds either outline numbers ("1.2.3", depth = dots) or
// 1-based outline levels ("1", "2"). Any dotted value switches to outline mode.
function parseLevel(value, outlineMode) {
  const s = String(value || '').trim().replace(/\.$/, '');
  if (!/^\d+(\.\d+)*$/.test(s)) return null;
  if (outlineMode) return s.split('.').length - 1;
  return Math.max(0, +s - 1);
}

function matchStatus(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'completed' || s === 'complete') return 'Done';
  if (s === 'late' || s === 'on hold') return 'Blocked';
  return STATUSES.find((x) => x.toLowerCase() === s) || null;
}

/**
 * Build plan rows from a parsed table.
 * opts: { mapping, hasHeader, dateOrder: 'mdy'|'dmy', defaultStart }
 * Returns { rows, warnings } — rows get fresh ids from plan.nextId.
 * Outline levels come from the level column, else from leading spaces of the name.
 */
export function importTable(plan, table, opts) {
  const mapping = opts.mapping || {};
  const order = opts.dateOrder === 'dmy' ? 'dmy' : 'mdy';
  const body = opts.hasHeader ? table.slice(1) : table.slice();
  const warnings = [];
  const get = (r, k) => (mapping[k] != null && mapping[k] >= 0 ? String(r[mapping[k]] ?? '') : '');
  const nameCol = mapping.name;
  const outlineMode = mapping.level != null && body.some((r) => /^\s*\d+\.\d/.test(String(r[mapping.level] || '')));

  // indent unit for leading-space nesting
  let unit = 0;
  if (mapping.level == null && nameCol != null) {
    for (const r of body) {
      const lead = /^[ \u00a0]*/.exec(String(r[nameCol] || ''))[0].length;
      if (lead > 0) unit = unit ? Math.min(unit, lead) : lead;
    }
  }

  const rows = [];
  const srcIdToNew = new Map();
  const rowNumToNew = new Map();
  const pendingPreds = [];
  let currentSection = null;
  let taskNum = 0;
  let paletteIdx = 0;
  const defaultStart = opts.defaultStart || plan.start;

  body.forEach((r, i) => {
    const rawName = nameCol != null ? String(r[nameCol] || '') : '';
    const name = rawName.trim();
    if (!name) return;
    const section = get(r, 'section').trim();
    if (section && section !== currentSection) {
      currentSection = section;
      rows.push(createSection(plan, { name: section, color: PALETTE[paletteIdx++ % PALETTE.length].color }));
    }
    let level = parseLevel(get(r, 'level'), outlineMode);
    if (level == null) {
      const lead = /^[ \u00a0]*/.exec(rawName)[0].length;
      level = unit ? Math.round(lead / unit) : 0;
    }
    const sRaw = get(r, 'start');
    const fRaw = get(r, 'finish');
    const dRaw = get(r, 'duration');
    let start = parseDate(sRaw, order);
    let finish = parseDate(fRaw, order);
    const dur = parseDuration(dRaw);
    if (sRaw.trim() && !start) warnings.push(`Row ${i + 1}: could not read start "${sRaw.trim()}"`);
    if (fRaw.trim() && !finish) warnings.push(`Row ${i + 1}: could not read finish "${fRaw.trim()}"`);
    let duration;
    const milestone = dur === 0 || (!!start && !!finish && start === finish && dur === 0);
    if (start) start = toISO(nextWorkday(parseISO(start)));
    if (start && finish && parseISO(finish) >= parseISO(start)) {
      duration = durationFromDates(parseISO(start), parseISO(finish));
    } else if (start && dur != null) {
      duration = dur;
    } else if (finish && dur != null && !start) {
      duration = Math.max(dur, 1);
      start = toISO(startFromDuration(prevWorkday(parseISO(finish)), duration));
    } else {
      duration = dur != null ? dur : 1;
    }
    if (!start) start = finish || defaultStart;
    const progressRaw = get(r, 'progress').replace('%', '').trim();
    let progress = progressRaw ? Math.max(0, Math.min(100, Math.round(parseFloat(progressRaw.replace(',', '.'))))) : 0;
    if (Number.isNaN(progress)) progress = 0;
    if (progressRaw && /^0?[.,]\d+$/.test(progressRaw)) progress = Math.round(parseFloat(progressRaw.replace(',', '.')) * 100);
    const status = matchStatus(get(r, 'status')) || (progress >= 100 ? 'Done' : progress > 0 ? 'In progress' : 'Not started');
    const task = createTask(plan, {
      name: name.slice(0, 500),
      level,
      start,
      duration: milestone ? 0 : Math.max(1, duration),
      milestone,
      owner: get(r, 'owner').trim(),
      notes: get(r, 'notes').trim(),
      progress,
      status,
      workstream: section,
    });
    if (milestone) task.finish = task.start;
    rows.push(task);
    taskNum++;
    rowNumToNew.set(String(taskNum), task.id);
    const srcId = get(r, 'id').trim();
    if (srcId) srcIdToNew.set(srcId, task.id);
    const predText = get(r, 'preds').trim();
    if (predText) pendingPreds.push({ task, text: predText, row: i + 1 });
  });

  normalizeLevels(rows);
  const tree = computeTree(rows);
  for (const { task, text, row } of pendingPreds) {
    for (const tok of text.split(/[,;]+/).map((x) => x.trim()).filter(Boolean)) {
      const link = parseLinkToken(tok);
      if (!link) {
        warnings.push(`Row ${row}: could not read predecessor "${tok}"`);
        continue;
      }
      const ref = String(link.ref);
      const id = srcIdToNew.get(ref) ?? (ref.includes('.') ? tree.byOutline.get(ref) : rowNumToNew.get(ref));
      if (id == null || id === task.id) {
        warnings.push(`Row ${row}: unknown predecessor "${tok}"`);
        continue;
      }
      if (!task.preds.some((p) => p.id === id)) task.preds.push({ id, type: link.type, lag: link.lag });
    }
  }
  return { rows, warnings };
}
