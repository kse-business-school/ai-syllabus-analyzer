const helpers = require('./helpers');
const mongoose = require('mongoose');
const CourseOffering = require('../models/CourseOffering');
const Syllabus = require('../models/Syllabus');
const refs = require('../services/references');
const { recompute } = require('../services/syllabusState/computed');
const { createEmptyState } = require('../services/syllabusState/empty');
const { seedReferences } = require('../services/references/seed');
const { migrate } = require('../../scripts/migrate-v5-offerings');

beforeAll(async () => {
  await helpers.connectDb();
  await seedReferences();
});
afterAll(helpers.disconnectDb);
beforeEach(() => refs.invalidateCache());

test('призначення перекриває перелік нормативних курсів, лише в своєму наборі', async () => {
  const code = 'ZZ.1'; // у довідниках немає
  await CourseOffering.create({ programCode: 'MBA27', courseCode: code, type: 'core' });
  await CourseOffering.create({ programCode: 'MBA28', courseCode: code, type: 'elective' });
  const [r27, r28, r27other] = await Promise.all([refs.getRefs('MBA27'), refs.getRefs('MBA28'), refs.getRefs('MBA27')]);
  expect(createEmptyState({ programCode: 'MBA27', refs: r27, course: { code } }).header.courseKind).toBe('core');
  expect(createEmptyState({ programCode: 'MBA28', refs: r28, course: { code } }).header.courseKind).toBe('elective');
  const st = createEmptyState({ programCode: 'MBA27', refs: r27other, course: { code: ' zz.1 ' } });
  expect(recompute(st, r27other).header.courseKind).toBe('core');
});

test('без призначення тип лишається за довідником програми', async () => {
  const r27 = await refs.getRefs('MBA27');
  const core = r27.coreCourses[0];
  expect(createEmptyState({ programCode: 'MBA27', refs: r27, course: { code: core.code } }).header.courseKind).toBe('core');
});

test('унікальність курс × набір', async () => {
  await CourseOffering.create({ programCode: 'MBA28', courseCode: 'U.1', type: 'core' });
  await expect(CourseOffering.create({ programCode: 'MBA28', courseCode: 'U.1', type: 'elective' })).rejects.toThrow();
});

test('migrate-v5-offerings: dry-run нічого не міняє, повтор — 0 змін', async () => {
  const instructor = new mongoose.Types.ObjectId();
  await Syllabus.collection.insertMany([
    { title: 'A', programCode: 'MBA27', course: { code: 'M.1', name: 'A' }, instructor, state: { header: { courseKind: 'core' } } },
    { title: 'B', programCode: 'MBA28', course: { name: 'B' }, instructor },
  ]);
  expect(await migrate({ dryRun: true })).toMatchObject({ offeringsCreated: 1, syllabiLinked: 1, skippedNoCode: 1 });
  expect(await CourseOffering.countDocuments({ courseCode: 'M.1' })).toBe(0);
  expect(await migrate()).toMatchObject({ offeringsCreated: 1, syllabiLinked: 1 });
  const o = await CourseOffering.findOne({ courseCode: 'M.1' }).lean();
  expect(o).toMatchObject({ programCode: 'MBA27', type: 'core' });
  expect(await migrate()).toEqual({ offeringsCreated: 0, syllabiLinked: 0, skippedNoCode: 1 });
});
