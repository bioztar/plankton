// Plan data model: defaults, normalisation of untrusted JSON and serialisation.
import { clampDuration, clampLag, MAX_DURATION, isISODate, parseISO, toISO, todayISO, nextWorkday, finishFromDuration, durationFromDates } from '../schedule/calendar.js';
import { LINK_TYPES } from '../schedule/links.js';
import { normalizeLevels } from './tree.js';
import { sanitizeLinks } from '../schedule/engine.js';
import { sanitizeHtml, MAX_DESC_HTML } from '../util/sanitize.js';
import { markdownToHtml } from '../util/markdown.js';
import { normFields, normValues } from './fields.js';

export const SCHEMA_VERSION = 1;
export const STATUSES = ['Not started', 'In progress', 'Blocked', 'Done'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
export const PLAN_STATUSES = ['On track', 'At risk', 'Off track', 'On hold', 'Complete'];
export const LOG_STATUSES = {
  risks: ['Open', 'Mitigating', 'Closed'],
  decisions: ['Proposed', 'Agreed', 'Rejected'],
  questions: ['Open', 'Answered', 'Closed'],
};
export const LOG_FIELDS = {
  risks: ['risk', 'impact', 'likelihood', 'mitigation', 'owner', 'status'],
  decisions: ['decision', 'by', 'date', 'status'],
  questions: ['question', 'owner', 'answer', 'status'],
};
export const LEVELS = ['Low', 'Medium', 'High'];
export const PALETTE = [
  { name: 'Blue', color: '#3b82f6' },
  { name: 'Teal', color: '#0d9488' },
  { name: 'Green', color: '#16a34a' },
  { name: 'Lime', color: '#65a30d' },
  { name: 'Amber', color: '#d97706' },
  { name: 'Orange', color: '#ea580c' },
  { name: 'Red', color: '#dc2626' },
  { name: 'Pink', color: '#db2777' },
  { name: 'Purple', color: '#7c3aed' },
  { name: 'Slate', color: '#64748b' },
];

export const DEFAULT_SETTINGS = {
  autoSchedule: true,
  showCritical: false,
  showBaseline: false,
  zoom: 'week',
  dayWidth: 0,
  labelMode: 'name',
  columns: null,
  columnOrder: null,
  gridWidth: 0,
};

export function uid() {
  const a = new Uint8Array(8);
  globalThis.crypto.getRandomValues(a);
  return 'p' + Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

export function nowStamp() {
  return new Date().toISOString();
}

export function nextId(plan) {
  return plan.nextId++;
}

export function createTask(plan, fields = {}) {
  const start = fields.start || plan.start || todayISO();
  const s = nextWorkday(parseISO(start));
  const milestone = !!fields.milestone;
  const duration = milestone ? 0 : fields.duration != null ? Math.max(1, clampDuration(fields.duration)) : 1;
  const stamp = nowStamp();
  return {
    id: fields.id != null ? fields.id : nextId(plan),
    kind: 'task',
    level: 0,
    name: '',
    descHtml: '',
    start: toISO(s),
    finish: toISO(finishFromDuration(s, duration)),
    duration,
    progress: 0,
    status: 'Not started',
    priority: 'Medium',
    owner: '',
    workstream: '',
    tags: [],
    milestone,
    notes: '',
    preds: [],
    custom: [],
    values: {},
    collapsed: false,
    baseline: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...fields,
    ...(fields.start || fields.duration != null || fields.milestone
      ? { start: toISO(s), finish: toISO(finishFromDuration(s, duration)), duration, milestone }
      : {}),
  };
}

export function createSection(plan, fields = {}) {
  return {
    id: fields.id != null ? fields.id : nextId(plan),
    kind: 'section',
    level: 0,
    name: 'New section',
    color: PALETTE[0].color,
    collapsed: false,
    ...fields,
  };
}

export function createPlan(fields = {}) {
  const stamp = nowStamp();
  return {
    schema: SCHEMA_VERSION,
    app: 'planboard',
    id: uid(),
    name: 'Untitled plan',
    owner: '',
    start: todayISO(),
    statusDate: '',
    status: 'On track',
    rows: [],
    fields: [],
    nextId: 1,
    baselineSavedAt: null,
    logs: { risks: [], decisions: [], questions: [] },
    settings: { ...DEFAULT_SETTINGS },
    createdAt: stamp,
    updatedAt: stamp,
    ...fields,
  };
}

const str = (v, max = 20000) => (v == null ? '' : String(v).slice(0, max));
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const COLOR_RE = /^#[0-9a-f]{6}$/i;

function normTask(t, plan) {
  const milestone = !!t.milestone;
  let start = isISODate(t.start) ? t.start : plan.start;
  let finish = isISODate(t.finish) ? t.finish : null;
  let duration = Number.isFinite(+t.duration) ? clampDuration(t.duration) : null;
  if (milestone) {
    duration = 0;
    finish = start;
  } else if (finish && parseISO(finish) >= parseISO(start)) {
    duration = Math.max(1, durationFromDates(parseISO(start), parseISO(finish)));
    if (duration > MAX_DURATION) {
      duration = MAX_DURATION;
      finish = toISO(finishFromDuration(parseISO(start), duration));
    }
  } else {
    duration = Math.max(1, duration || 1);
    finish = toISO(finishFromDuration(parseISO(start), duration));
  }
  const preds = Array.isArray(t.preds)
    ? t.preds
        .filter((p) => p && Number.isInteger(+p.id))
        .map((p) => ({ id: +p.id, type: pick(String(p.type || 'FS').toUpperCase(), LINK_TYPES, 'FS'), lag: clampLag(p.lag) }))
    : [];
  const baseline =
    t.baseline && isISODate(t.baseline.start) && isISODate(t.baseline.finish)
      ? { start: t.baseline.start, finish: t.baseline.finish }
      : null;
  return {
    id: +t.id,
    kind: 'task',
    level: Math.max(0, Math.floor(+t.level || 0)),
    name: str(t.name, 500),
    descHtml: t.descHtml != null ? sanitizeHtml(str(t.descHtml, MAX_DESC_HTML * 2)) : t.desc ? markdownToHtml(str(t.desc)) : '',
    start,
    finish,
    duration,
    progress: Math.max(0, Math.min(100, Math.round(+t.progress || 0))),
    status: pick(t.status, STATUSES, 'Not started'),
    priority: pick(t.priority, PRIORITIES, 'Medium'),
    owner: str(t.owner, 200),
    workstream: str(t.workstream, 200),
    tags: Array.isArray(t.tags) ? t.tags.map((x) => str(x, 60).trim()).filter(Boolean) : [],
    milestone,
    notes: str(t.notes),
    preds,
    custom: Array.isArray(t.custom)
      ? t.custom.filter((c) => c && typeof c === 'object').map((c) => ({ key: str(c.key, 200), value: str(c.value, 2000) }))
      : [],
    values: normValues(t.values, plan.fields || []),
    collapsed: !!t.collapsed,
    baseline,
    createdAt: str(t.createdAt, 40) || nowStamp(),
    updatedAt: str(t.updatedAt, 40) || nowStamp(),
  };
}

function normSection(s) {
  return {
    id: +s.id,
    kind: 'section',
    level: 0,
    name: str(s.name, 300) || 'Section',
    color: COLOR_RE.test(s.color) ? s.color : PALETTE[0].color,
    collapsed: !!s.collapsed,
  };
}

function normLog(list, kind) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e === 'object')
    .map((e, i) => {
      const o = { id: Number.isInteger(+e.id) ? +e.id : i + 1 };
      for (const f of LOG_FIELDS[kind]) o[f] = str(e[f], 4000);
      if (!LOG_STATUSES[kind].includes(o.status)) o.status = LOG_STATUSES[kind][0];
      return o;
    });
}

