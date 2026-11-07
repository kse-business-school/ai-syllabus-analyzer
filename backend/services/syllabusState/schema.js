// Контракт структурованого стану силабусу v5 (Syllabus.state). Див. docs/api-v5.md, розділ «Стан».
// Стан — єдине джерело правди для чату, перевірок, Readiness і генерації .docx.
const { validateSchema } = require('../../utils/jsonSchema');

const SCHEMA_VERSION = 1;

// Ключі розділів = TemplateSection.key (fixtures/reference/template.sections.json)
// Набір і порядок розділів конкретної програми — профіль у TemplateSection (programCode програми, B-6.1);
// тут — усі можливі ключі. programme_outcomes, practical_application, guest_speakers, pedagogical_approach — профіль MMM.
const SECTION_KEYS = [
  'at_a_glance', 'course_info', 'short_description', 'course_objectives', 'programme_outcomes', 'learning_outcomes',
  'practical_application', 'connection_to_capstone', 'instructor', 'schedule', 'guest_speakers', 'assessment', 'materials',
  'pedagogical_approach', 'policies',
];
const GUEST_STATUSES = ['confirmed', 'in_progress', 'tbd'];

// Походження тексту/значення (ТЗ §4 «Походження тексту» + parsed/ai_draft/computed/crm)
const SOURCES = ['fixture', 'fixture_edited', 'instructor_directed', 'parsed', 'ai_draft', 'computed', 'crm'];
const SLOT_TYPES = ['A', 'B', 'C', 'D', 'E'];
const EDITABILITY = ['locked', 'library', 'free'];
const SESSION_TYPES = ['lecture', 'practice', 'workshop'];
const DELIVERY_FORMATS = ['offline', 'online', 'hybrid'];
const TRACKS = ['scratch', 'upload'];
const SECTION_STATUSES = ['empty', 'draft', 'approved'];

const str = { type: ['string', 'null'] };
const num = { type: ['number', 'null'] };
const bool = { type: 'boolean' };
const strArr = { type: 'array', items: { type: 'string' } };
const source = { type: ['string', 'null'], enum: [...SOURCES, null] };
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
// Спільні поля провенансу для кожної сутності
const prov = { source, evidenceBlockIds: strArr };
const entity = (properties, optional = []) => {
  const schema = obj({ id: { type: 'string' }, ...properties, ...prov });
  schema.required = schema.required.filter(key => !optional.includes(key));
  return schema;
};
const textItem = entity({ text: str });
// Об'єкт, у якому перелічені ключі необов'язкові (стани, створені до їх появи, лишаються валідними)
const optionalKeys = (keys, properties) => obj(properties, Object.keys(properties).filter((k) => !keys.includes(k)));

