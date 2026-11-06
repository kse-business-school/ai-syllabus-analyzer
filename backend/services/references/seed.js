// Ідемпотентний сід довідників із backend/fixtures/reference (upsert за природними ключами)
const TemplateSection = require('../../models/TemplateSection');
const ProgramOutcome = require('../../models/ProgramOutcome');
const OutcomeMapping = require('../../models/OutcomeMapping');
const ProgramCourse = require('../../models/ProgramCourse');
const CapstoneGuide = require('../../models/CapstoneGuide');
const ReferenceOverride = require('../../models/ReferenceOverride');
const { readFixture, readOutcomesFixture, readCoursesFixture, readTemplateFixtures } = require('./fixtureRefs');

/** Набори, чий довідник kind змінено в кабінеті: сід їх не чіпає (services/references/editor.js). */
async function managedCodes(kind) {
  return new Set((await ReferenceOverride.find({ kind }).select('programCode').lean()).map((o) => o.programCode));
}


function upsertOps(items, filterOf) {
  return items.map((doc) => ({
    updateOne: { filter: filterOf(doc), update: { $set: doc }, upsert: true },
  }));
}

async function seedReferences() {
  // Спільний шаблон і профілі програм (template.sections.<ПРОГРАМА>.json, programCode у файлі)
  const template = readTemplateFixtures();
  await TemplateSection.bulkWrite(upsertOps(template, (d) => ({ programCode: d.programCode, key: d.key })));

  const lo = readOutcomesFixture();
  const managedOutcomes = await managedCodes('outcomes');
  const outcomes = Object.entries(lo.programs).filter(([programCode]) => !managedOutcomes.has(programCode)).flatMap(([programCode, p]) =>
    p.outcomes.map((o, i) => ({ programCode, code: o.code, text: o.text, themeDraft: o.themeDraft || '', order: i + 1 })));
  if (outcomes.length) await ProgramOutcome.bulkWrite(upsertOps(outcomes, (d) => ({ programCode: d.programCode, code: d.code })));
  // Мітки з фікстури заповнюють пропуски; редакторські зміни не затираються при рестарті.
  for (const [programCode, program] of Object.entries(lo.programs).filter(([code]) => !managedOutcomes.has(code))) {
    for (const outcome of program.outcomes.filter(o => o.label)) {
      await ProgramOutcome.updateOne({ programCode, code: outcome.code, $or: [{ label: { $exists: false } }, { label: '' }] }, { $set: { label: outcome.label } });
    }
  }

  // Відповідність ПРН між наборами (MBA27 → MBA28, …): скільки завгодно пар наборів, коди — з фікстури
  for (const m of lo.mappings || []) {
    await OutcomeMapping.updateOne(
      { from: String(m.from).toUpperCase(), to: String(m.to).toUpperCase() },
      { $set: { pairs: (m.pairs || []).map((x) => ({ from: x.from ?? null, to: x.to ?? null, change: x.change || '' })) } },
      { upsert: true }
    );
  }

  const pc = readCoursesFixture();
  const managedCourses = await managedCodes('courses');
  const courses = Object.entries(pc.programmes).filter(([programCode]) => !managedCourses.has(programCode)).flatMap(([programCode, p]) =>
    p.core.map((c) => ({ programCode, code: c.code, uk: c.uk, en: c.en || '', ects: c.ects ?? null })));
  if (courses.length) await ProgramCourse.bulkWrite(upsertOps(courses, (d) => ({ programCode: d.programCode, code: d.code })));

  // Набори, для яких діє цей довідник Capstone, — поле programCodes фікстури (не код)
  const { version, projectTypes, structure, criteria, deliverables, plagiarismThreshold, programCodes = [] } = readFixture('capstone.criteria.json');
  const managedCapstone = await managedCodes('capstone');
  const capstonePrograms = programCodes.map((c) => String(c).toUpperCase()).filter((c) => !managedCapstone.has(c));
  for (const programCode of capstonePrograms) {
    await CapstoneGuide.updateOne(
      { programCode },
      { $set: { version, projectTypes, structure, criteria, deliverables, plagiarismThreshold } },
      { upsert: true }
    );
  }

  require('./index').invalidateCache();
  return { template: template.length, outcomes: outcomes.length, courses: courses.length, capstone: capstonePrograms.length };
}

module.exports = { seedReferences };
