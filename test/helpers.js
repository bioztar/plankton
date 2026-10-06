import { parseISO, finishFromDurationISO } from '../src/schedule/calendar.js';

export const d = (iso) => parseISO(iso);

let nextId = 1;
export function task(fields = {}) {
  const id = fields.id ?? nextId++;
  const t = { id, kind: 'task', level: 0, name: `T${id}`, start: '2026-10-05', duration: 1, progress: 0, milestone: false, preds: [], ...fields };
  if (!t.finish) t.finish = finishFromDurationISO(t.start, t.duration);
  return t;
}
export function section(fields = {}) {
  const id = fields.id ?? nextId++;
  return { id, kind: 'section', level: 0, name: `S${id}`, color: '#3b82f6', ...fields };
}
export const levels = (rows) => rows.map((r) => r.level);
export const names = (rows) => rows.map((r) => r.name);