// Ключі, яких може не бути в станах, створених до їхньої появи (B-6, B-8): модулі, гості
const stateSchema = optionalKeys(['modules', 'guests'], {
  schemaVersion: { type: 'number' },
  programCode: str,
  track: { type: 'string', enum: TRACKS },
  language: { type: ['string', 'null'], enum: ['en', 'uk', null] },
  header: optionalKeys(['declared', 'programBlock'], {
    courseTitle: str, courseCode: str, department: str,
    ects: num, totalHours: num,
    studyMode: str, // форма навчання
    deliveryFormat: { type: ['string', 'null'], enum: [...DELIVERY_FORMATS, null] },
    language: str,
    term: obj({ start: str, end: str }), // ISO-дати або null
    courseKind: { type: ['string', 'null'], enum: ['core', 'elective', null] }, // E: ProgramCourse за programCode
    programBlock: str, // корпус і блок програми (B-8.6): значення із закритого списку Program.blocks
    computed: obj({ // E: перераховує лише syllabusState/computed.js
      contactHours: num, lectureHours: num, practiceHours: num, workshopHours: num,
      selfStudyHours: num, assessmentTotal: num, deliveryModes: strArr,
      termFromSchedule: obj({ start: str, end: str }),
    }),
    // Необов'язкове: значення таблиці At a Glance, розпізнані у вхідному файлі (трек 2); трек 1 — null.
    // Тіло силабуса з ними не синхронізується: services/checks/glance.js порівнює declared із тілом.
    // term — ISO-діапазон { start, end } або текст як у файлі; deliveryMode нормалізований до DELIVERY_FORMATS.
    declared: { ...obj({
      assessmentTotal: num, contactHours: num, selfStudyHours: num,
      deliveryMode: { type: ['string', 'null'], enum: [...DELIVERY_FORMATS, null] },
      term: { anyOf: [str, obj({ start: str, end: str })] },
      instructor: str,
    }), type: ['object', 'null'] },
    ...prov,
  }),
  summary: optionalKeys(['practicalApplication'], {
    prerequisites: obj({ fixtureRefs: strArr, text: str, ...prov }),
    practicalApplication: obj({ text: str, ...prov }), // MMM: у що перетворюються результати навчання
    shortDescription: obj({ text: str, ...prov }),
    objectives: { type: 'array', items: textItem },
    capstone: obj({ criteriaKeys: strArr, projectTypes: strArr, text: str, ...prov }),
  }),
  outcomes: { type: 'array', items: entity({
    text: str,
    plo: { type: 'array', items: obj({ code: { type: 'string' }, coverage: { type: 'string', enum: ['full', 'partial'] }, confirmed: bool }) },
    assessmentIds: strArr,
  }) },
  instructors: { type: 'array', items: entity({
    crmId: str, name: str, position: str, email: str, officeHours: str, assistants: str,
    expertise: strArr, education: strArr, experience: strArr, photo: str,
  }, ['photo']) },
  sessions: { type: 'array', items: entity({
    n: { type: 'number' }, topic: str,
    type: { type: ['string', 'null'], enum: [...SESSION_TYPES, null] },
    hours: num, // академічні години
    format: { type: ['string', 'null'], enum: [...DELIVERY_FORMATS, null] },
    guest: str, additional: str, date: str, time: str,
    moduleId: str, prep: str, deadline: str, guestId: str, // B-6.2: модуль, підготовка, дедлайн, гість
  }, ['moduleId', 'prep', 'deadline', 'guestId']) },
  // Тематичні модулі (B-6.2): сесії групуються за moduleId, нумерація в документі — 1.1, 1.2 …
  modules: { type: 'array', items: entity({ n: { type: 'number' }, title: str }) },
  // Гостьові спікери (B-8.2); сесія посилається на гостя через sessions[].guestId
  guests: { type: 'array', items: entity({
    name: str, company: str, topic: str, format: str,
    status: { type: ['string', 'null'], enum: [...GUEST_STATUSES, null] },
  }) },
  individualWork: { type: 'array', items: entity({ title: str, hours: num }) },
  assessments: { type: 'array', items: entity({
    name: str, fixtureRef: str, weight: num, criteria: str, deadline: str,
    isParticipation: bool, // активність у класі (правило ≤ 30%)
    isControl: bool,       // контрольний захід (Положення 2.4.3, 2.5.6)
    outcomeIds: strArr,
    // Бали (B-6.3): unitCount одиниць × max(rubric.points) = maxPoints; рубрика — рівні 0/1/2 тощо
    maxPoints: num, unitCount: num,
    rubric: { type: 'array', items: obj({ points: { type: 'number' }, descriptor: { type: 'string' } }) },
  }, ['maxPoints', 'unitCount', 'rubric']) },
  compensation: obj({ items: { type: 'array', items: entity({
    group: { type: 'string', enum: ['comp', 'proof', 'retake', 'improve'] }, fixtureRef: str, text: str, modified: bool,
  }) } }),
  materials: optionalKeys(['bySession'], {
    required: { type: 'array', items: entity({ citation: str, url: str, verified: bool }) },
    recommended: { type: 'array', items: entity({ citation: str, url: str, verified: bool }) },
    // Матеріали до занять (B-8.4): sessionId — сесія, перед якою їх опрацювати
    bySession: { type: 'array', items: entity({ sessionId: str, citation: str, url: str, verified: bool }) },
  }),
  policies: { type: 'array', items: obj({
    key: { type: 'string' }, // policy.attendance …
    mode: { type: 'string', enum: ['locked', 'library'] },
    optionKey: str,          // обраний варіант довідника; null — не обрано (дефолту немає)
    candidateOptionKey: str, // найближчий варіант для тексту з файлу (лише підказка)
    text: str,
    fixtureRef: { type: ['object', 'null'] }, // { key, version }
    modified: bool,          // текст довідника змінено за вказівкою викладача
    ...prov,
  }) },
  sections: { type: 'object' }, // { [sectionKey]: { approved, approvedAt, approvedRevision } }
});

const sectionMetaSchema = obj({ approved: bool, approvedAt: str, approvedRevision: num }, ['approved']);

/** Повертає масив помилок (порожній — стан валідний). */
function validateState(state) {
  const errors = validateSchema(stateSchema, state);
  for (const [key, meta] of Object.entries(state?.sections || {})) {
    if (!SECTION_KEYS.includes(key)) errors.push(`$.sections.${key}: unknown section`);
    else errors.push(...validateSchema(sectionMetaSchema, meta, `$.sections.${key}`));
  }
  return errors;
}

module.exports = {
  SCHEMA_VERSION, SECTION_KEYS, GUEST_STATUSES, SOURCES, SLOT_TYPES, EDITABILITY, SESSION_TYPES, DELIVERY_FORMATS,
  TRACKS, SECTION_STATUSES, stateSchema, validateState,
};
