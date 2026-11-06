// Реєстр слотів v5: єдине місце, де визначено тип слота (A–E), рівень редагованості і пороги повноти.
// Інструменти чату (services/ai/tools) дізнаються звідси, що можна змінювати; Readiness — що вважати заповненим.
// Пороги повноти — ТЗ §8, детерміновані, без LLM.

// Типи: A автопідстановка · B довідник · C питання · D AI-чернетка → підтвердження · E обчислюється
// editability: locked — лише бачить; library — варіант довідника → правка через чат; free — пише що завгодно
// path — шлях у Syllabus.state; '[]' — масив сутностей; '{key}' — політика за ключем
const SLOTS = [
  // At a Glance
  { key: 'glance.program', section: 'at_a_glance', path: 'programCode', type: 'A', editability: 'locked', required: true },
  { key: 'glance.term', section: 'at_a_glance', path: 'header.term', type: 'A', editability: 'free', required: false },
  { key: 'glance.delivery_mode', section: 'at_a_glance', path: 'header.deliveryFormat', type: 'A', editability: 'free', required: true },
  { key: 'glance.ects', section: 'at_a_glance', path: 'header.ects', type: 'A', fallbackType: 'C', editability: 'free', required: true },
  { key: 'glance.department', section: 'at_a_glance', path: 'header.department', type: 'A', fallbackType: 'C', editability: 'free', required: false },
  { key: 'glance.total_hours', section: 'at_a_glance', path: 'header.totalHours', type: 'A', fallbackType: 'C', editability: 'free', required: false },
  { key: 'glance.language', section: 'at_a_glance', path: 'header.language', type: 'A', fallbackType: 'C', editability: 'free', required: false },
  { key: 'glance.study_mode', section: 'at_a_glance', path: 'header.studyMode', type: 'A', fallbackType: 'C', editability: 'free', required: false },
  { key: 'glance.contact_hours', section: 'at_a_glance', path: 'header.computed.contactHours', type: 'E', editability: 'locked', required: false },
  { key: 'glance.self_study_hours', section: 'at_a_glance', path: 'header.computed.selfStudyHours', type: 'E', editability: 'locked', required: false },
  { key: 'glance.assessment_total', section: 'at_a_glance', path: 'header.computed.assessmentTotal', type: 'E', editability: 'locked', required: false },
  { key: 'glance.course_kind', section: 'at_a_glance', path: 'header.courseKind', type: 'E', editability: 'locked', required: false },
  // Корпус і блок програми (B-8.6): закритий список Program.blocks; для програм без списку слота немає в профілі
  { key: 'glance.program_block', section: 'at_a_glance', path: 'header.programBlock', type: 'C', editability: 'free', required: false, fixture: 'program-blocks' },

  // 1 · Summary
  { key: 'course.title', section: 'course_info', path: 'header.courseTitle', type: 'A', editability: 'free', required: true },
  { key: 'course.prerequisites', section: 'course_info', path: 'summary.prerequisites', type: 'B', fallbackType: 'C', editability: 'library', required: true, fixture: 'prerequisites' },
  { key: 'course.description', section: 'short_description', path: 'summary.shortDescription', type: 'D', editability: 'free', required: true },
  { key: 'course.objectives', section: 'course_objectives', path: 'summary.objectives[]', type: 'D', editability: 'free', required: true },
  { key: 'course.outcomes', section: 'learning_outcomes', path: 'outcomes[]', type: 'D', editability: 'free', required: true },
  { key: 'course.outcomes_plo', section: 'learning_outcomes', path: 'outcomes[].plo', type: 'D', editability: 'free', required: false, fixture: 'learning-outcomes' },
  { key: 'course.capstone', section: 'connection_to_capstone', path: 'summary.capstone', type: 'D', editability: 'free', required: true, fixture: 'capstone' },
  // Профіль MMM: зв'язок із ПРН програми (розділ 1) і практичне застосування (розділ 3)
  { key: 'course.programme_outcomes', section: 'programme_outcomes', path: 'outcomes[].plo', type: 'D', editability: 'free', required: true, fixture: 'learning-outcomes' },
  { key: 'course.practical_application', section: 'practical_application', path: 'summary.practicalApplication', type: 'D', editability: 'free', required: true },

  // 2 · Instructor
  { key: 'instructor.profile', section: 'instructor', path: 'instructors[]', type: 'A', editability: 'free', required: true },

  // 3 · Schedule
  { key: 'schedule.sessions', section: 'schedule', path: 'sessions[]', type: 'C', editability: 'free', required: true },
  { key: 'schedule.session_format', section: 'schedule', path: 'sessions[].format', type: 'B', editability: 'library', required: false },
  { key: 'schedule.additional', section: 'schedule', path: 'sessions[].additional', type: 'D', editability: 'free', required: false },
  { key: 'schedule.individual_work', section: 'schedule', path: 'individualWork[]', type: 'C', editability: 'free', required: false },
  { key: 'schedule.modules', section: 'schedule', path: 'modules[]', type: 'C', editability: 'free', required: false },

  // Гостьові спікери (B-8.2)
  { key: 'guests.list', section: 'guest_speakers', path: 'guests[]', type: 'C', editability: 'free', required: false },

  // 4 · Assessment
  { key: 'assessment.components', section: 'assessment', path: 'assessments[]', type: 'B', fallbackType: 'C', editability: 'library', required: true, fixture: 'assessment-components' },
  { key: 'assessment.criteria', section: 'assessment', path: 'assessments[].criteria', type: 'D', editability: 'free', required: true },
  { key: 'assessment.compensation', section: 'assessment', path: 'compensation.items[]', type: 'B', fallbackType: 'C', editability: 'library', required: false, fixture: 'compensation' },

  // 5 · Materials
  { key: 'materials.required', section: 'materials', path: 'materials.required[]', type: 'C', editability: 'free', required: true },
  { key: 'materials.recommended', section: 'materials', path: 'materials.recommended[]', type: 'D', editability: 'free', required: false },
  { key: 'materials.by_session', section: 'materials', path: 'materials.bySession[]', type: 'C', editability: 'free', required: false },

  // 6 · Policies: по слоту на блок довідника; editability блоку = його mode (locked|library)
  { key: 'policy.*', section: 'policies', path: 'policies{key}', type: 'B', editability: 'library', required: true, fixture: 'policies.library' },
];

