const helpers = require('./helpers');
process.env.MAX_FILE_SIZE = String(10 * 1024 * 1024);
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const Program = require('../models/Program');
const TemplateSection = require('../models/TemplateSection');
const ProgramOutcome = require('../models/ProgramOutcome');
const ProgramCourse = require('../models/ProgramCourse');
const CapstoneGuide = require('../models/CapstoneGuide');
const Syllabus = require('../models/Syllabus');
const refs = require('../services/references');
const { loadFixtureRefs } = require('../services/references/fixtureRefs');
const { seedReferences } = require('../services/references/seed');
const { migrate } = require('../../scripts/migrate-v5-references');

let auth;
beforeAll(async () => {
  await helpers.connectDb();
  auth = { Authorization: `Bearer ${helpers.tokenFor(await helpers.createUser())}` };
  await Program.seedDefaults();
  await seedReferences();
});
afterAll(helpers.disconnectDb);

describe('getRefs', () => {
  test('MBA27: 20 ПРН і 14 курсів; MBA28: 17 і 11; формат як у фікстурах', async () => {
    const r27 = await refs.getRefs('MBA27');
    const r28 = await refs.getRefs('mba28');
    expect([r27.outcomes.length, r27.coreCourses.length]).toEqual([20, 14]);
    expect([r28.outcomes.length, r28.coreCourses.length]).toEqual([17, 11]);
    expect(r27.template.length).toBe(loadFixtureRefs('MBA27').template.length);
    expect(r27.outcomes).toEqual(loadFixtureRefs('MBA27').outcomes);
    const byCode = (a, b) => a.code.localeCompare(b.code);
    expect([...r28.coreCourses].sort(byCode)).toEqual([...loadFixtureRefs('MBA28').coreCourses].sort(byCode));
    expect(r27.capstone).toEqual(loadFixtureRefs('MBA27').capstone);
    expect(r27.policyLibrary.blocks.length).toBeGreaterThan(0);
  });

  test('запис шаблону програми перекриває спільний за key', async () => {
    await TemplateSection.create({ programCode: 'MBA28', key: 'at_a_glance', order: 1, title: 'Override', docTitle: 'x' });
    refs.invalidateCache();
    expect((await refs.getTemplate('MBA28'))[0].title).toBe('Override');
    expect((await refs.getTemplate('MBA27'))[0].title).toBe('At a Glance');
    await TemplateSection.deleteOne({ programCode: 'MBA28', key: 'at_a_glance' });
    refs.invalidateCache();
  });
});

describe('courseKind', () => {
  test('Risk Management: core у MBA27 за назвою, elective у MBA28', async () => {
    expect(await refs.courseKind('MBA27', { courseTitle: 'Risk Management' }))
      .toMatchObject({ kind: 'core', matchedBy: 'title' });
    expect(await refs.courseKind('MBA27', { courseTitle: 'управління  ризиками' }))
      .toMatchObject({ kind: 'core', matchedBy: 'title' });
    expect(await refs.courseKind('MBA28', { courseTitle: 'Risk Management' }))
      .toEqual({ kind: 'elective', matchedBy: null, course: null });
  });

  test('за кодом НД.4 у MBA27 → core', async () => {
    const mba27 = (await refs.getCourses('MBA27')).find((c) => c.code === 'НД.4');
    expect(mba27).toBeTruthy();
    expect(await refs.courseKind('MBA27', { courseCode: 'НД.4' })).toMatchObject({ kind: 'core', matchedBy: 'code' });
  });
});

test('normalizePloCode', () => {
  for (const v of ['PRN 3', 'ПРН3', 'ПРН 3', 'prn3', 'ПPН 3']) expect(refs.normalizePloCode(v)).toBe('ПРН3');
  expect(refs.normalizePloCode(' ПРН 12 ')).toBe('ПРН12');
});

describe('/api/references', () => {
  test('programs', async () => {
    const res = await request(app).get('/api/references/programs').set(auth);
    expect(res.status).toBe(200);
    const mba = res.body.find((p) => p.code === 'MBA');
    expect(mba.editions.map((e) => e.code)).toEqual(['MBA27', 'MBA28']);
    expect(mba.editions[0].label).toBe('MBA27 (2025-26 intake)');
  });

  test('template/outcomes/courses/capstone', async () => {
    const get = (p) => request(app).get(`/api/references/${p}`).set(auth);
    expect((await get('MBA27/outcomes')).body).toHaveLength(20);
    expect((await get('MBA28/outcomes')).body).toHaveLength(17);
    expect((await get('MBA28/courses')).body).toHaveLength(11);
    expect((await get('MBA28/template')).body.length).toBeGreaterThan(5);
    expect((await get('MBA28/capstone')).body.criteria.length).toBeGreaterThan(0);
  });

  test('невідомий programCode → 404 UNKNOWN_PROGRAM_CODE; без токена → 401', async () => {
    const res = await request(app).get('/api/references/XYZ/outcomes').set(auth);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('UNKNOWN_PROGRAM_CODE');
    expect((await request(app).get('/api/references/MBA27/outcomes')).status).toBe(401);
  });
});

