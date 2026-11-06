// Читання довідників з БД за programCode. Формат getRefs збігається з fixtureRefs.loadFixtureRefs.
const Program = require('../../models/Program');
const TemplateSection = require('../../models/TemplateSection');
const ProgramOutcome = require('../../models/ProgramOutcome');
const ProgramCourse = require('../../models/ProgramCourse');
const CapstoneGuide = require('../../models/CapstoneGuide');
const CourseOffering = require('../../models/CourseOffering');
const { httpError } = require('../../utils/httpError');
const { getPolicyLibrary } = require('./policies');

const CACHE_MS = 60 * 1000;
const cache = new Map();

function invalidateCache() {
  cache.clear();
}

async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, until: Date.now() + CACHE_MS });
  return value;
}

const norm = (code) => String(code || '').trim().toUpperCase();
const lean = (doc) => { const { _id, __v, createdAt, updatedAt, ...rest } = doc; return rest; };


/** Набір існує, якщо для нього є довідники ПРН/курсів, він є в Program.editions або це код програми без наборів */
async function assertKnownProgramCode(programCode) {
  const code = norm(programCode);
  const known = await cached(`known:${code}`, async () => {
    if (await ProgramOutcome.exists({ programCode: code })) return true;
    if (await ProgramCourse.exists({ programCode: code })) return true;
    // Набір програми або програма без наборів (її код сам є кодом довідників)
    return !!(await Program.exists({ $or: [{ 'editions.code': code }, { code, 'editions.0': { $exists: false } }] }));
  });
  if (!known) throw httpError(404, `Unknown programCode: ${programCode}`, { code: 'UNKNOWN_PROGRAM_CODE' });
  return code;
}

/** Програма набору (edition) або сама програма без наборів — для профілю розділів і списку блоків. */
async function programOf(code) {
  return cached(`program:${code}`, async () => Program.findOne({ $or: [{ 'editions.code': code }, { code }] })
    .select('code blocks defaultLanguage').lean());
}

/**
 * Розділи шаблону набору (B-6.1): спільні (programCode null) ← профіль програми (код програми) ← записи набору.
 * Запис із disabled: true прибирає розділ. Нова когорта успадковує профіль програми без копіювання.
 */
async function getTemplate(programCode) {
  const code = norm(programCode);
  return cached(`template:${code}`, async () => {
    const program = await programOf(code);
    const layers = [null, program && program.code !== code ? program.code : null, code].filter((c, i) => i === 0 || c);
    const rows = await TemplateSection.find({ programCode: { $in: layers } }).lean();
    const byKey = new Map();
    for (const layer of layers) {
      for (const r of rows.filter((x) => (x.programCode ?? null) === layer)) {
        if (r.disabled) byKey.delete(r.key);
        else byKey.set(r.key, lean(r));
      }
    }
    return [...byKey.values()].sort((a, b) => a.order - b.order);
  });
}

async function getOutcomes(programCode) {
  const code = norm(programCode);
  return cached(`outcomes:${code}`, async () =>
    (await ProgramOutcome.find({ programCode: code }).sort({ order: 1 }).lean()).map(lean));
}

async function getCourses(programCode) {
  const code = norm(programCode);
  return cached(`courses:${code}`, async () =>
    (await ProgramCourse.find({ programCode: code }).lean()).map(lean)
      .sort((a, b) => a.code.localeCompare(b.code, 'uk', { numeric: true })));
}

async function getCapstone(programCode) {
  const code = norm(programCode);
  return cached(`capstone:${code}`, async () => {
    const g = await CapstoneGuide.findOne({ programCode: code }).lean();
    return g ? lean(g) : null;
  });
}

/** Типи курсів, призначені в наборі: { 'КОД КУРСУ без пробілів': 'core'|'elective' } */
async function getOfferingTypes(programCode) {
  return cached(`offerings:${programCode}`, async () => {
    const rows = await CourseOffering.find({ programCode }).select('courseCode type').lean();
    return Object.fromEntries(rows.map((r) => [String(r.courseCode).normalize('NFC').replace(/\s+/g, '').toUpperCase(), r.type]));
  });
}

async function getRefs(programCode) {
  const code = norm(programCode);
  const [template, outcomes, courses, capstone, policyLibrary, offeringTypes, program] = await Promise.all([
    getTemplate(code), getOutcomes(code), getCourses(code), getCapstone(code), getPolicyLibrary(), getOfferingTypes(code), programOf(code),
  ]);
  const { projectTypes, structure, criteria, deliverables, plagiarismThreshold } = capstone || {};
  return {
    programCode: code,
    template,
    outcomes: outcomes.map(({ code: c, text, themeDraft, label }) => ({ code: c, text, themeDraft, label: label || '' })),
    coreCourses: courses.map(({ code: c, uk, en, ects }) => ({ code: c, uk, en, ects })),
    capstone: { projectTypes, structure, criteria, deliverables, plagiarismThreshold },
    policyLibrary,
    offeringTypes,
    // Закритий список «Корпус і блок програми» (B-8.6); порожній — поле не показується
    programBlocks: (program?.blocks || []).map(({ code: c, label, group }) => ({ code: c, label, group: group || '' })),
  };
}

async function listEditions() {
  const programs = await Program.find({ 'editions.0': { $exists: true } }).lean();
  return programs.flatMap((p) => p.editions.map((e) => ({ programId: p._id, programCode: p.code, ...e })));
}

const normTitle = (s) => String(s || '').toLowerCase().normalize('NFC')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Тип курсу лише за довідником програми. Збіг за кодом — надійний, за назвою (en/uk) — підказка.
 * @returns {{kind: 'core'|'elective', matchedBy: 'code'|'title'|null, course: object|null}}
 */
async function courseKind(programCode, { courseCode, courseTitle } = {}) {
  const courses = await getCourses(programCode);
  const c = String(courseCode || '').trim().toLowerCase();
  if (c) {
    const course = courses.find((x) => x.code.toLowerCase() === c);
    if (course) return { kind: 'core', matchedBy: 'code', course };
  }
  const t = normTitle(courseTitle);
  if (t) {
    const course = courses.find((x) => normTitle(x.en) === t || normTitle(x.uk) === t);
    if (course) return { kind: 'core', matchedBy: 'title', course };
  }
  return { kind: 'elective', matchedBy: null, course: null };
}

/** «PRN 3», «ПРН 3», «ПPН3» → «ПРН3»: канонічна форма коду ПРН, спільна для всіх модулів */
const { canonicalPloCode: normalizePloCode } = require('./ploCode');

module.exports = {
  getRefs, getTemplate, getOutcomes, getCourses, getCapstone, listEditions,
  courseKind, normalizePloCode, assertKnownProgramCode, invalidateCache,
};
