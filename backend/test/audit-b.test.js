// Регресійні тести за аудитом Codex частини B (07.11.2026): B04–B11. B01–B03 — у parse/mmm.test.js і mmm-tools.test.js.
jest.mock('../services/ai/client', () => ({ ...jest.requireActual('../services/ai/client'), createResponse: jest.fn() }));
const helpers = require('./helpers');
const request = require('supertest');
const app = require('../server');
const Program = require('../models/Program');
const references = require('../services/references');
const store = require('../services/syllabusState/store');
const { seedReferences } = require('../services/references/seed');
const { seedPolicyLibrary } = require('../services/references/policies');
const { createEmptyState } = require('../services/syllabusState/empty');
const { loadFixtureRefs } = require('../services/references/fixtureRefs');
const { writeSlot } = require('../services/chat/slotWrite');
const { validateState } = require('../services/syllabusState/schema');
const { candidates } = require('../services/ai/interviewPlan');
const { draftFromNarrative } = require('../services/ai/prompts/formulator');
const { createResponse } = require('../services/ai/client');

let auth; let mmm; let admin;
beforeAll(async () => {
  await helpers.connectDb();
  await Program.seedDefaults();
  await seedReferences();
  await seedPolicyLibrary();
  const lecturer = await helpers.createUser();
  admin = await helpers.createUser({ role: 'admin' });
  auth = { Authorization: `Bearer ${helpers.tokenFor(lecturer)}` };
  mmm = await Program.findOne({ code: 'MMM' });
});
afterAll(helpers.disconnectDb);
beforeEach(() => { references.invalidateCache(); createResponse.mockReset(); });

const createMmm = async () => (await request(app).post('/api/syllabus').set(auth).send({ title: 'Курс', programId: String(mmm._id), programCode: 'MMM26' })).body.syllabus._id;
const e = { source: 'instructor_directed', evidenceBlockIds: [] };

test('B04: розділ-текст програми й розділ поза профілем не затверджуються ні окремо, ні явним переліком', async () => {
  const id = await createMmm();
  const one = await request(app).post(`/api/chat/${id}/sections/pedagogical_approach/approve`).set(auth).send({});
  expect(one.status).toBe(409);
  expect(one.body.code).toBe('SECTION_NOT_APPROVABLE');
  const all = await request(app).post(`/api/chat/${id}/sections/approve-all`).set(auth).send({ sections: ['course_objectives'] });
  expect(all.status).toBe(200);
  expect(all.body.approved).toEqual([]);
  expect(all.body.skipped.map((x) => x.key)).toContain('course_objectives');
});

test('B05: зміна ПРН знімає затвердження «Зв\'язку з ПРН»; зміна гостя — розкладу', async () => {
  const id = await createMmm();
  const refs = await references.getRefs('MMM26');
  const [a, b] = refs.outcomes.map((o) => o.code);
  let { revision } = await store.getState(id);
  ({ revision } = await store.mutate(id, revision, (st) => {
    st.outcomes = [{ id: 'clo1', text: 'Аналізувати бренд', plo: [{ code: a, coverage: 'full', confirmed: true }], assessmentIds: [], ...e }];
    st.guests = [{ id: 'g1', name: 'Олена', company: null, topic: null, format: null, status: null, ...e }];
    st.sessions = [{ id: 's1', n: 1, topic: 'Вступ', type: null, hours: 2, format: null, guest: null, additional: null, date: null, time: null, moduleId: null, prep: null, deadline: null, guestId: 'g1', ...e }];
  }, { refs }));
  await store.approveSection(id, 'programme_outcomes', { expectedRevision: revision });
  await store.approveSection(id, 'schedule', {});
  ({ revision } = await store.getState(id));
  await store.mutate(id, revision, (st) => { st.outcomes[0].plo = [{ code: b, coverage: 'full', confirmed: true }]; st.guests[0].name = 'Ірина'; }, { refs });
  const { state } = await store.getState(id);
  expect(state.sections.programme_outcomes).toBeUndefined();
  expect(state.sections.schedule).toBeUndefined();
});

test('B07: поріг програми потрапляє в locked-текст нових силабусів, і перевірка не сперечається з ним', async () => {
  await request(app).put(`/api/cabinet/programs/${mmm._id}`).set({ Authorization: `Bearer ${helpers.tokenFor(admin)}` }).send({ passingScore: 50 }).expect(200);
  const id = await createMmm();
  const { state } = await store.getState(id);
  expect(state.policies.find((p) => p.key === 'policy.passing').text).toMatch(/щонайменше 50 зі 100/);
  const view = await request(app).get(`/api/chat/${id}`).set(auth);
  expect(view.body.checks.filter((c) => c.id === 'regulations.passing_score' && c.passed === false)).toEqual([]);
  await Program.updateOne({ _id: mmm._id }, { $set: { passingScore: null } });
});

test('B08: новий текстовий слот записується в старий стан без цього ключа', () => {
  const refs = loadFixtureRefs('MMM26');
  const old = createEmptyState({ programCode: 'MMM26', refs, language: 'uk' });
  delete old.summary.practicalApplication;
  expect(validateState(old)).toEqual([]);
  const next = writeSlot(old, 'summary.practicalApplication', 'Учасники проводять аудит бренду своєї компанії.', { source: 'ai_draft' });
  expect(validateState(next)).toEqual([]);
});

test('B09: обов\'язкове «Практичне застосування» MMM є серед кандидатів інтерв\'ю', () => {
  const refs = loadFixtureRefs('MMM26');
  const state = createEmptyState({ programCode: 'MMM26', refs, language: 'uk' });
  expect(candidates({ state, refs }).map((s) => s.key)).toContain('course.practical_application');
  expect(candidates({ state: createEmptyState({ refs: loadFixtureRefs('MBA28') }), refs: loadFixtureRefs('MBA28') }).map((s) => s.key)).not.toContain('course.practical_application');
});

test('B10: Capstone MMM без каталогу критеріїв чернеткується текстом із criteriaKeys: []', async () => {
  const refs = await references.getRefs('MMM26');
  expect(refs.capstone.criteria || []).toHaveLength(0);
  createResponse.mockResolvedValue({ output_text: JSON.stringify({ drafts: [{ slotKey: 'course.capstone', text: 'Напрацювання курсу ви використаєте у своєму фінальному проєкті. Аудит бренду стане розділом стратегії.', criteriaKeys: [], proposedValues: [], rationale: 'From the story.' }] }) });
  const state = createEmptyState({ programCode: 'MMM26', refs, language: 'uk' });
  const drafts = await draftFromNarrative({ state, refs, narrative: 'Курс допомагає зібрати дані клієнтів для Capstone.', slotKeys: ['course.capstone'] });
  expect(drafts).toHaveLength(1);
  expect(createResponse.mock.calls[0][0].input[0].content).toMatch(/no Capstone criteria catalog/);
});

test('B11: компонент, названий на рівні модуля, знаходиться в розкладі', () => {
  const { matchComponentsToSchedule } = require('../services/checks/llm');
  const state = { modules: [{ id: 'm1', title: 'Фінальний проєкт' }], sessions: [{ id: 's1', n: 1, topic: 'Захист робіт', moduleId: 'm1' }], assessments: [{ id: 'as1', name: 'Фінальний проєкт' }] };
  expect(matchComponentsToSchedule(state).unmatched).toEqual([]);
});
