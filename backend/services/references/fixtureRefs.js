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

/** Розділи шаблону з усіх файлів: спільний (programCode null) і профілі програм (B-6.1). */
function readTemplateFixtures() {
  const names = fs.readdirSync(DIR).filter((n) => /^template\.sections(\.[^.]+)?\.json$/.test(n)).sort();
  return names.flatMap((name) => {
    const data = readFixture(name);
    const programCode = data.programCode ? String(data.programCode).toUpperCase() : null;
    return data.sections.map((s) => ({ programCode, disabled: false, ...s }));
  });
}

/** Шаблон набору без БД — той самий порядок шарів, що й references.getTemplate. */
function fixtureTemplate(programCode) {
  const code = String(programCode || '').toUpperCase();
  const program = readFixture('programs.json').programs.find((p) => p.code === code || (p.editions || []).some((e) => e.code === code));
  const layers = [null, program && program.code !== code ? program.code : null, code].filter((c, i) => i === 0 || c);
  const byKey = new Map();
  const rows = readTemplateFixtures();
  for (const layer of layers) {
    for (const r of rows.filter((x) => x.programCode === layer)) {
      if (r.disabled) byKey.delete(r.key);
      else byKey.set(r.key, r);
    }
  }
  return [...byKey.values()].sort((a, b) => a.order - b.order);
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
    template: fixtureTemplate(programCode),
    outcomes: lo ? lo.outcomes.map(({ code, text, themeDraft, label }) => ({ code, text, themeDraft, label: label || '' })) : [],
    coreCourses: pc ? pc.core : [],
    capstone: { projectTypes, structure, criteria, deliverables, plagiarismThreshold },
    policyLibrary: { version, blocks },
    programBlocks: ((readFixture('programs.json').programs.find((p) => p.code === String(programCode || '').toUpperCase()
      || (p.editions || []).some((e) => e.code === String(programCode || '').toUpperCase())) || {}).blocks || [])
      .map(({ code, label, group }) => ({ code, label, group: group || '' })),
  };
}

module.exports = { loadFixtureRefs, readFixture, readOutcomesFixture, readCoursesFixture, readTemplateFixtures, fixtureTemplate, FIXTURE_DIR: DIR };