const bySlotKey = new Map(SLOTS.map((s) => [s.key, s]));

/** Слот за ключем; для політик ('policy.attendance') — editability з mode блоку в стані. */
function getSlot(key, state) {
  if (bySlotKey.has(key)) return bySlotKey.get(key);
  if (!key.startsWith('policy.')) return null;
  const block = (state?.policies || []).find((p) => p.key === key);
  if (state && !block) return null;
  return { ...bySlotKey.get('policy.*'), key, editability: block?.mode === 'locked' ? 'locked' : 'library' };
}

const slotsOfSection = (section) => SLOTS.filter((s) => s.section === section);

// --- Пороги повноти (ТЗ §8) ---
const filled = (v) => v !== null && v !== undefined && String(v).trim() !== '';
// «Не коротше одного повного речення»: щонайменше 5 слів і кінцевий розділовий знак
function isFullSentence(text) {
  const t = String(text || '').trim();
  return t.split(/\s+/).filter(Boolean).length >= 5 && /[.!?…]["»”')]?$/.test(t);
}
// Політика зарахована: обрано варіант довідника або викладач свідомо написав/змінив текст
const POLICY_DECIDED_SOURCES = ['instructor_directed', 'fixture_edited'];
const policyDecided = (p) => p.mode === 'locked' ? filled(p.text) : filled(p.optionKey) || (POLICY_DECIDED_SOURCES.includes(p.source) && filled(p.text));

// Кожна функція повертає список прогалин (порожній — розділ заповнений)
const SECTION_GAPS = {
  at_a_glance: (s) => [
    !filled(s.programCode) && 'Program',
    !filled(s.header?.deliveryFormat) && 'Delivery mode',
    !filled(s.header?.ects) && 'Credits / ECTS',
    !filled(s.instructors?.[0]?.name) && 'Instructor',
  ],
  course_info: (s) => [
    !filled(s.header?.courseTitle) && 'Course Title',
    !(filled(s.summary?.prerequisites?.text) || s.summary?.prerequisites?.fixtureRefs?.length) && 'Prerequisites',
  ],
  short_description: (s) => [!isFullSentence(s.summary?.shortDescription?.text) && 'Short Course Description: at least one full sentence'],
  course_objectives: (s) => [!isFullSentence((s.summary?.objectives || []).map((o) => o.text || '').join(' ')) && 'Course Objectives: at least one full sentence'],
  learning_outcomes: (s) => [!(s.outcomes || []).some((o) => filled(o.text)) && 'Learning Outcomes: at least one outcome'],
  connection_to_capstone: (s) => [!isFullSentence(s.summary?.capstone?.text) && 'Connection to Capstone: at least one full sentence'],
  instructor: (s) => {
    const i = s.instructors?.[0];
    return [!filled(i?.name) && 'Instructor name', !(i?.expertise?.length || i?.education?.length || i?.experience?.length) && 'Expertise / Education / Experience'];
  },
  // Дата й час у поріг не входять
  schedule: (s) => [
    !(s.sessions || []).length && 'At least one session',
    ...(s.sessions || []).map((x, i) => !filled(x.topic) && `Session ${x.n ?? i + 1}: topic`),
  ],
  assessment: (s) => [
    !(s.assessments || []).length && 'At least one assessment component',
    ...(s.assessments || []).flatMap((a, i) => {
      const name = a.name || `Component ${i + 1}`;
      return [!filled(a.weight) && `${name}: weight`, !filled(a.criteria) && `${name}: criteria`, !filled(a.deadline) && `${name}: deadline`];
    }),
  ],
  materials: (s) => [!(s.materials?.required || []).some((m) => filled(m.citation)) && 'At least one required material'],
  // Профіль MMM
  programme_outcomes: (s) => [!(s.outcomes || []).some((o) => (o.plo || []).some((p) => p.confirmed === true)) && 'At least one confirmed link to a programme outcome'],
  practical_application: (s) => [!isFullSentence(s.summary?.practicalApplication?.text) && 'Practical application: at least one full sentence'],
  guest_speakers: (s) => (s.guests || []).map((g, i) => !filled(g.name) && `Guest ${i + 1}: name`),
  pedagogical_approach: () => [], // текст програми (locked), викладач його не заповнює
  // Без жодного блоку (порожній довідник політик) розділ не може бути повним
  policies: (s) => (!(s.policies || []).length ? ['Policies: the policy library is empty']
    : s.policies.filter((p) => !policyDecided(p)).map((p) => `${p.key}: choose an option or write your own`)),
};

function sectionGaps(sectionKey, state) {
  const fn = SECTION_GAPS[sectionKey];
  return fn ? fn(state || {}).filter(Boolean) : [];
}
const isSectionComplete = (sectionKey, state) => sectionGaps(sectionKey, state).length === 0;

module.exports = { SLOTS, getSlot, slotsOfSection, sectionGaps, isSectionComplete, isFullSentence, policyDecided };
