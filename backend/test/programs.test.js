// Програми й набори без хардкоду: набори керуються через API, довідники нового набору копіюються з наявного,
// дані першого запуску — fixtures/reference/programs.json і capstone.criteria.json (programCodes).
const request = require('supertest');
const helpers = require('./helpers');
const app = require('../server');
const Program = require('../models/Program');
const Syllabus = require('../models/Syllabus');
const ProgramOutcome = require('../models/ProgramOutcome');
const CapstoneGuide = require('../models/CapstoneGuide');
const OutcomeMapping = require('../models/OutcomeMapping');
const references = require('../services/references');
const { seedReferences } = require('../services/references/seed');
const { readFixture } = require('../services/references/fixtureRefs');

let admin; let lecturer; let mba;
const bearer = (user) => ({ Authorization: `Bearer ${helpers.tokenFor(user)}` });
const editionsOf = async (code) => (await Program.findOne({ code }).lean()).editions.map((e) => e.code);
const putEditions = (program, editions, user = admin) => request(app).put(`/api/cabinet/programs/${program._id}`).set(bearer(user)).send({ editions });

beforeAll(async () => {
  await helpers.connectDb();
  await Program.seedDefaults();
  await seedReferences();
  admin = await helpers.createUser({ role: 'admin' });
  lecturer = await helpers.createUser();
  mba = await Program.findOne({ code: 'MBA' });
});
afterAll(helpers.disconnectDb);
beforeEach(() => references.invalidateCache());

test('сід бере програми, набори Capstone і мапінги ПРН з фікстур', async () => {
  const fixture = readFixture('programs.json').programs;
  expect((await Program.find({}).lean()).map((p) => p.code).sort()).toEqual(fixture.map((p) => p.code).sort());
  const capstoneCodes = readFixture('capstone.criteria.json').programCodes;
  expect((await CapstoneGuide.find({}).lean()).map((g) => g.programCode).sort()).toEqual([...capstoneCodes].sort());
  const mapping = readFixture('learning-outcomes.json').mappings[0];
  expect(await OutcomeMapping.findOne({ from: mapping.from, to: mapping.to }).lean()).toMatchObject({ pairs: expect.any(Array) });
});

test('новий набір MBA29 з копією довідників MBA28: ПРН, курси, Capstone; силабус для MBA29 створюється', async () => {
  const res = await putEditions(mba, [{ code: 'MBA27', label: 'MBA27' }, { code: 'MBA28', label: 'MBA28' }, { code: 'mba29', label: 'MBA29 (2027-28 intake)', copyFrom: 'MBA28' }]);
  expect(res.status).toBe(200);
  expect(res.body.editions.map((e) => e.code)).toEqual(['MBA27', 'MBA28', 'MBA29']);
  const src = await references.getRefs('MBA28');
  const dst = await references.getRefs('MBA29');
  expect(dst.outcomes.map((o) => o.code)).toEqual(src.outcomes.map((o) => o.code));
  expect(dst.coreCourses.map((c) => c.code)).toEqual(src.coreCourses.map((c) => c.code));
  expect(dst.capstone.criteria).toEqual(src.capstone.criteria);
  expect(res.body.copied.MBA29.outcomes).toBe(src.outcomes.length);
  // Копія незалежна: зміна мітки MBA29 не чіпає MBA28
  await ProgramOutcome.updateOne({ programCode: 'MBA29', code: src.outcomes[0].code }, { $set: { label: 'Changed' } });
  expect((await ProgramOutcome.findOne({ programCode: 'MBA28', code: src.outcomes[0].code }).lean()).label).not.toBe('Changed');

  const created = await request(app).post('/api/syllabus').set(bearer(lecturer)).send({ title: 'New intake course', programId: String(mba._id), programCode: 'MBA29' });
  expect(created.status).toBe(201);
  expect(created.body.syllabus.programCode).toBe('MBA29');
});