/**
 * Validate and fill defaults on a plan from untrusted JSON. Throws on non-plans.
 * Links that would form a cycle (or point at sections) are removed; pass a
 * `report` object to receive them as `report.droppedLinks`.
 */
export function normalizePlan(input, report) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.rows)) {
    throw new Error('Not a planboard plan (missing "rows").');
  }
  const base = createPlan();
  const plan = {
    ...base,
    id: typeof input.id === 'string' && /^[\w-]{1,40}$/.test(input.id) ? input.id : base.id,
    name: str(input.name, 200) || 'Imported plan',
    owner: str(input.owner, 200),
    start: isISODate(input.start) ? input.start : base.start,
    statusDate: isISODate(input.statusDate) ? input.statusDate : '',
    status: pick(input.status, PLAN_STATUSES, 'On track'),
    baselineSavedAt: input.baselineSavedAt ? str(input.baselineSavedAt, 40) : null,
    createdAt: str(input.createdAt, 40) || base.createdAt,
    updatedAt: str(input.updatedAt, 40) || base.updatedAt,
    settings: { ...DEFAULT_SETTINGS },
  };
  const s = input.settings && typeof input.settings === 'object' ? input.settings : {};
  plan.settings.autoSchedule = s.autoSchedule !== false;
  plan.settings.showCritical = !!s.showCritical;
  plan.settings.showBaseline = !!s.showBaseline;
  plan.settings.zoom = pick(s.zoom, ['day', 'week', 'month', 'quarter', 'fit'], 'week');
  plan.settings.dayWidth = Number.isFinite(+s.dayWidth) ? +s.dayWidth : 0;
  plan.settings.labelMode = pick(s.labelMode, ['name', 'owner', 'none'], 'name');
  plan.settings.gridWidth = Number.isFinite(+s.gridWidth) ? +s.gridWidth : 0;
  if (s.columns && typeof s.columns === 'object') {
    const cols = {};
    for (const [k, v] of Object.entries(s.columns)) {
      if (/^\w{1,30}$/.test(k) && v && typeof v === 'object') {
        cols[k] = { visible: v.visible !== false, ...(v.explicit ? { explicit: true } : {}), width: +v.width > 0 ? Math.max(30, Math.min(800, +v.width)) : undefined };
      }
    }
    plan.settings.columns = cols;
  }
  if (Array.isArray(s.columnOrder)) {
    plan.settings.columnOrder = [...new Set(s.columnOrder.filter((k) => typeof k === 'string' && /^\w{1,30}$/.test(k)))].slice(0, 200);
  }
  plan.fields = normFields(input.fields);
  const seen = new Set();
  let maxId = 0;
  plan.rows = [];
  for (const r of input.rows) {
    if (!r || typeof r !== 'object' || !Number.isInteger(+r.id) || +r.id <= 0 || seen.has(+r.id)) continue;
    seen.add(+r.id);
    maxId = Math.max(maxId, +r.id);
    plan.rows.push(r.kind === 'section' ? normSection(r) : normTask(r, plan));
  }
  normalizeLevels(plan.rows);
  for (const r of plan.rows) if (r.kind !== 'section') r.preds = r.preds.filter((p) => seen.has(p.id) && p.id !== r.id);
  plan.nextId = Math.max(maxId + 1, Number.isInteger(+input.nextId) ? +input.nextId : 1);
  const logs = input.logs && typeof input.logs === 'object' ? input.logs : {};
  plan.logs = {
    risks: normLog(logs.risks, 'risks'),
    decisions: normLog(logs.decisions, 'decisions'),
    questions: normLog(logs.questions, 'questions'),
  };
  const dropped = sanitizeLinks(plan.rows);
  if (report) report.droppedLinks = dropped;
  return plan;
}

export function serializePlan(plan, pretty = true) {
  return JSON.stringify(plan, null, pretty ? 2 : 0);
}

export function parsePlanJSON(text, report) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('File is not valid JSON.');
  }
  if (data && data.plan && Array.isArray(data.plan.rows)) data = data.plan;
  return normalizePlan(data, report);
}

export function clonePlan(plan) {
  return JSON.parse(JSON.stringify(plan));
}

export function saveBaseline(plan) {
  for (const r of plan.rows) if (r.kind !== 'section') r.baseline = { start: r.start, finish: r.finish };
  plan.baselineSavedAt = nowStamp();
}

export function clearBaseline(plan) {
  for (const r of plan.rows) if (r.kind !== 'section') r.baseline = null;
  plan.baselineSavedAt = null;
}