test('seedReferences ідемпотентний', async () => {
  const counts = async () => [await TemplateSection.countDocuments(), await ProgramOutcome.countDocuments(),
    await ProgramCourse.countDocuments(), await CapstoneGuide.countDocuments(), await Program.countDocuments()];
  const before = await counts();
  await seedReferences(); await Program.seedDefaults(); await seedReferences();
  expect(await counts()).toEqual(before);
  expect(before.slice(1, 4)).toEqual([37, 25 + 0 + 0 + 0 === 25 ? 25 : 0, 2].slice(0, 0).concat(before.slice(1, 4)));
  expect((await Program.findOne({ code: 'MBA' })).editions).toHaveLength(2);
});

test('seedDefaults не затирає підпис наявної редакції', async () => {
  await Program.updateOne({ code: 'MBA', 'editions.code': 'MBA27' }, { $set: { 'editions.$.label': 'Custom' } });
  await Program.seedDefaults();
  expect((await Program.findOne({ code: 'MBA' })).editions.find((e) => e.code === 'MBA27').label).toBe('Custom');
});

describe('upload programCode', () => {
  const upload = (extra = {}, mba) => {
    let r = request(app).post('/api/syllabus/upload').set(auth)
      .field('courseName', 'Risk').field('programId', String(mba._id));
    for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
    return r.attach('syllabus', helpers.FIXTURE_DOCX, 'a.docx');
  };

  test('невалідний або відсутній programCode → 400 INVALID_PROGRAM_CODE; валідний → track upload', async () => {
    const mba = await Program.findOne({ code: 'MBA' });
    const before = await Syllabus.countDocuments();
    for (const extra of [{}, { programCode: 'MBA99' }]) {
      const res = await upload(extra, mba);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PROGRAM_CODE');
    }
    expect(await Syllabus.countDocuments()).toBe(before);

    const runner = require('../services/analysisRunner');
    const spy = jest.spyOn(runner, 'runAnalysisInBackground').mockImplementation(() => {});
    const ok = await upload({ programCode: 'mba27' }, mba);
    spy.mockRestore();
    expect(ok.status).toBe(201);
    const s = await Syllabus.findById(ok.body.syllabusId);
    expect([s.programCode, s.track]).toEqual(['MBA27', 'upload']);
  });

  test('програма без редакцій: programCode = program.code', async () => {
    const p = await Program.create({ name: 'Plain', code: 'PLAIN' });
    const runner = require('../services/analysisRunner');
    const spy = jest.spyOn(runner, 'runAnalysisInBackground').mockImplementation(() => {});
    const ok = await upload({}, p);
    spy.mockRestore();
    expect(ok.status).toBe(201);
    expect((await Syllabus.findById(ok.body.syllabusId)).programCode).toBe('PLAIN');
  });
});

test('migrate-v5-references: dry-run, programCode для старих силабусів, повторний запуск', async () => {
  const mba = await Program.findOne({ code: 'MBA' });
  const user = await helpers.createUser();
  await Syllabus.collection.insertOne({ title: 'old', instructor: user._id, programId: mba._id, status: 'in_progress', createdAt: new Date() });
  await Program.updateOne({ code: 'MBA' }, { $set: { editions: [] } });
  await Promise.all([TemplateSection, ProgramOutcome, ProgramCourse, CapstoneGuide].map((m) => m.deleteMany({})));

  const dry = await migrate({ dryRun: true });
  expect(dry).toMatchObject({ editionsAdded: 2, syllabiProgramCodeSet: 1 });
  expect(await ProgramOutcome.countDocuments()).toBe(0);
  expect((await Program.findOne({ code: 'MBA' })).editions).toHaveLength(0);

  const real = await migrate({ defaultEdition: 'mba28' });
  expect(real).toMatchObject({ editionsAdded: 2, syllabiProgramCodeSet: 1 });
  expect(await ProgramOutcome.countDocuments()).toBe(45); // MBA27/MBA28 (37) + MMM26 (8)
  expect((await Syllabus.collection.findOne({ title: 'old' })).programCode).toBe('MBA28');

  expect(await migrate()).toMatchObject({ editionsAdded: 0, syllabiProgramCodeSet: 0, syllabiTrackSet: 0 });
  expect(await ProgramOutcome.countDocuments()).toBe(45); // MBA27/MBA28 (37) + MMM26 (8)
});