test('інша програма з власними наборами (EMBA25) — без правок коду', async () => {
  const emba = await Program.findOne({ code: 'EMBA' });
  const res = await putEditions(emba, [{ code: 'EMBA25', label: 'EMBA25' }]);
  expect(res.status).toBe(200);
  const list = await request(app).get('/api/references/programs').set(bearer(lecturer));
  expect(list.body.find((p) => p.code === 'EMBA').editions.map((e) => e.code)).toEqual(['EMBA25']);
  const created = await request(app).post('/api/syllabus').set(bearer(lecturer)).send({ title: 'Exec course', programId: String(emba._id), programCode: 'EMBA25' });
  expect(created.status).toBe(201);
  // Новий набір без довідників: ПРН порожні, тип курсу — elective, нічого не ламається
  expect((await references.getRefs('EMBA25')).outcomes).toEqual([]);
});

test('набір із силабусами не прибирається; код не може належати двом програмам; некоректний код → 400', async () => {
  await Syllabus.create({ title: 'Uses MBA27', instructor: lecturer._id, programId: mba._id, programCode: 'MBA27', status: 'in_progress' });
  const inUse = await putEditions(mba, [{ code: 'MBA28' }, { code: 'MBA29' }]);
  expect(inUse.status).toBe(409);
  expect(inUse.body).toMatchObject({ code: 'EDITION_IN_USE', edition: 'MBA27', syllabi: 1 });
  expect(await editionsOf('MBA')).toContain('MBA27');

  const corporate = await Program.findOne({ code: 'CORPORATE' });
  const taken = await putEditions(corporate, [{ code: 'MBA28' }]);
  expect(taken.status).toBe(409);
  expect(taken.body.code).toBe('EDITION_CODE_TAKEN');
  expect((await putEditions(corporate, [{ code: 'bad code!' }])).body.code).toBe('INVALID_EDITION_CODE');
  expect((await putEditions(corporate, [{ code: 'C1' }, { code: 'c1' }])).body.code).toBe('DUPLICATE_EDITION');
  expect((await putEditions(corporate, [{ code: 'C1', copyFrom: 'NOPE' }])).body.code).toBe('UNKNOWN_PROGRAM_CODE');
  expect((await putEditions(corporate, [{ code: 'C1' }], lecturer)).status).toBe(403);
});

test('невикористаний набір прибирається, і сід після рестарту його не повертає', async () => {
  const intensive = await Program.findOne({ code: 'INTENSIVE' });
  expect((await putEditions(intensive, [{ code: 'INT1' }, { code: 'INT2' }])).status).toBe(200);
  expect((await putEditions(intensive, [{ code: 'INT2' }])).status).toBe(200);
  await Program.seedDefaults();
  expect(await editionsOf('INTENSIVE')).toEqual(['INT2']);
});

test('нова програма з наборами одним запитом; код програми не збігається з чужим набором', async () => {
  const res = await request(app).post('/api/cabinet/programs').set(bearer(admin))
    .send({ name: 'Global MBA', code: 'GMBA', editions: [{ code: 'GMBA1', label: 'GMBA first intake', copyFrom: 'MBA28' }] });
  expect(res.status).toBe(201);
  expect(res.body.editions.map((e) => e.code)).toEqual(['GMBA1']);
  expect((await references.getRefs('GMBA1')).outcomes.length).toBeGreaterThan(0);
  const clash = await request(app).post('/api/cabinet/programs').set(bearer(admin)).send({ name: 'X', code: 'MBA28' });
  expect(clash.status).toBe(409);
  expect(await Program.exists({ code: 'MBA28' })).toBeNull();
  const badEdition = await request(app).post('/api/cabinet/programs').set(bearer(admin)).send({ name: 'Y', code: 'YPROG', editions: [{ code: 'MBA27' }] });
  expect(badEdition.status).toBe(409);
  expect(await Program.exists({ code: 'YPROG' })).toBeNull();
});
