// Ідемпотентний сід довідників із backend/fixtures/reference (upsert за природними ключами)
const TemplateSection = require('../../models/TemplateSection');
const ProgramOutcome = require('../../models/ProgramOutcome');
const OutcomeMapping = require('../../models/OutcomeMapping');
const ProgramCourse = require('../../models/ProgramCourse');
const CapstoneGuide = require('../../models/CapstoneGuide');
const { readFixture } = require('./fixtureRefs');

const CAPSTONE_PROGRAMS = ['MBA27', 'MBA28'];

function upsertOps(items, filterOf) {
  return items.map((doc) => ({
    updateOne: { filter: filterOf(doc), update: { $set: doc }, upsert: true },
  }));
}

async function seedReferences() {
  const template = readFixture('template.sections.json').sections
    .map((s) => ({ programCode: null, ...s }));
  await TemplateSection.bulkWrite(upsertOps(template, (d) => ({ programCode: null, key: d.key })));

  const lo = readFixture('learning-outcomes.json');
  const outcomes = Object.entries(lo.programs).flatMap(([programCode, p]) =>
    p.outcomes.map((o, i) => ({ programCode, code: o.code, text: o.text, themeDraft: o.themeDraft || '', order: i + 1 })));
  await ProgramOutcome.bulkWrite(upsertOps(outcomes, (d) => ({ programCode: d.programCode, code: d.code })));
  // Мітки з фікстури заповнюють пропуски; редакторські зміни не затираються при рестарті.
  for (const [programCode, program] of Object.entries(lo.programs)) {
    for (const outcome of program.outcomes.filter(o => o.label)) {
      await ProgramOutcome.updateOne({ programCode, code: outcome.code, $or: [{ label: { $exists: false } }, { label: '' }] }, { $set: { label: outcome.label } });
    }
  }

  if (lo.mapping27to28) {
    await OutcomeMapping.updateOne(
      { from: 'MBA27', to: 'MBA28' },
      { $set: { pairs: lo.mapping27to28.map((m) => ({ from: m.mba27, to: m.mba28, change: m.change || '' })) } },
      { upsert: true }
    );
  }

  const pc = readFixture('programme-courses.json');
  const courses = Object.entries(pc.programmes).flatMap(([programCode, p]) =>
    p.core.map((c) => ({ programCode, code: c.code, uk: c.uk, en: c.en || '', ects: c.ects ?? null })));
  await ProgramCourse.bulkWrite(upsertOps(courses, (d) => ({ programCode: d.programCode, code: d.code })));

  const { version, projectTypes, structure, criteria, deliverables, plagiarismThreshold } = readFixture('capstone.criteria.json');
  for (const programCode of CAPSTONE_PROGRAMS) {
    await CapstoneGuide.updateOne(
      { programCode },
      { $set: { version, projectTypes, structure, criteria, deliverables, plagiarismThreshold } },
      { upsert: true }
    );
  }

  require('./index').invalidateCache();
  return { template: template.length, outcomes: outcomes.length, courses: courses.length, capstone: CAPSTONE_PROGRAMS.length };
}

module.exports = { seedReferences };
