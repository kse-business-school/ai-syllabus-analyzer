const request = require('supertest');
const helpers = require('./helpers');
const app = require('../server');
const Program = require('../models/Program');
const Syllabus = require('../models/Syllabus');
const CourseOffering = require('../models/CourseOffering');
const { seedReferences } = require('../services/references/seed');

beforeAll(async () => {
  await helpers.connectDb();
  await Program.seedDefaults();
  await seedReferences();
});
afterAll(helpers.disconnectDb);

const bearer = (user) => ({ Authorization: `Bearer ${helpers.tokenFor(user)}` });

test('PLO coverage: manager читає, instructor 403, невідомий programCode 404', async () => {
  const instructor = await helpers.createUser();
  const manager = await helpers.createUser({ role: 'manager' });
  expect((await request(app).get('/api/cabinet/plo-coverage?programCode=MBA28').set(bearer(instructor))).status).toBe(403);
  expect((await request(app).get('/api/cabinet/plo-coverage?programCode=NOPE99').set(bearer(manager))).status).toBe(404);
  const ok = await request(app).get('/api/cabinet/plo-coverage?programCode=MBA28').set(bearer(manager));
  expect(ok.status).toBe(200);
  expect(ok.body.outcomes).toHaveLength(17);
  expect(ok.body.outcomes.every((o) => o.uncovered)).toBe(true);
});

test('PLO coverage збирає клітинки зі state силабуса призначення', async () => {
  const lecturer = await helpers.createUser();
  const director = await helpers.createUser({ role: 'director' });
  const offering = await CourseOffering.create({ programCode: 'MBA28', courseCode: 'RM.1', courseName: 'Risk Management', type: 'elective' });
  await Syllabus.create({
    title: 'Risk', instructor: lecturer._id, status: 'in_progress', programCode: 'MBA28', offeringId: offering._id,
    state: { programCode: 'MBA28', outcomes: [{ id: 'c1', text: 'Apply risk models', plo: [{ code: 'ПРН1', coverage: 'full', confirmed: true }], assessmentIds: [] }], assessments: [] },
  });
  const res = await request(app).get('/api/cabinet/plo-coverage?programCode=MBA28').set(bearer(director));
  const course = res.body.courses.find((c) => c.courseCode === 'RM.1');
  expect(course.cells['ПРН1'].weight).toBe(1);
  expect(res.body.outcomes.find((o) => o.code === 'ПРН1').sum).toBe(1);
});

test('lecturers: лише для manager/director/admin', async () => {
  const instructor = await helpers.createUser();
  const manager = await helpers.createUser({ role: 'manager' });
  expect((await request(app).get('/api/cabinet/lecturers').set(bearer(instructor))).status).toBe(403);
  const res = await request(app).get('/api/cabinet/lecturers').set(bearer(manager));
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.lecturers)).toBe(true);
});
