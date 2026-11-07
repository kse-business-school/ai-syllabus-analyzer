const request = require('supertest');
const helpers = require('./helpers');
const app = require('../server');
const CourseOffering = require('../models/CourseOffering');

beforeAll(async () => {
  await helpers.connectDb();
  await require('../models/Program').seedDefaults();
});
afterAll(helpers.disconnectDb);

const bearer = (user) => ({ Authorization: `Bearer ${helpers.tokenFor(user)}` });

test('manager і director бачать усі силабуси лише з scope=all; без scope — лише свої', async () => {
  const lecturer = await helpers.createUser();
  const manager = await helpers.createUser({ role: 'manager' });
  await helpers.createSyllabus(lecturer);
  const own = await request(app).get('/api/cabinet/syllabi').set(bearer(manager));
  expect(own.body.total).toBe(0);
  const all = await request(app).get('/api/cabinet/syllabi?scope=all').set(bearer(manager));
  expect(all.body.total).toBeGreaterThanOrEqual(1);
});

test('instructor не може запросити scope=all', async () => {
  const lecturer = await helpers.createUser();
  const res = await request(app).get('/api/cabinet/syllabi?scope=all').set(bearer(lecturer));
  expect(res.status).toBe(403);
  const metrics = await request(app).get('/api/cabinet/metrics?scope=all').set(bearer(lecturer));
  expect(metrics.status).toBe(403);
});

test('manager читає чужий силабус у чаті, але не мутує його', async () => {
  const lecturer = await helpers.createUser();
  const manager = await helpers.createUser({ role: 'manager' });
  const syllabus = await helpers.createSyllabus(lecturer);
  const read = await request(app).get(`/api/chat/${syllabus._id}`).set(bearer(manager));
  expect(read.status).not.toBe(403);
  const write = await request(app).post(`/api/chat/${syllabus._id}/start`).set(bearer(manager)).send({});
  expect(write.status).toBe(403);
});

test('призначення курсів: manager/director створюють, instructor ні; унікальність курс × набір', async () => {
  const lecturer = await helpers.createUser();
  const director = await helpers.createUser({ role: 'director' });
  const body = { programCode: 'MBA28', courseCode: 'RM.1', type: 'elective', lecturerId: String(lecturer._id) };
  expect((await request(app).post('/api/cabinet/offerings').set(bearer(lecturer)).send(body)).status).toBe(403);
  const created = await request(app).post('/api/cabinet/offerings').set(bearer(director)).send(body);
  expect(created.status).toBe(201);
  expect((await request(app).post('/api/cabinet/offerings').set(bearer(director)).send(body)).status).toBe(409);
  const upd = await request(app).put(`/api/cabinet/offerings/${created.body._id}`).set(bearer(director)).send({ type: 'core' });
  expect(upd.body.type).toBe('core');
  // викладач бачить лише свої призначення
  await CourseOffering.create({ programCode: 'MBA28', courseCode: 'OTHER', type: 'core' });
  const mine = await request(app).get('/api/cabinet/offerings').set(bearer(lecturer));
  expect(mine.body.offerings.map((o) => o.courseCode)).toEqual(['RM.1']);
});

test('A10: призначення лише на відомий набір і наявного активного викладача', async () => {
  const director = await helpers.createUser({ role: 'director' });
  const inactive = await helpers.createUser({ isActive: false });
  const post = (body) => request(app).post('/api/cabinet/offerings').set(bearer(director)).send(body);
  const bad = await post({ programCode: 'NOT-A-COHORT', courseCode: 'X.1', type: 'core' });
  expect(bad.status).toBe(400);
  expect(bad.body.code).toBe('UNKNOWN_PROGRAM_CODE');
  const ghost = await post({ programCode: 'MBA28', courseCode: 'X.1', type: 'core', lecturerId: '64b000000000000000000000' });
  expect(ghost.body.code).toBe('UNKNOWN_LECTURER');
  expect((await post({ programCode: 'MBA28', courseCode: 'X.1', type: 'core', lecturerId: String(inactive._id) })).status).toBe(400);
  // courseCode довільний (elective не з переліку нормативних курсів)
  expect((await post({ programCode: 'MBA28', courseCode: 'X.1', type: 'elective' })).status).toBe(201);
  expect((await post({ programCode: 'MBA28', courseCode: 'X.1', type: 'elective' })).body.code).toBe('OFFERING_EXISTS');
});

test('admin може призначити ролі manager і director', async () => {
  const admin = await helpers.createUser({ role: 'admin' });
  const target = await helpers.createUser();
  const res = await request(app).patch(`/api/cabinet/users/${target._id}`).set(bearer(admin)).send({ role: 'director' });
  expect(res.status).toBe(200);
  expect(res.body.user.role).toBe('director');
});

test('A01: manager і director не видаляють чужі силабуси; admin і власник — можуть', async () => {
  const Syllabus = require('../models/Syllabus');
  const lecturer = await helpers.createUser();
  const manager = await helpers.createUser({ role: 'manager' });
  const director = await helpers.createUser({ role: 'director' });
  const admin = await helpers.createUser({ role: 'admin' });
  const a = await helpers.createSyllabus(lecturer);
  for (const user of [manager, director]) {
    const res = await request(app).delete(`/api/syllabus/${a._id}`).set(bearer(user));
    expect(res.status).toBe(403);
    // читати й далі можуть
    expect((await request(app).get(`/api/syllabus/${a._id}`).set(bearer(user))).status).toBe(200);
  }
  expect(await Syllabus.exists({ _id: a._id })).toBeTruthy();
  expect((await request(app).delete(`/api/syllabus/${a._id}`).set(bearer(admin))).status).toBe(200);
  const b = await helpers.createSyllabus(lecturer);
  expect((await request(app).delete(`/api/syllabus/${b._id}`).set(bearer(lecturer))).status).toBe(200);
});
