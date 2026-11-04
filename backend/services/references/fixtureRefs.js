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

function loadFixtureRefs(programCode) {
  const lo = readFixture('learning-outcomes.json').programs[programCode];
  const pc = readFixture('programme-courses.json').programmes[programCode];
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

module.exports = { loadFixtureRefs, readFixture, FIXTURE_DIR: DIR };
