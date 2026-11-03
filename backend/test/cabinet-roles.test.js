const request = require('supertest');
const helpers = require('./helpers');
const app = require('../server');
const CourseOffering = require('../models/CourseOffering');

beforeAll(helpers.connectDb);
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

test('admin може призначити ролі manager і director', async () => {
  const admin = await helpers.createUser({ role: 'admin' });
  const target = await helpers.createUser();
  const res = await request(app).patch(`/api/cabinet/users/${target._id}`).set(bearer(admin)).send({ role: 'director' });
  expect(res.status).toBe(200);
  expect(res.body.user.role).toBe('director');
});
