// Generic demo plan shown on first open. Dates are relative to "now" so the
// demo always has some finished, running and upcoming work.
import { createPlan, createTask, createSection, PALETTE } from './plan.js';
import { parseISO, toISO, today, mondayOf, workdaysInclusive } from '../schedule/calendar.js';
import { normalizeLevels, computeTree } from './tree.js';
import { autoSchedule, rollup } from '../schedule/engine.js';
import { markdownToHtml } from '../util/markdown.js';

const color = (name) => PALETTE.find((p) => p.name === name).color;

// [key, level, name, duration, preds "key:TYPE:lag", owner, extra]
const SPEC = [
  { section: 'Plan & prepare', color: 'Blue' },
  ['init', 0, 'Project initiation'],
  ['kick', 1, 'Kick-off meeting', 1, '', 'Project manager', { descHtml: markdownToHtml('Agree scope, roles and the **4-week timeline**.\n\n- Confirm sponsor\n- Share the plan link') }],
  ['crit', 1, 'Define success criteria', 2, 'kick', 'Project manager'],
  ['raci', 1, 'Stakeholder map & RACI', 2, 'crit:SS:1', 'Change manager'],
  ['ready', 0, 'Readiness assessment'],
  ['inv', 1, 'License & tenant inventory', 3, 'kick', 'IT operations', { tags: ['licensing'] }],
  ['sec', 1, 'Security & compliance review'],
  ['cls', 2, 'Data classification check', 3, 'inv', 'Security lead', { priority: 'High' }],
  ['acc', 2, 'Access & permissions audit', 4, 'cls:SS:1', 'Security lead', { priority: 'High' }],
  ['sign', 1, 'Readiness sign-off', 1, 'acc', 'Sponsor'],
  { section: 'Pilot', color: 'Teal' },
  ['pilot', 0, 'Pilot'],
  ['grp', 1, 'Select pilot group', 2, 'raci', 'Change manager'],
  ['env', 1, 'Configure pilot environment', 3, 'sign', 'IT operations'],
  ['ptrain', 1, 'Pilot training sessions', 2, 'grp,env', 'Trainer'],
  ['run', 1, 'Run pilot', 5, 'ptrain', 'Pilot group', { custom: [{ key: 'Pilot size', value: '25 users' }] }],
  ['survey', 1, 'Collect feedback survey', 3, 'run:FF:2', 'Change manager'],
  ['gonogo', 1, 'Go / no-go decision', 0, 'survey', 'Sponsor', { milestone: true }],
  { section: 'Rollout', color: 'Purple' },
  ['w1', 0, 'Wave 1 — early adopters'],
  ['lic1', 1, 'Enable licenses (wave 1)', 1, 'gonogo', 'IT operations'],
  ['onb1', 1, 'Onboarding sessions (wave 1)', 3, 'lic1', 'Trainer'],
  ['w2', 0, 'Wave 2 — all staff'],
  ['lic2', 1, 'Enable licenses (wave 2)', 1, 'lic1:FS:3', 'IT operations'],
  ['onb2', 1, 'Onboarding sessions (wave 2)', 3, 'lic2', 'Trainer'],
  ['care', 1, 'Hypercare support', 5, 'onb1:SS:1', 'Service desk'],
  { section: 'Communications & adoption', color: 'Amber' },
  ['comms', 0, 'Communications'],
  ['draft', 1, 'Draft launch announcement', 2, 'run:FS:-2', 'Comms lead'],
  ['pub', 1, 'Publish launch announcement', 1, 'gonogo', 'Comms lead'],
  ['champ', 1, 'Champions network kick-off', 1, 'lic1:SS:0', 'Change manager'],
  ['metrics', 0, 'Adoption metrics review', 2, 'onb2,care', 'Project manager'],
  ['close', 0, 'Project close', 0, 'metrics', 'Sponsor', { milestone: true }],
];

export function samplePlan(now = new Date()) {
  const t0 = today(now);
  const start = toISO(mondayOf(t0) - 7);
  const plan = createPlan({
    name: 'Sample: Software rollout',
    owner: 'Project manager',
    start,
    status: 'On track',
  });
  const ids = new Map();
  const links = [];
  for (const s of SPEC) {
    if (!Array.isArray(s)) {
      plan.rows.push(createSection(plan, { name: s.section, color: color(s.color) }));
      continue;
    }
    const [key, level, name, duration, preds, owner, extra] = s;
    const t = createTask(plan, { name, level, start, duration: duration == null ? 1 : duration, owner: owner || '', ...(extra || {}) });
    t.workstream = [...plan.rows].reverse().find((r) => r.kind === 'section').name;
    ids.set(key, t.id);
    if (preds) links.push([t, preds]);
    plan.rows.push(t);
  }
  for (const [t, preds] of links) {
    for (const p of preds.split(',')) {
      const [k, type = 'FS', lag = '0'] = p.split(':');
      t.preds.push({ id: ids.get(k), type, lag: +lag });
    }
  }
  normalizeLevels(plan.rows);
  const tree = computeTree(plan.rows);
  autoSchedule(plan.rows, tree);
  for (const t of tree.tasks) {
    if (tree.isSummary(t.id)) continue;
    const s = parseISO(t.start);
    const f = parseISO(t.finish);
    if (f < t0) {
      t.progress = 100;
      t.status = 'Done';
    } else if (s <= t0) {
      const total = Math.max(1, workdaysInclusive(s, f));
      t.progress = Math.min(90, Math.round((workdaysInclusive(s, t0 - 1) / total) * 100) || 10);
      t.status = 'In progress';
    }
  }
  const acc = plan.rows.find((r) => r.id === ids.get('acc'));
  if (acc.status === 'Not started') acc.status = 'Blocked';
  rollup(plan.rows, tree);
  plan.logs = {
    risks: [
      { id: 1, risk: 'Sensitive content over-shared through existing permissions', impact: 'High', likelihood: 'Medium', mitigation: 'Run access audit before wave 1; restrict broad sharing links', owner: 'Security lead', status: 'Mitigating' },
      { id: 2, risk: 'Low attendance at onboarding sessions', impact: 'Medium', likelihood: 'Medium', mitigation: 'Record sessions; champions follow up per team', owner: 'Change manager', status: 'Open' },
    ],
    decisions: [
      { id: 1, decision: 'Pilot with 25 users from three departments', by: 'Sponsor', date: start, status: 'Agreed' },
      { id: 2, decision: 'Wave 2 starts no earlier than 3 days after wave 1 licensing', by: 'Steering group', date: start, status: 'Proposed' },
    ],
    questions: [
      { id: 1, question: 'Which usage report will be used for the adoption review?', owner: 'IT operations', answer: '', status: 'Open' },
      { id: 2, question: 'Do contractors get licenses in wave 2?', owner: 'Sponsor', answer: 'No — revisit after close', status: 'Answered' },
    ],
  };
  return plan;
}
