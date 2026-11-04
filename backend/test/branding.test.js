const helpers = require('./helpers');
const request = require('supertest');
const sharp = require('sharp');
const JSZip = require('jszip');
const app = require('../server');
const User = require('../models/User');
const Program = require('../models/Program');
const Syllabus = require('../models/Syllabus');
const { seedReferences } = require('../services/references/seed');
const { renderSyllabusDocx } = require('../services/document/writers/templateDocx');
const { getRefs } = require('../services/references');

let owner, other, manager, photo;
const auth = user => ({ Authorization: `Bearer ${helpers.tokenFor(user)}` });
beforeAll(async () => {
  await helpers.connectDb();
  await Program.seedDefaults(); await seedReferences();
  owner = await helpers.createUser(); other = await helpers.createUser();
  manager = await helpers.createUser({ role: 'manager' });
  photo = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#004641' } }).png().toBuffer();
});
afterAll(helpers.disconnectDb);

test('photo upload decodes and normalises the image, and can only update the authenticated user', async () => {
  const res = await request(app).post('/api/users/avatar').set(auth(owner)).field('userId', String(other._id))
    .attach('photo', photo, { filename: 'photo.png', contentType: 'image/png' });
  expect(res.status).toBe(200);
  expect(res.body.user.avatarUrl).toMatch(/^data:image\/jpeg;base64,/);
  const image = Buffer.from(res.body.user.avatarUrl.split(',')[1], 'base64');
  expect(await sharp(image).metadata()).toMatchObject({ format: 'jpeg', width: 256, height: 256 });
  expect((await User.findById(other._id)).avatarUrl).toBeUndefined();
  expect((await request(app).post('/api/users/avatar').attach('photo', photo, 'photo.png')).status).toBe(401);
});

test('spoofed, corrupt, missing and oversized photos are rejected without changing the saved photo', async () => {
  const before = (await User.findById(owner._id)).avatarUrl;
  for (const data of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), photo.subarray(0, 20)]) {
    const res = await request(app).post('/api/users/avatar').set(auth(owner)).attach('photo', data, { filename: 'photo.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  }
  expect((await request(app).post('/api/users/avatar').set(auth(owner))).status).toBe(400);
  expect((await request(app).post('/api/users/avatar').set(auth(owner)).attach('photo', Buffer.alloc(5 * 1024 * 1024 + 1), 'photo.jpg')).status).toBe(413);
  expect((await User.findById(owner._id)).avatarUrl).toBe(before);
});

test('new syllabus carries the account photo and DOCX embeds photo, logo, Arial, and page footer', async () => {
  const program = await Program.findOne({ code: 'MBA' });
  const created = await request(app).post('/api/syllabus').set(auth(owner)).send({ title: 'Brand verification', programId: String(program._id), programCode: 'MBA28' });
  expect(created.status).toBe(201);
  const syllabus = await Syllabus.findById(created.body.syllabus._id).lean();
  expect(syllabus.state.instructors[0].photo).toBe((await User.findById(owner._id)).avatarUrl);
  const zip = await JSZip.loadAsync(await renderSyllabusDocx(syllabus.state, await getRefs('MBA28')));
  expect(Object.keys(zip.files).filter(name => /^word\/media\/.+\.(jpg|png)$/.test(name))).toHaveLength(2);
  expect(await zip.file('word/document.xml').async('string')).toContain('Instructor photo');
  expect(await zip.file('word/header1.xml').async('string')).toContain('KSE Business School');
  expect(await zip.file('word/footer1.xml').async('string')).toContain('PAGE');
  const styles = await zip.file('word/styles.xml').async('string');
  expect(styles).toContain('Arial'); expect(styles).toContain('004641');
  expect((await request(app).delete('/api/users/avatar').set(auth(owner))).status).toBe(200);
  expect((await User.findById(owner._id)).avatarUrl).toBeUndefined();
});

test('English outcome labels are seeded, staff editable, preserved by reseeding, and leave official text intact', async () => {
  const url = '/api/references/MBA28/outcomes';
  const before = await request(app).get(url).set(auth(owner));
  const outcome = before.body[0];
  expect(outcome.label).toBe('Analytical toolkit');
  const editUrl = `${url}/${encodeURIComponent(outcome.code)}`;
  expect((await request(app).patch(editUrl).set(auth(owner)).send({ label: 'Not allowed' })).status).toBe(403);
  expect((await request(app).patch(editUrl).set(auth(manager)).send({ label: 'Tools for analysis' })).status).toBe(200);
  expect((await request(app).patch(editUrl).set(auth(manager)).send({ label: 'Tools', text: 'Changed' })).status).toBe(400);
  await seedReferences();
  const after = (await request(app).get(url).set(auth(owner))).body[0];
  expect(after).toMatchObject({ label: 'Tools for analysis', text: outcome.text });
});
