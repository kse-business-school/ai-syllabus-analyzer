// Порожній стан силабусу (трек 1 «з нуля»; також основа для парсера треку 2).
// Політики — усі блоки довідника: locked з текстом фікстури, library без обраного варіанта (дефолту немає).
const { SCHEMA_VERSION } = require('./schema');
const { recompute, findCoreCourse, courseKindOf } = require('./computed');
const { lockedText } = require('../references/policyText');

const prov = (source = null) => ({ source, evidenceBlockIds: [] });

/** Блоки довідника політик у порядку `order` як елементи state.policies; текст locked — мовою документа. */
function policiesFromRefs(refs, language = 'en') {
  const { version = null, blocks = [] } = refs?.policyLibrary || {};
  return [...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((b) => {
    const locked = b.mode === 'locked';
    return {
      key: b.key,
      mode: locked ? 'locked' : 'library',
      optionKey: null,
      candidateOptionKey: null,
      text: locked ? lockedText(b, language) : null,
      fixtureRef: locked ? { key: b.key, version } : null,
      modified: false,
      ...prov(locked ? 'fixture' : null),
    };
  });
}

/**
 * @param {{ programCode?: string, track?: 'scratch'|'upload', refs: object, course?: { title?, code?, ects? }, language?: 'en'|'uk' }} args
 * language — мова документа (B-1.1): за замовчуванням програми (Program.defaultLanguage) або визначена з файлу.
 * courseKind і ECTS (A-слот) — з refs.coreCourses лише за кодом курсу; без збігу — elective, ECTS = course.ects або null.
 */
function createEmptyState({ programCode, track = 'scratch', refs, course = {}, language = 'en' } = {}) {
  const core = findCoreCourse(refs, course.code);
  const state = {
    schemaVersion: SCHEMA_VERSION,
    programCode: programCode || refs?.programCode || null,
    track,
    language: language === 'uk' ? 'uk' : 'en',
    header: {
      courseTitle: course.title || null,
      courseCode: course.code || null,
      department: null,
      ects: core ? core.ects ?? null : course.ects ?? null,
      totalHours: null,
      studyMode: null,
      deliveryFormat: null,
      language: null,
      term: { start: null, end: null },
      courseKind: courseKindOf(refs, course.code),
      programBlock: null,
      computed: null, // заповнює recompute
      ...prov(course.title || course.code ? 'instructor_directed' : null),
    },
    summary: {
      prerequisites: { fixtureRefs: [], text: null, ...prov() },
      practicalApplication: { text: null, ...prov() },
      shortDescription: { text: null, ...prov() },
      objectives: [],
      capstone: { criteriaKeys: [], projectTypes: [], text: null, ...prov() },
    },
    outcomes: [],
    instructors: [],
    sessions: [],
    modules: [],
    guests: [],
    individualWork: [],
    assessments: [],
    compensation: { items: [] },
    materials: { required: [], recommended: [], bySession: [] },
    policies: policiesFromRefs(refs, language),
    sections: {},
  };
  return recompute(state, refs);
}

module.exports = { createEmptyState, policiesFromRefs };
