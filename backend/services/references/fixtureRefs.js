// Довідники з backend/fixtures/reference у форматі `refs` — для сіду і тестів.
// Формат `refs` (його ж повертає services/references.getRefs(programCode) з БД):
// { programCode, template: TemplateSection[], outcomes: [{code,text,themeDraft}], coreCourses: [{code,uk,en,ects}],
//   capstone: {projectTypes, structure, criteria, deliverables, plagiarismThreshold}, policyLibrary: {version, blocks} }
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../fixtures/reference');
const cache = new Map();
function readFixture(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8')));
  return cache.get(name);
}

/**
 * Довідник, розкладений по кількох файлах (B-8.1): «learning-outcomes.json» + «learning-outcomes.<НАБІР>.json» тощо.
 * Нова програма = новий файл, а не правка наявного. Об'єкти за ключем field зливаються, mappings — додаються.
 */
function readFixtureSet(prefix, field) {
  const names = fs.readdirSync(DIR).filter((n) => n === `${prefix}.json` || (n.startsWith(`${prefix}.`) && n.endsWith('.json'))).sort();
  const merged = { [field]: {}, mappings: [] };
  for (const name of names) {
    const data = readFixture(name);
    Object.assign(merged[field], data[field] || {});
    merged.mappings.push(...(data.mappings || []));
  }
  return merged;
}

const readOutcomesFixture = () => readFixtureSet('learning-outcomes', 'programs');
const readCoursesFixture = () => readFixtureSet('programme-courses', 'programmes');

function loadFixtureRefs(programCode) {
  const lo = readOutcomesFixture().programs[programCode];
  const pc = readCoursesFixture().programmes[programCode];
  const { projectTypes, structure, criteria, deliverables, plagiarismThreshold } = readFixture('capstone.criteria.json');
  const { version, blocks } = readFixture('policies.library.json');
  return {
    programCode,
    template: readFixture('template.sections.json').sections.map((s) => ({ programCode: null, ...s })),
    outcomes: lo ? lo.outcomes.map(({ code, text, themeDraft, label }) => ({ code, text, themeDraft, label: label || '' })) : [],
    coreCourses: pc ? pc.core : [],
    capstone: { projectTypes, structure, criteria, deliverables, plagiarismThreshold },
    policyLibrary: { version, blocks },
  };
}

module.exports = { loadFixtureRefs, readFixture, readOutcomesFixture, readCoursesFixture, FIXTURE_DIR: DIR };
