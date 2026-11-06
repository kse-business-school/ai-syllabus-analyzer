import { mockDocx } from './docx';

// Мок-бекенд за docs/api-v5.md для розробки UI без сервера (REACT_APP_USE_MOCKS=1 і /dev/cards).
// Два силабуси: трек 2 (Risk Management v.2 після парсингу) і трек 1 (з нуля, інтерв'юер), плюс v4 з needsRebuild.
// Клієнт має ті самі методи, що й api.chat / api.syllabus, і повертає { data } або кидає axios-подібну помилку.

const DELAY_MS = 350;
const wait = (ms = DELAY_MS) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));
let seq = 0;
const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq += 1)}`;

export const MOCK_IDS = { upload: 'mock-upload', scratch: 'mock-scratch', rebuild: 'mock-rebuild' };

export const MOCK_PROGRAMS = [
  { id: 'prog-mba', code: 'MBA', name: 'MBA', editions: [{ code: 'MBA27', label: 'MBA 2027' }, { code: 'MBA28', label: 'MBA 2028' }] },
  { id: 'prog-emba', code: 'EMBA', name: 'Executive MBA', editions: [] },
];

export const MOCK_OFFERINGS = [
  { _id: 'off-rm', programCode: 'MBA28', courseCode: 'RM.1', courseName: 'Risk Management', type: 'elective', lecturerId: { _id: 'u-lecturer', firstName: 'Olena', lastName: 'Khomenko' }, deadline: null },
  { _id: 'off-st', programCode: 'MBA28', courseCode: 'ST.1', courseName: 'Strategy', type: 'core', lecturerId: null, deadline: null },
];

// Форма відповіді GET /cabinet/plo-coverage
export const MOCK_PLO_COVERAGE = {
  courses: [
    { offeringId: 'off-rm', courseCode: 'RM.1', courseName: 'Risk Management', type: 'elective', syllabusId: 'mock-upload',
      cells: { 'ПРН1': { weight: 1, clos: [{ id: 'clo1', text: 'Apply risk management frameworks', coverage: 'full', assessments: [{ id: 'as3', name: 'Final project', weight: 40 }] }] } } },
    { offeringId: 'off-st', courseCode: 'ST.1', courseName: 'Strategy', type: 'core', syllabusId: null, cells: {} },
  ],
  outcomes: [
    { code: 'ПРН1', text: 'Strategic thinking in conditions of uncertainty', sum: 1, uncovered: false },
    { code: 'ПРН7', text: 'Digital technologies, data and AI', sum: 0, uncovered: true },
  ],
};

// TemplateSection[] (backend/fixtures/reference/template.sections.json)
export const MOCK_SECTIONS = [
  { key: 'at_a_glance', order: 1, docNumber: null, docTitle: 'At a Glance', title: 'At a Glance', required: true, nature: 'fixed' },
  { key: 'course_info', order: 2, docNumber: 1, docTitle: 'Summary', title: 'Course Title & Prerequisites', required: true, nature: 'fixed' },
  { key: 'short_description', order: 3, docNumber: 1, docTitle: 'Summary', title: 'Short Course Description', required: true, nature: 'free' },
  { key: 'course_objectives', order: 4, docNumber: 1, docTitle: 'Summary', title: 'Course Objectives', required: true, nature: 'free' },
  { key: 'learning_outcomes', order: 5, docNumber: 1, docTitle: 'Summary', title: 'Learning Outcomes', required: true, nature: 'free' },
  { key: 'connection_to_capstone', order: 6, docNumber: 1, docTitle: 'Summary', title: 'Connection to Capstone Project', required: true, nature: 'free' },
  { key: 'instructor', order: 7, docNumber: 2, docTitle: 'Instructor', title: 'Instructor', required: true, nature: 'fixed' },
  { key: 'schedule', order: 8, docNumber: 3, docTitle: 'Course Structure & Schedule', title: 'Course Structure & Schedule', required: true, nature: 'fixed' },
  { key: 'assessment', order: 9, docNumber: 4, docTitle: 'Assessment and Grading', title: 'Assessment and Grading', required: true, nature: 'fixed' },
  { key: 'materials', order: 10, docNumber: 5, docTitle: 'Course Materials', title: 'Course Materials', required: true, nature: 'free' },
  { key: 'policies', order: 11, docNumber: 6, docTitle: 'Course Policies', title: 'Course Policies', required: true, nature: 'fixed' },
];

// Довідник політик (скорочено з backend/fixtures/reference/policies.library.json)
const opt = (key, label, text) => ({ key, label, text });
export const MOCK_POLICY_LIBRARY = [
  {
    key: 'policy.attendance', order: 1, mode: 'library', title: 'Attendance',
    rationale: 'Students need to know how absences affect completion of the course.',
    options: [
      opt('attendance_std', 'Mandatory, 40% rule', 'Attendance is mandatory. A student who misses more than 40% of classes retakes the course.'),
      opt('attendance_strict', 'Mandatory, 25% rule', 'Attendance is mandatory. A student who misses more than 25% of classes retakes the course.'),
      opt('attendance_recorded', 'Recorded, not graded', 'Attendance is recorded but does not affect the grade. Students remain responsible for the material.'),
    ],
  },
  {
    key: 'policy.participation', order: 2, mode: 'library', title: 'Participation Credit',
    rationale: 'Separates being present from contributing.',
    options: [
      opt('participation_active', 'Active contribution expected', 'Attendance alone does not constitute participation. Active contribution is expected in every session.'),
      opt('participation_evidence', 'Credit for documented activity', 'Participation credit is based on documented in-class submissions, not on attendance.'),
      opt('participation_none', 'No participation component', 'This course has no separate participation component.'),
    ],
  },
  {
    key: 'policy.late', order: 3, mode: 'library', title: 'Late Submission',
    rationale: 'Deadlines are only meaningful when the consequence of missing them is known.',
    options: [
      opt('late_gbs', 'Reduced score, zero after 7 days', 'The deadlines in Assessment and Grading are final. Late submissions reduce the maximum score; after 7 days the work receives zero.'),
      opt('late_daily', '10% per day, five days maximum', 'Late submissions lose 10% of the maximum score for each calendar day after the deadline, for up to five days.'),
      opt('late_grace', 'One 48-hour grace period', 'Each student may submit one assignment up to 48 hours late without penalty and without explanation.'),
      opt('late_never', 'No late work accepted', 'The deadlines in Assessment and Grading are final. Work submitted after the deadline is not graded.'),
    ],
  },
  { key: 'policy.absence', order: 4, mode: 'locked', title: 'Excused Absence', text: 'A student who cannot attend for a valid reason notifies the programme office in advance.' },
  { key: 'policy.passing', order: 5, mode: 'locked', title: 'Passing Threshold', text: 'To pass the course a student must earn at least 60 out of 100 points.' },
  {
    key: 'policy.grading', order: 6, mode: 'library', title: 'Grading Detail',
    rationale: 'Tells students how much detail to expect about marking.',
    options: [
      opt('grading_weights', 'Component weights only', 'Assessment and Grading lists each assessed component with its weight and deadline.'),
      opt('grading_scheme', 'Weights plus a marking scheme', 'Each component has a weight, a deadline and a marking scheme shared before the work starts.'),
      opt('grading_rubric', 'Weights plus a rubric per component', 'Each component has a weight, a deadline and a rubric shared before the work starts.'),
    ],
  },
  {
    key: 'policy.integrity', order: 7, mode: 'library', title: 'Academic Integrity',
    rationale: 'Every KSE syllabus states the zero-tolerance policy.',
    options: [
      opt('integrity_std', 'Zero tolerance and the Code', 'KSE has a zero-tolerance policy towards plagiarism, self-plagiarism, fabrication and cheating.'),
      opt('integrity_team', 'Zero tolerance, plus team contribution', 'KSE has a zero-tolerance policy towards academic dishonesty. In team work every member is accountable for the whole submission.'),
    ],
  },
  {
    key: 'policy.ai_mode', order: 8, mode: 'library', title: 'Use of AI — Mode',
    rationale: 'Students must know whether and how AI tools may be used.',
    options: [
      opt('ai_mode_refer', 'Review the KSE AI policy', 'This course follows the KSE Artificial Intelligence Usage Policy.'),
      opt('ai_mode_prohibited', 'Not permitted', 'AI tools may not be used for assessed work in this course.'),
      opt('ai_mode_disclosure', 'Permitted with disclosure', 'AI tools may be used in preparing assignments only with a disclosure identifying the tool and its use.'),
    ],
  },
  { key: 'policy.fallback', order: 13, mode: 'locked', title: 'Fallback Clause', text: 'Situations not covered by these policies are resolved at the discretion of the instructor and the programme office.' },
];

const libraryOf = (key) => MOCK_POLICY_LIBRARY.find((p) => p.key === key);
const optionText = (key, optionKey) => libraryOf(key)?.options?.find((o) => o.key === optionKey)?.text || null;

function emptyPolicies() {
  return MOCK_POLICY_LIBRARY.map((b) => ({
    key: b.key,
    mode: b.mode,
    optionKey: null,
    candidateOptionKey: null,
    text: b.mode === 'locked' ? b.text : null,
    modified: false,
    source: b.mode === 'locked' ? 'fixture' : null,
  }));
}

// ── Стан треку 2: Risk Management v.2 (як backend/test/fixtures/state/riskManagement.js) ─────────────

function riskManagementState() {
  const policies = emptyPolicies().map((p) => {
    if (p.key === 'policy.attendance') {
      return { ...p, source: 'parsed', candidateOptionKey: 'attendance_std', text: 'Attendance is mandatory. If a student misses more than 40% of classes, they will be required to retake the course.' };
    }
    if (p.key === 'policy.late') {
      return { ...p, source: 'parsed', candidateOptionKey: 'late_gbs', text: 'Assignments submitted after the deadline may be subject to a penalty in the form of a reduction of the maximum possible score.' };
    }
    return p;
  });
  return {
    schemaVersion: 1,
    programCode: 'MBA28',
    track: 'upload',
    header: {
      courseTitle: 'Risk Management', courseCode: null, ects: 2, deliveryFormat: 'hybrid', courseKind: 'elective',
      term: { start: null, end: null },
      computed: { contactHours: 20, selfStudyHours: 14, assessmentTotal: 100, termFromSchedule: { start: '2026-04-25', end: '2026-05-09' } },
    },
    summary: {
      prerequisites: { text: 'None' },
      shortDescription: { text: "In today's fast-paced world, risk is everywhere: whether you're launching a startup or steering a Fortune 500 company. This course gives you the frameworks to see risk early and act on it." },
      objectives: [{ id: 'obj1', text: "In this course, you'll dive into the world of risk management, mastering the essential frameworks." }],
      capstone: { text: 'This course will help you anticipate what could derail your capstone project. It also gives you practical tools to identify, assess and mitigate risks.' },
    },
    outcomes: [
      { id: 'clo1', text: 'Apply risk management frameworks to develop comprehensive risk management strategies' },
      { id: 'clo2', text: 'Create a risk profile for your organization and identify key risks that could impact business objectives' },
      { id: 'clo3', text: 'Design and implement effective risk mitigation and response strategies' },
      { id: 'clo4', text: 'Establish internal controls that support effective risk management' },
    ],
    instructors: [{ id: 'ins1', name: 'Oleksii Gromyko', position: 'Associate professor in Project Management at KSE GBS', email: null, officeHours: null }],
    sessions: [
      { id: 's1', n: 1, topic: 'Overview of Risk Management: biases behind risk management failures', hours: 4, date: '2026-04-25' },
      { id: 's2', n: 2, topic: 'Risk Management tools and techniques: case study', hours: 4, date: '2026-04-25' },
      { id: 's3', n: 3, topic: 'Qualitative vs. quantitative risk assessment', hours: 4, date: '2026-04-26' },
      { id: 's4', n: 4, topic: 'Guest speaker session. Case study from Pepsico Ukraine', hours: 4, date: '2026-05-09' },
      { id: 's5', n: 5, topic: 'Written Exam', hours: 1, date: '2026-05-09' },
      { id: 's6', n: 6, topic: 'Designing Effective Internal Controls', hours: 3, date: '2026-05-09' },
    ],
    individualWork: [
      { id: 'iw1', title: 'Reading of the mandatory materials', hours: 2 },
      { id: 'iw2', title: 'Assignments and preparation for written exam', hours: 4 },
      { id: 'iw3', title: 'Final project preparation', hours: 8 },
    ],
    assessments: [
      { id: 'as1', name: 'Active class participation', weight: 35, deadline: 'Throughout the course', isParticipation: true },
      { id: 'as2', name: 'Written Exam', weight: 25, deadline: '2026-05-09' },
      { id: 'as3', name: 'Final project', weight: 40, deadline: '2026-05-23' },
    ],
    materials: {
      required: [{ id: 'm1', citation: 'HBR article "Managing Risks"' }],
      recommended: [{ id: 'm2', citation: 'COSO Internal Control Integrated Framework' }],
    },
    policies,
    sections: {},
  };
}

function scratchState() {
  return {
    schemaVersion: 1,
    programCode: 'MBA28',
    track: 'scratch',
    header: { courseTitle: 'Negotiations', courseCode: null, ects: null, courseKind: 'elective', term: { start: null, end: null }, computed: { contactHours: null, selfStudyHours: null, assessmentTotal: null } },
    summary: { prerequisites: { text: null }, shortDescription: { text: null }, objectives: [], capstone: { text: null } },
    outcomes: [],
    instructors: [{ id: 'ins1', name: 'Dev Instructor', position: null, email: 'dev@kse.org.ua', officeHours: null }],
    sessions: [],
    individualWork: [],
    assessments: [],
    materials: { required: [], recommended: [] },
    policies: emptyPolicies(),
    sections: {},
  };
}

// ── Рендер стану для правої панелі (спрощений services/syllabusState/render.js) ──────────────────────

const EMPTY = '—';
const CHOOSE = '[Choose an option]';
const val = (v) => (v === null || v === undefined || String(v).trim() === '' ? EMPTY : String(v));
const heading = (text) => ({ kind: 'heading', text });
const paragraph = (text) => ({ kind: 'paragraph', text });
const item = (text) => ({ kind: 'list-item', text });
const row = (a, b) => ({ kind: 'table-row', text: `${a} | ${b}` });

function policyText(p) {
  if (p.mode === 'locked') return p.text;
  if (['instructor_directed', 'fixture_edited'].includes(p.source) && p.text) return p.text;
  if (p.optionKey) return optionText(p.key, p.optionKey) || p.text || CHOOSE;
  if (p.text) return `${p.text} (from your file — choose an option or keep your text)`;
  return CHOOSE;
}

const RENDERERS = {
  at_a_glance: (s) => [
    row('Program', s.programCode),
    row('Course type', val(s.header.courseKind)),
    row('ECTS', val(s.header.ects)),
    row('Contact hours', val(s.header.computed.contactHours)),
    row('Self-study hours', val(s.header.computed.selfStudyHours)),
    row('Assessment total', s.header.computed.assessmentTotal ? `${s.header.computed.assessmentTotal}%` : EMPTY),
  ],
  course_info: (s) => [paragraph(`Course title: ${val(s.header.courseTitle)}`), paragraph(`Prerequisites: ${val(s.summary.prerequisites.text)}`)],
  short_description: (s) => (s.summary.shortDescription.text ? [paragraph(s.summary.shortDescription.text)] : []),
  course_objectives: (s) => s.summary.objectives.map((o) => item(o.text)),
  learning_outcomes: (s) => s.outcomes.map((o, i) => item(`CLO${i + 1}. ${o.text}`)),
  connection_to_capstone: (s) => (s.summary.capstone.text ? [paragraph(s.summary.capstone.text)] : []),
  instructor: (s) => s.instructors.flatMap((i) => [
    paragraph(i.name),
    paragraph(`Position: ${val(i.position)}`),
    paragraph(`Email: ${val(i.email)}`),
    paragraph(`Office hours: ${val(i.officeHours)}`),
  ]),
  schedule: (s) => [
    ...s.sessions.map((x) => item(`${x.n}. ${x.topic} — ${x.hours} h`)),
    ...(s.individualWork.length ? [heading('Individual work'), ...s.individualWork.map((w) => item(`${w.title} — ${w.hours} h`))] : []),
  ],
  assessment: (s) => s.assessments.map((a) => row(a.name, `${a.weight}% · ${val(a.deadline)}`)),
  materials: (s) => [
    ...(s.materials.required.length ? [heading('Required'), ...s.materials.required.map((m) => item(m.citation))] : []),
    ...(s.materials.recommended.length ? [heading('Recommended'), ...s.materials.recommended.map((m) => item(m.citation))] : []),
  ],
  policies: (s) => s.policies.flatMap((p) => [heading(libraryOf(p.key)?.title || p.key), paragraph(policyText(p))]),
};

function renderState(state) {
  return MOCK_SECTIONS.map((sec) => ({
    key: sec.key,
    docNumber: sec.docNumber,
    title: sec.title,
    blocks: RENDERERS[sec.key](state),
  }));
}

// Пословний diff одного блоку (найдовша спільна підпослідовність) — як backend/services/syllabusState/diff.js
function diffWords(a, b) {
  const x = a.split(/(\s+)/);
  const y = b.split(/(\s+)/);
  const dp = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const parts = [];
  const push = (type, text) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { push('eq', x[i]); i += 1; j += 1; } else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', x[i]); i += 1; } else { push('ins', y[j]); j += 1; }
  }
  while (i < x.length) { push('del', x[i]); i += 1; }
  while (j < y.length) { push('ins', y[j]); j += 1; }
  return parts.filter((p) => p.text);
}

function diffSections(baseline, current) {
  return current.map((sec) => {
    const before = baseline.find((b) => b.key === sec.key)?.blocks || [];
    const max = Math.max(before.length, sec.blocks.length);
    const blocks = [];
    for (let k = 0; k < max; k += 1) {
      const b = before[k];
      const a = sec.blocks[k];
      if (a && b && a.text === b.text) blocks.push({ ...a, parts: [{ type: 'eq', text: a.text }] });
      else if (a && b && a.kind === b.kind) blocks.push({ ...a, parts: diffWords(b.text, a.text) });
      else {
        if (b) blocks.push({ ...b, parts: [{ type: 'del', text: b.text }] });
        if (a) blocks.push({ ...a, parts: [{ type: 'ins', text: a.text }] });
      }
    }
    return { ...sec, blocks };
  });
}

// ── Перевірки й Readiness (спрощено) ────────────────────────────────────────────────────────────────

const decided = (p) => p.mode === 'locked' || !!p.optionKey || ['instructor_directed', 'fixture_edited'].includes(p.source);

function sectionGaps(key, s) {
  const gaps = [];
  switch (key) {
    case 'at_a_glance': if (!s.header.ects) gaps.push('ECTS credits'); break;
    case 'course_info': if (!s.header.courseTitle) gaps.push('Course title'); if (!s.summary.prerequisites.text) gaps.push('Prerequisites'); break;
    case 'short_description': if (!s.summary.shortDescription.text) gaps.push('Short description'); break;
    case 'course_objectives': if (!s.summary.objectives.length) gaps.push('At least one objective'); break;
    case 'learning_outcomes': if (s.outcomes.length < 3) gaps.push('At least three learning outcomes'); break;
    case 'connection_to_capstone': if (!s.summary.capstone.text) gaps.push('Connection to the capstone'); break;
    case 'instructor': {
      const i = s.instructors[0] || {};
      if (!i.email) gaps.push('Instructor email');
      if (!i.officeHours) gaps.push('Office hours');
      break;
    }
    case 'schedule': if (!s.sessions.length) gaps.push('Sessions with hours'); break;
    case 'assessment': if (s.assessments.length < 2) gaps.push('At least two assessed components'); break;
    case 'materials': if (!s.materials.required.length) gaps.push('At least one required reading'); break;
    case 'policies': {
      const open = s.policies.filter((p) => !decided(p)).length;
      if (open) gaps.push(`${open} policy block${open === 1 ? '' : 's'} without a choice`);
      break;
    }
    default:
  }
  return gaps;
}

function sectionHasContent(key, s) {
  const blocks = RENDERERS[key](s);
  if (key === 'policies') return s.policies.some((p) => p.mode !== 'locked' && (decided(p) || p.text));
  if (key === 'at_a_glance') return !!s.header.ects;
  return blocks.some((b) => b.text && !b.text.endsWith(EMPTY));
}

function runChecks(s) {
  const checks = [];
  const participation = s.assessments.find((a) => a.isParticipation);
  if (participation) {
    checks.push({
      id: 'assessment.participationCap', severity: 'warning', section: 'assessment', path: 'assessments',
      message: `Participation is ${participation.weight}% of the grade; the recommended cap is 30%.`,
      details: { rule: 'assessment.participationCap' }, passed: participation.weight <= 30,
    });
  }
  const self = s.individualWork.reduce((sum, w) => sum + Number(w.hours || 0), 0);
  const contact = s.sessions.reduce((sum, x) => sum + Number(x.hours || 0), 0);
  if (contact) {
    checks.push({
      id: 'workload.selfStudy', severity: 'warning', section: 'schedule', path: 'individualWork',
      message: `Self-study is ${self} h, below 50% of contact hours (${contact} h).`,
      details: { rule: 'workload.selfStudy' }, passed: self * 2 >= contact,
    });
  }
  if (s.outcomes.length) {
    checks.push({
      id: 'plo.coverage', severity: 'info', section: 'learning_outcomes', path: 'outcomes',
      message: 'No learning outcome is mapped to a programme learning outcome yet (elective: advisory only).',
      details: { rule: 'plo.coverage' }, passed: false,
    });
  }
  const instructor = s.instructors[0];
  if (instructor) {
    checks.push({
      id: 'instructor.contact', severity: 'medium', section: 'instructor', path: 'instructors',
      message: 'Instructor email or office hours are missing.',
      details: { rule: 'instructor.contact' }, passed: !!(instructor.email && instructor.officeHours),
    });
  }
  const open = s.policies.filter((p) => !decided(p)).length;
  checks.push({
    id: 'policies.decided', severity: 'high', section: 'policies', path: 'policies',
    message: `${open} policy block${open === 1 ? '' : 's'} still need a choice.`,
    details: { rule: 'policies.decided' }, passed: open === 0,
  });
  return checks;
}

function computeReadiness(s, checks, suggestions, skipped) {
  const sections = {};
  let approvedCount = 0;
  MOCK_SECTIONS.forEach(({ key }) => {
    const gaps = sectionGaps(key, s);
    const complete = gaps.length === 0;
    const approved = complete && !!s.sections[key]?.approved;
    if (approved) approvedCount += 1;
    const failed = checks.filter((c) => c.section === key && !c.passed);
    sections[key] = {
      status: approved ? 'approved' : sectionHasContent(key, s) ? 'draft' : 'empty',
      complete,
      approved,
      gaps,
      checks: {
        critical: failed.filter((c) => c.severity === 'critical').length,
        high: failed.filter((c) => c.severity === 'high').length,
        other: failed.filter((c) => !['critical', 'high'].includes(c.severity)).length,
      },
      // Поза контрактом: пропущені слоти розділу (див. звіт)
      skipped: Object.entries(skipped).filter(([, sec]) => sec === key).map(([slot]) => slot),
    };
  });
  const required = MOCK_SECTIONS.filter((x) => x.required).length;
  return {
    score: Math.round((approvedCount / required) * 100),
    sections,
    counts: { approved: approvedCount, required, pendingSuggestions: suggestions.filter((x) => x.status === 'pending').length },
  };
}

// ── Пропозиції треку 2 ──────────────────────────────────────────────────────────────────────────────

export const renderTemplate = (template, values) => String(template || '')
  .replace(/\{\{(\w+)\}\}/g, (m, id) => values.find((v) => v.id === id)?.value ?? m);

const base = (over) => ({
  origin: 'reviewer', checkId: null, criterionId: null, kind: 'edit', description: '', rationale: null,
  options: [], question: null, answer: null, applicable: true, stale: false, status: 'pending', selectedOptionId: null,
  decisionReason: null, rejectTag: null, decisionHistory: [], versions: [], sources: [],
  ...over,
  requiresReason: ['critical', 'high'].includes(over.severity),
});

function withDraft(s) {
  if (!s.draft?.template) return s;
  return { ...s, draft: { ...s.draft, value: renderTemplate(s.draft.template, s.draft.proposedValues) } };
}

function trackTwoSuggestions() {
  return [
    withDraft(base({
      id: 'sg-weights', origin: 'check', checkId: 'assessment.participationCap', section: 'assessment', severity: 'warning', order: 1,
      title: 'Bring participation within the 30% cap',
      description: 'Participation is 35% of the grade. I moved 5 points to the final project so the total stays at 100%.',
      target: { section: 'assessment', path: 'assessments[]' },
      before: 'Active class participation — 35% · Written Exam — 25% · Final project — 40%',
      draft: {
        template: 'Active class participation — {{v1}} · Written Exam — 25% · Final project — {{v2}}',
        proposedValues: [
          { id: 'v1', label: 'Participation weight', value: '30%', confirmed: false },
          { id: 'v2', label: 'Final project weight', value: '45%', confirmed: false },
        ],
        basisHash: 'h-as',
      },
    })),
    withDraft(base({
      id: 'sg-selfstudy', origin: 'check', checkId: 'workload.selfStudy', section: 'schedule', severity: 'warning', order: 2,
      title: 'Add self-study for the case sessions',
      description: 'Self-study is 14 h, below the recommended workload for 20 contact hours. Add preparation for the case sessions.',
      target: { section: 'schedule', path: 'individualWork[]' },
      before: null,
      draft: {
        template: 'Case preparation before sessions 2 and 4 — {{v1}}',
        proposedValues: [{ id: 'v1', label: 'Hours', value: '6 hours', confirmed: false }],
        basisHash: 'h-iw',
      },
    })),
    base({
      id: 'sg-description', section: 'short_description', severity: 'medium', order: 3,
      title: 'Make the description specific to the course',
      description: 'The opening is generic. This version says what students will do and for whom the course is.',
      target: { section: 'short_description', path: 'summary.shortDescription' },
      before: "In today's fast-paced world, risk is everywhere: whether you're launching a startup or steering a Fortune 500 company. This course gives you the frameworks to see risk early and act on it.",
      draft: {
        value: 'Managers who launch or run projects learn to see risk early and act on it. Through Ukrainian and international cases, students build a risk profile for a real organisation and design controls that keep it on track.',
        template: null,
        proposedValues: [],
        basisHash: 'h-desc',
      },
    }),
    base({
      id: 'sg-office', origin: 'check', checkId: 'instructor.contact', kind: 'question', section: 'instructor', severity: 'medium', order: 4,
      title: 'Instructor contact details',
      description: 'Students need an email and office hours to reach you.',
      target: { section: 'instructor', path: 'instructors[ins1]' },
      question: 'What email should students use, and when are your office hours?',
    }),
    base({
      id: 'sg-objectives', kind: 'choice', section: 'course_objectives', severity: 'medium', order: 5,
      title: 'Course objectives: pick a version',
      description: 'The current objective describes the course, not what students will be able to do.',
      target: { section: 'course_objectives', path: 'summary.objectives[]' },
      options: [
        { id: 'o1', label: 'Three objectives', value: 'Introduce the main risk management frameworks.\nTrain students to assess risks qualitatively and quantitatively.\nShow how internal controls keep a strategy on track.' },
        { id: 'o2', label: 'One broad objective', value: 'Give managers a working toolkit to identify, assess and respond to organisational risk.' },
        { id: 'keep', label: 'Keep my text', value: null },
      ],
    }),
  ];
}

const TRACK_TWO_QUEUE = ['sg-weights', 'sg-selfstudy', 'sg-description', 'sg-office', 'sg-objectives',
  'policy:policy.attendance', 'policy:policy.participation', 'policy:policy.late', 'policy:policy.grading',
  'policy:policy.integrity', 'policy:policy.ai_mode'];

// Як застосувати прийняту пропозицію до стану (у справжньому бекенді — target.path + store.mutate)
const APPLY = {
  'sg-weights': (s, sg) => {
    const pv = sg.draft.proposedValues;
    const num = (id) => parseInt(pv.find((v) => v.id === id).value, 10);
    s.assessments = s.assessments.map((a) => (a.id === 'as1' ? { ...a, weight: num('v1') } : a.id === 'as3' ? { ...a, weight: num('v2') } : a));
  },
  'sg-selfstudy': (s, sg) => {
    s.individualWork.push({ id: 'iw4', title: 'Case preparation before sessions 2 and 4', hours: parseInt(sg.draft.proposedValues[0].value, 10) || 0 });
  },
  'sg-description': (s, sg) => { s.summary.shortDescription.text = sg.draft.value; },
  'sg-objectives': (s, sg, optionId) => {
    const option = sg.options.find((o) => o.id === optionId);
    if (option?.value) s.summary.objectives = option.value.split('\n').map((text, i) => ({ id: `obj${i + 1}`, text }));
  },
};

const SLOT_SECTION = {
  'summary.prerequisites': 'course_info',
  'summary.shortDescription': 'short_description',
  sessions: 'schedule',
  assessments: 'assessment',
  'summary.capstone': 'connection_to_capstone',
};

// Питання інтерв'юера треку 1 (одне за раз)
const INTERVIEW = [
  { slotKey: 'summary.prerequisites', question: 'Does the course have prerequisites? Name the courses or skills students need, or say "none".', why: 'Students check prerequisites before they enrol, and the programme office uses them to plan the sequence of courses.' },
  { slotKey: 'summary.shortDescription', question: 'In two or three sentences: what is the course about, and who is it for?', why: 'This is the first paragraph students read in the course catalogue.' },
  { slotKey: 'sessions', question: 'How many sessions are there, and how many academic hours does each one take?', why: 'Contact hours and the workload checks are computed from the schedule.' },
  { slotKey: 'assessments', question: 'How will students be assessed? List the components and their weights.', why: 'The weights must add up to 100% and every component needs a deadline.' },
];

// ── Сховище мок-силабусів ───────────────────────────────────────────────────────────────────────────

function textMessage(role, content) {
  return { _id: nextId('m'), role, kind: 'text', content, payload: null, relatedSuggestionId: null, createdAt: new Date().toISOString() };
}
function kindMessage(kind, payload, extra = {}) {
  return { _id: nextId('m'), role: 'ai', kind, content: '', payload, relatedSuggestionId: null, createdAt: new Date().toISOString(), ...extra };
}

function createRecord(id) {
  if (id === MOCK_IDS.scratch) {
    const state = scratchState();
    return {
      syllabus: { id, title: 'Negotiations', status: 'in_progress', track: 'scratch', programCode: 'MBA28', canMutate: true, needsRebuild: false },
      state, baseline: clone(state), revision: 1, suggestions: [], conversation: null, messages: [],
      queue: [], interviewStep: 0, skipped: {}, downloads: 0, currentSlotKey: null,
    };
  }
  const state = riskManagementState();
  return {
    syllabus: {
      id, title: id === MOCK_IDS.rebuild ? 'Corporate Finance (v4)' : 'Risk Management v.2', status: 'in_progress', track: 'upload',
      programCode: 'MBA28', canMutate: true, needsRebuild: id === MOCK_IDS.rebuild,
    },
    state, baseline: clone(state), revision: 1, suggestions: trackTwoSuggestions(), conversation: null, messages: [],
    queue: [...TRACK_TWO_QUEUE], interviewStep: 0, skipped: {}, downloads: 0, currentSlotKey: null,
  };
}

function toView(rec) {
  const checks = runChecks(rec.state);
  return clone({
    syllabus: rec.syllabus,
    state: rec.state,
    revision: rec.revision,
    sections: MOCK_SECTIONS,
    readiness: computeReadiness(rec.state, checks, rec.suggestions, rec.skipped),
    checks,
    suggestions: rec.suggestions.map(({ _snapshot, ...s }) => s),
    conversation: rec.conversation ? { ...rec.conversation, currentSlotKey: rec.currentSlotKey, skippedSlots: Object.keys(rec.skipped) } : null,
    messages: rec.messages,
  });
}

function httpErr(status, code, message, details = {}) {
  const err = new Error(message);
  err.response = { status, data: { message, code, ...details } };
  return err;
}

export function createMockClient() {
  const records = new Map();
  const rec = (id) => {
    if (!records.has(id)) {
      if (!Object.values(MOCK_IDS).includes(id) && !String(id).startsWith('mock-')) throw httpErr(404, 'NOT_FOUND', 'Syllabus not found');
      records.set(id, createRecord(String(id).startsWith('mock-new-scratch') ? MOCK_IDS.scratch : id));
      if (String(id).startsWith('mock-new')) records.get(id).syllabus.id = id;
    }
    return records.get(id);
  };
  const respond = async (id, fn) => {
    await wait();
    const r = rec(id);
    const extra = fn ? fn(r) : undefined;
    return { data: { ...toView(r), ...(extra || {}) } };
  };
  const mutation = (r) => {
    if (r.syllabus.needsRebuild) throw httpErr(409, 'NEEDS_REBUILD', 'Rebuild required');
  };
  const bumpState = (r, sectionKey, fn) => {
    fn(r.state);
    r.revision += 1;
    if (sectionKey && r.state.sections[sectionKey]) r.state.sections[sectionKey] = { ...r.state.sections[sectionKey], approved: false };
  };
  const findSuggestion = (r, sid) => {
    const s = r.suggestions.find((x) => x.id === sid);
    if (!s) throw httpErr(404, 'NOT_FOUND', 'Suggestion not found');
    return s;
  };

  // Наступний крок розмови: верхній елемент черги (трек 2) або наступне питання (трек 1)
  const postNext = (r) => {
    if (r.syllabus.track === 'scratch') {
      const q = INTERVIEW[r.interviewStep];
      if (q) {
        r.currentSlotKey = q.slotKey;
        r.messages.push(kindMessage('question', { ...q, section: SLOT_SECTION[q.slotKey] }));
      } else {
        r.currentSlotKey = null;
        r.messages.push(textMessage('ai', 'That covers the interview for now. Check the sections on the left, approve what looks right, and download the .docx whenever you like.'));
      }
      return;
    }
    while (r.queue.length) {
      const next = r.queue.shift();
      if (next.startsWith('policy:')) {
        const key = next.slice(7);
        const p = r.state.policies.find((x) => x.key === key);
        if (p && !decided(p)) {
          r.messages.push(kindMessage('policy-choice', { policyKey: key }));
          return;
        }
      } else {
        const s = r.suggestions.find((x) => x.id === next);
        if (s && s.status === 'pending') {
          r.messages.push(kindMessage('suggestion', null, { relatedSuggestionId: s.id }));
          return;
        }
      }
    }
    r.messages.push(textMessage('ai', 'No more open items. Approve the remaining sections on the left or download the .docx.'));
  };

  const approveAllCandidates = (r) => {
    const checks = runChecks(r.state);
    return MOCK_SECTIONS.filter(({ key }) => sectionGaps(key, r.state).length === 0
      && !checks.some((c) => c.section === key && !c.passed && c.severity !== 'info')
      && !r.suggestions.some((s) => s.section === key && s.status === 'pending')).map((x) => x.key);
  };

  const chat = {
    get: (id) => respond(id),
    start: (id) => respond(id, (r) => {
      if (r.conversation) return;
      mutation(r);
      r.conversation = { id: `conv-${id}`, status: 'active', currentSlotKey: null };
      if (r.syllabus.track === 'scratch') {
        r.messages.push(textMessage('ai', `Hi! Let’s build the syllabus for **${r.syllabus.title}** together. I will ask one question at a time; you can skip any of them and come back later. The document on the right fills in as we go.`));
        postNext(r);
        return;
      }
      const pendingCount = r.suggestions.length;
      const policyCount = r.state.policies.filter((p) => !decided(p)).length;
      r.messages.push(textMessage('ai', `Here's what I found in **${r.syllabus.title}**: the file maps onto 5 of 8 sections of the KSE template. ${pendingCount} items need your decision, and ${policyCount} policy blocks need a choice from the KSE library.`));
      const sections = approveAllCandidates(r);
      if (sections.length) {
        r.messages.push(kindMessage('approve-all', { sections }));
      } else {
        postNext(r);
      }
    }),
    document: async (id, { diff = false } = {}) => {
      await wait(150);
      const r = rec(id);
      const current = renderState(r.state);
      return { data: { sections: diff ? diffSections(renderState(r.baseline), current) : current } };
    },
    approveSection: (id, key) => respond(id, (r) => {
      mutation(r);
      const gaps = sectionGaps(key, r.state);
      if (gaps.length) throw httpErr(409, 'SECTION_INCOMPLETE', 'Section is incomplete', { gaps });
      r.state.sections[key] = { approved: true, approvedAt: new Date().toISOString(), approvedRevision: r.revision };
      r.revision += 1;
    }),
    unapproveSection: (id, key) => respond(id, (r) => {
      mutation(r);
      r.state.sections[key] = { ...(r.state.sections[key] || {}), approved: false };
      r.revision += 1;
    }),
    setLanguage: (id, language) => respond(id, (r) => {
      mutation(r);
      r.state.language = language;
      r.revision += 1;
    }),
    approveAll: (id, { sections } = {}) => respond(id, (r) => {
      mutation(r);
      const candidates = approveAllCandidates(r);
      const keys = sections?.length ? sections : MOCK_SECTIONS.map((x) => x.key);
      const approved = [];
      const skipped = [];
      keys.forEach((key) => {
        if (r.state.sections[key]?.approved) return;
        if (candidates.includes(key)) {
          r.state.sections[key] = { approved: true, approvedAt: new Date().toISOString(), approvedRevision: r.revision };
          approved.push(key);
        } else {
          const gaps = sectionGaps(key, r.state);
          skipped.push({ key, reason: gaps.length ? `Missing: ${gaps.join('; ')}` : 'Has open checks or drafts' });
        }
      });
      if (approved.length) r.revision += 1;
      postNext(r);
      return { approved, skipped };
    }),
    choosePolicy: (id, key, body) => respond(id, (r) => {
      mutation(r);
      const p = r.state.policies.find((x) => x.key === key);
      if (!p) throw httpErr(404, 'NOT_FOUND', 'Policy not found');
      if (p.mode === 'locked') throw httpErr(409, 'LOCKED', 'Locked');
      if (body?.writeOwn) {
        r.currentSlotKey = key;
        r.messages.push(textMessage('user', 'Write my own'));
        r.messages.push(kindMessage('question', {
          slotKey: key,
          section: 'policies',
          question: `Tell me how the ${libraryOf(key)?.title || 'policy'} rule should work in your course. I will turn it into a policy text for you to confirm.`,
          why: 'Policy text comes either from the KSE library or from your own words. I never write a policy on my own.',
        }));
        return;
      }
      if (body?.keepText && p.text) {
        bumpState(r, 'policies', () => Object.assign(p, { optionKey: null, source: 'instructor_directed', modified: true }));
        postNext(r);
        return;
      }
      const option = libraryOf(key)?.options?.find((o) => o.key === body?.optionKey);
      if (!option) throw httpErr(400, 'INVALID_OPTION', 'Unknown option');
      bumpState(r, 'policies', () => Object.assign(p, { optionKey: option.key, text: option.text, source: 'fixture', modified: false }));
      r.messages.push(textMessage('user', option.label));
      postNext(r);
    }),
    accept: (id, sid, body = {}) => respond(id, (r) => {
      mutation(r);
      const s = findSuggestion(r, sid);
      if (s.status !== 'pending') throw httpErr(409, 'NOT_PENDING', 'Not pending');
      if (body.expectedRevision !== undefined && body.expectedRevision !== r.revision) {
        throw httpErr(409, 'STATE_CONFLICT', 'State changed', { revision: r.revision });
      }
      if (s.stale) throw httpErr(409, 'STALE_DRAFT', 'Stale draft');
      if (s.draft?.proposedValues?.some((v) => !v.confirmed)) {
        throw httpErr(409, 'UNCONFIRMED_VALUES', 'Unconfirmed values', { values: s.draft.proposedValues.filter((v) => !v.confirmed).map((v) => v.id) });
      }
      if (s.kind === 'question') throw httpErr(409, 'ANSWER_REQUIRED', 'Answer the question first');
      if (s.kind === 'choice' && !body.optionId) throw httpErr(400, 'OPTION_REQUIRED', 'optionId is required');
      const apply = APPLY[s.id] || (s.target?.path?.startsWith('policies{') ? (st) => {
        const key = s.target.path.slice(9, -1);
        const p = st.policies.find((x) => x.key === key);
        Object.assign(p, { text: s.draft.value, source: 'instructor_directed', modified: false, optionKey: null });
      } : null);
      if (s.applicable !== false && apply) {
        s.before = s.before ?? null;
        s._snapshot = clone(r.state);
        bumpState(r, s.section, (st) => apply(st, s, body.optionId));
      }
      s.acceptedRevision = r.revision;
      Object.assign(s, { status: 'accepted', selectedOptionId: body.optionId || null });
      s.decisionHistory.push({ action: 'accepted', at: new Date().toISOString(), optionId: body.optionId || null });
      r.messages.push(textMessage('ai', s.applicable === false ? 'Noted.' : `Done: **${s.title}** is in the document.`));
      postNext(r);
    }),
    setValues: (id, sid, values) => respond(id, (r) => {
      mutation(r);
      const s = findSuggestion(r, sid);
      if (s.status !== 'pending' || !s.draft) throw httpErr(409, 'NOT_PENDING', 'Not pending');
      s.draft.proposedValues = s.draft.proposedValues.map((v) => {
        const next = values.find((x) => x.id === v.id);
        return next ? { ...v, value: String(next.value), confirmed: next.confirmed !== false } : v;
      });
      if (s.draft.template) s.draft.value = renderTemplate(s.draft.template, s.draft.proposedValues);
      s.decisionHistory.push({ action: 'values', at: new Date().toISOString() });
    }),
    reject: (id, sid, body = {}) => respond(id, (r) => {
      mutation(r);
      const s = findSuggestion(r, sid);
      if (s.status !== 'pending') throw httpErr(409, 'NOT_PENDING', 'Not pending');
      if (s.requiresReason && !String(body.reason || '').trim()) throw httpErr(400, 'REASON_REQUIRED', 'Reason required');
      Object.assign(s, { status: 'rejected', decisionReason: body.reason || null, rejectTag: body.rejectTag || null });
      r.messages.push(textMessage('ai', 'Okay, I left that part as it is.'));
      postNext(r);
    }),
    refine: (id, sid, { feedback } = {}) => respond(id, (r) => {
      mutation(r);
      const s = findSuggestion(r, sid);
      if (s.status !== 'pending') throw httpErr(409, 'NOT_PENDING', 'Not pending');
      s.versions.push({ kind: s.kind, title: s.title, draft: clone(s.draft), feedback, at: new Date().toISOString() });
      if (s.draft && !s.draft.template) s.draft.value = `${s.draft.value.split('. ')[0]}.`;
      s.stale = false;
      r.messages.push(textMessage('user', feedback || 'Reword'));
      r.messages.push(textMessage('ai', 'Here is a new version.'));
      r.messages.push(kindMessage('suggestion', null, { relatedSuggestionId: s.id }));
    }),
    answer: (id, sid, answer) => respond(id, (r) => {
      mutation(r);
      const s = findSuggestion(r, sid);
      if (s.kind !== 'question') throw httpErr(409, 'NOT_QUESTION', 'Not a question');
      r.messages.push(textMessage('user', answer));
      s.versions.push({ kind: 'question', question: s.question, answer, at: new Date().toISOString() });
      Object.assign(s, {
        kind: 'edit', answer,
        before: 'Email: — · Office hours: —',
        draft: {
          template: `Email: ${answer.match(/\S+@\S+/)?.[0] || '—'} · Office hours: {{v1}}`,
          proposedValues: [{ id: 'v1', label: 'Office hours', value: 'Wednesdays 18:00–19:00', confirmed: false }],
          basisHash: 'h-ins',
        },
      });
      Object.assign(s, withDraft(s));
      APPLY[s.id] = (st, sg) => {
        const [email] = sg.draft.value.replace('Email: ', '').split(' · ');
        st.instructors[0] = { ...st.instructors[0], email, officeHours: sg.draft.proposedValues[0].value };
      };
      r.messages.push(kindMessage('suggestion', null, { relatedSuggestionId: s.id }));
    }),
    reopen: (id, sid) => respond(id, (r) => {
      mutation(r);
      const s = findSuggestion(r, sid);
      if (s.status === 'pending') throw httpErr(409, 'NOT_PENDING', 'Already pending');
      if (s.status === 'accepted' && s._snapshot) {
        if (r.revision !== s.acceptedRevision) throw httpErr(409, 'REOPEN_CONFLICT', 'The document changed after this confirmation');
        r.state = s._snapshot;
        r.revision += 1;
        delete s._snapshot;
      }
      Object.assign(s, { status: 'pending', selectedOptionId: null, decisionReason: null, rejectTag: null });
      r.messages.push(kindMessage('suggestion', null, { relatedSuggestionId: s.id }));
    }),
    sendMessage: (id, text) => respond(id, (r) => {
      mutation(r);
      r.messages.push(textMessage('user', text));
      const slot = r.currentSlotKey;
      if (slot?.startsWith('policy.')) {
        // «Write my own»: чернетка лише зі слів викладача, без самовільного запису в документ.
        const sg = withDraft(base({
          id: nextId('sg'), origin: 'orchestrator', section: 'policies', severity: 'medium', order: 50,
          title: `${libraryOf(slot)?.title || 'Policy'}: your rule`,
          description: 'Written from your words. Confirm to add this policy to the document.',
          target: { section: 'policies', path: `policies{${slot}}` },
          before: null,
          draft: {
            value: text,
            template: null,
            proposedValues: [],
            basisHash: 'h-pol',
          },
        }));
        r.suggestions.push(sg);
        r.currentSlotKey = null;
        r.messages.push(kindMessage('suggestion', null, { relatedSuggestionId: sg.id }));
        return;
      }
      if (r.syllabus.track === 'scratch' && slot) {
        const step = INTERVIEW[r.interviewStep];
        r.interviewStep += 1;
        if (step.slotKey === 'summary.shortDescription') {
          const sg = withDraft(base({
            id: nextId('sg'), origin: 'interviewer', section: 'short_description', severity: 'medium', order: 10,
            title: 'Short course description',
            description: 'I turned your answer into catalogue style. Check the highlighted value.',
            target: { section: 'short_description', path: 'summary.shortDescription' },
            before: null,
            draft: {
              template: `${text.trim().replace(/\.?$/, '.')} Students practise in {{v1}} live negotiation simulations and get feedback after each one.`,
              proposedValues: [{ id: 'v1', label: 'Number of simulations', value: 'six', confirmed: false }],
              basisHash: 'h-empty',
            },
          }));
          APPLY[sg.id] = (st, x) => { st.summary.shortDescription.text = x.draft.value; };
          r.suggestions.push(sg);
          r.messages.push(kindMessage('suggestion', null, { relatedSuggestionId: sg.id }));
          return;
        }
        if (step.slotKey === 'sessions' || step.slotKey === 'assessments') {
          r.messages.push(textMessage('ai', 'Thanks. This mock leaves those details for the live assistant; you can continue with the next question.'));
        } else {
          bumpState(r, SLOT_SECTION[step.slotKey], (st) => {
            if (step.slotKey === 'summary.prerequisites') st.summary.prerequisites.text = text;
          });
        }
        r.messages.push(textMessage('ai', 'Got it, I added that to the document.'));
        postNext(r);
        return;
      }
      r.messages.push(textMessage('ai', 'Thanks. In this mock I only answer the current question or card, but the real assistant will reply here.'));
    }),
    skip: (id, slotKey) => respond(id, (r) => {
      mutation(r);
      r.skipped[slotKey] = SLOT_SECTION[slotKey] || (slotKey.startsWith('policy.') ? 'policies' : null);
      r.messages.push(textMessage('user', 'Skip'));
      if (r.syllabus.track === 'scratch' && INTERVIEW[r.interviewStep]?.slotKey === slotKey) r.interviewStep += 1;
      r.currentSlotKey = null;
      postNext(r);
    }),
    downloadDocx: async (id) => {
      await wait();
      const r = rec(id);
      r.downloads += 1;
      return {
        data: mockDocx(renderState(r.state)),
        headers: { 'content-disposition': `attachment; filename="${r.syllabus.title.replace(/\s+/g, '_')}_mock.docx"` },
      };
    },
  };

  const syllabus = {
    create: async ({ title, programCode, courseCode }) => {
      await wait();
      const id = `mock-new-scratch-${(seq += 1)}`;
      const r = rec(id);
      r.syllabus.title = title || r.syllabus.title;
      r.state.header.courseTitle = title || r.state.header.courseTitle;
      r.syllabus.programCode = programCode;
      r.state.programCode = programCode;
      r.state.header.courseCode = courseCode || null;
      return { data: { syllabus: { id, _id: id, title: r.syllabus.title } } };
    },
    upload: async (formData) => {
      await wait();
      const r = createRecord(MOCK_IDS.upload);
      r.syllabus.title = formData.get('courseName') || r.syllabus.title;
      r.state.header.courseTitle = r.syllabus.title;
      r.syllabus.programCode = formData.get('programCode');
      r.state.programCode = r.syllabus.programCode;
      records.set(MOCK_IDS.upload, r);
      return { data: { syllabusId: MOCK_IDS.upload } };
    },
    getStatus: async (id) => ({ data: { status: rec(id).syllabus.status, stage: 'done', error: null } }),
    reanalyze: async (id) => {
      await wait();
      const r = rec(id);
      r.syllabus.needsRebuild = false;
      return { data: { ok: true } };
    },
    deleteSyllabus: async (id) => { records.delete(id); return { data: { ok: true } }; },
  };

  const cabinet = {
    getSyllabi: async () => ({
      data: [
        {
          id: MOCK_IDS.upload,
          _id: MOCK_IDS.upload,
          title: 'Risk Management v.2',
          courseName: 'Risk Management v.2',
          programCode: 'MBA28',
          cohort: 'MBA28',
          status: 'in_progress',
          updatedAt: new Date().toISOString(),
        },
        {
          id: MOCK_IDS.scratch,
          _id: MOCK_IDS.scratch,
          title: 'Corporate Finance (from scratch)',
          courseName: 'Corporate Finance (from scratch)',
          programCode: 'MBA27',
          cohort: 'MBA27',
          status: 'in_progress',
          updatedAt: new Date().toISOString(),
        },
      ],
    }),
    getMetrics: async () => ({
      data: {
        totalSyllabi: 2,
        approvedSyllabi: 0,
        inProgressSyllabi: 2,
        avgReadiness: 45,
      },
    }),
    getUsers: async () => ({
      data: [
        { id: 'usr-1', email: 'instructor@kse.ua', role: 'instructor', name: 'KSE Instructor' },
        { id: 'usr-2', email: 'admin@kse.ua', role: 'admin', name: 'KSE Admin' },
      ],
    }),
    listPrograms: async () => ({ data: MOCK_PROGRAMS }),
    createProgram: async (data) => ({ data: { id: `prog-${Date.now()}`, ...data } }),
    updateProgram: async (id, data) => ({ data: { id, ...data } }),
    deleteProgram: async () => ({ data: { ok: true } }),
    updateUser: async (id, data) => ({ data: { id, ...data } }),
    listOfferings: async () => ({ data: { offerings: MOCK_OFFERINGS } }),
    listLecturers: async () => ({ data: { lecturers: [{ _id: 'u-lecturer', firstName: 'Olena', lastName: 'Khomenko', email: 'o.khomenko@example.com' }] } }),
    getPloCoverage: async (programCode) => ({ data: { programCode, ...MOCK_PLO_COVERAGE } }),
  };

  return {
    chat,
    syllabus,
    cabinet,
    references: { programs: async () => ({ data: MOCK_PROGRAMS }) },
    policies: { syllabusLibrary: async () => ({ data: { policies: MOCK_POLICY_LIBRARY } }) },
  };
}

// Статичні View для перегляду окремих карток у DevCards
export function mockView(id = MOCK_IDS.upload) {
  const r = createRecord(id);
  r.conversation = { id: 'conv', status: 'active' };
  if (id === MOCK_IDS.scratch) {
    r.currentSlotKey = INTERVIEW[0].slotKey;
    r.messages = [kindMessage('question', INTERVIEW[0])];
  } else {
    r.messages = [
      textMessage('ai', "Here's what I found in Risk Management: the file maps onto 5 of 8 sections of the KSE template. 3 items need your decision, and 3 policy blocks need a choice from the KSE library."),
      kindMessage('approve-all', { sections: ['course_info', 'materials'] }),
    ];
  }
  return toView(r);
}
