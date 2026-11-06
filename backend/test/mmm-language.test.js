// Друга програма (MMM) і мова документа (вимоги 06.11: B-8.1, B-1.1, B-1.4): дані програми з фікстур,
// мова нового силабуса з програми, тексти довідника політик мовою документа.
const helpers = require('./helpers');
const request = require('supertest');
const app = require('../server');
const Program = require('../models/Program');
const Policy = require('../models/Policy');
const references = require('../services/references');
const store = require('../services/syllabusState/store');
const { seedReferences } = require('../services/references/seed');
const { seedPolicyLibrary } = require('../services/references/policies');
const { renderState } = require('../services/syllabusState/render');
const { readFixture } = require('../services/references/fixtureRefs');

let lecturer; let auth; let mmm; let mba;
const library = readFixture('policies.library.json');
const attendance = library.blocks.find((b) => b.key === 'policy.attendance');
const absence = library.blocks.find((b) => b.key === 'policy.absence');

beforeAll(async () => {
  await helpers.connectDb();
  await Program.seedDefaults();
  await seedReferences();
  await seedPolicyLibrary();
  lecturer = await helpers.createUser();
  auth = { Authorization: `Bearer ${helpers.tokenFor(lecturer)}` };
  mmm = await Program.findOne({ code: 'MMM' });
  mba = await Program.findOne({ code: 'MBA' });
});
afterAll(helpers.disconnectDb);
beforeEach(() => references.invalidateCache());

const create = (program, programCode, title = 'Course') => request(app).post('/api/syllabus').set(auth)
  .send({ title, programId: String(program._id), programCode });

describe('B-8.1 — програма MMM з даних', () => {
  test('MMM/MMM26 з\'являється із сіду; ПРН і нормативні курси — з окремих файлів фікстур', async () => {
    expect(mmm).toMatchObject({ defaultLanguage: 'uk' });
    expect(mmm.editions.map((e) => e.code)).toEqual(['MMM26']);
    const refs = await references.getRefs('MMM26');
    expect(refs.outcomes).toHaveLength(8);
    expect(refs.outcomes.every((o) => o.label)).toBe(true);
    expect(refs.coreCourses).toHaveLength(14);
    // Дані MBA не змінились
    expect((await references.getRefs('MBA28')).outcomes.length).toBeGreaterThan(0);
  });
});

describe('B-1.1 / B-1.4 — мова документа й двомовний довідник', () => {
  test('довідник v2 зберігає українські тексти й статус перевірки', async () => {
    const doc = await Policy.findOne({ key: 'policy.attendance' }).lean();
    expect(doc.options[0]).toMatchObject({ labelUk: expect.any(String), textUk: expect.any(String), status: { uk: 'machine' } });
    expect((await Policy.findOne({ key: 'policy.absence' }).lean()).textUk).toBe(absence.textUk);
  });

  test('новий силабус MMM — українською (locked-політики українською), MBA — англійською', async () => {
    const uk = await create(mmm, 'MMM26');
    expect(uk.status).toBe(201);
    const { state } = await store.getState(uk.body.syllabus._id);
    expect(state.language).toBe('uk');
    expect(state.policies.find((p) => p.key === 'policy.absence').text).toBe(absence.textUk);

    const en = await create(mba, 'MBA28');
    const { state: enState } = await store.getState(en.body.syllabus._id);
    expect(enState.language).toBe('en');
    expect(enState.policies.find((p) => p.key === 'policy.absence').text).toBe(absence.text);
  });

  test('обраний варіант політики в українському силабусі — українською, і в стані, і в рендері', async () => {
    const res = await create(mmm, 'MMM26', 'Policy choice');
    const id = res.body.syllabus._id;
    const option = attendance.options[0];
    const chosen = await request(app).post(`/api/chat/${id}/policies/policy.attendance/choose`).set(auth).send({ optionKey: option.key });
    expect(chosen.status).toBe(200);
    const { state } = await store.getState(id);
    expect(state.policies.find((p) => p.key === 'policy.attendance').text).toBe(option.textUk);
    const refs = await references.getRefs('MMM26');
    const policies = renderState(state, refs).sections.find((s) => s.key === 'policies');
    const text = JSON.stringify(policies);
    expect(text).toContain(attendance.titleUk);
    expect(text).toContain(option.textUk);
  });
});
