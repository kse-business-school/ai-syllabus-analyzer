// Регресійні тести за аудитом v5 від 04.11.2026 (docs/AUDIT_V5_2026-11-04.md): A04, A05, A06, A07, A09.
// LLM мокається (services/ai/client.createResponse); парсер отримує підмінені залежності.
jest.mock('../services/ai/client', () => ({ ...jest.requireActual('../services/ai/client'), createResponse: jest.fn() }));
const request = require('supertest');
const helpers = require('./helpers');
const app = require('../server');
const Program = require('../models/Program');
const Syllabus = require('../models/Syllabus');
const CourseOffering = require('../models/CourseOffering');
const store = require('../services/syllabusState/store');
const references = require('../services/references');
const { seedReferences } = require('../services/references/seed');
const { parseToState } = require('../services/ai/parse');
const { policiesFromRefs } = require('../services/syllabusState/empty');
const { slots: parseSlots, refs: fixtureRefs } = require('./parse/fixtures');
const ploCheck = require('../services/checks/plo');
const { ploConfirmCards } = require('../services/ai/parse/cards');
const { scanFacts } = require('../services/ai/facts');
const { createResponse } = require('../services/ai/client');
const { createDraftSuggestions } = require('../services/chat/draftSuggestions');
const { riskManagementState } = require('./fixtures/state/riskManagement');

let mba; let lecturer; let other; let director;
const bearer = (user) => ({ Authorization: `Bearer ${helpers.tokenFor(user)}` });

beforeAll(async () => {
  await helpers.connectDb();
  await Program.seedDefaults();
  await seedReferences();
  await Syllabus.syncIndexes();
  mba = await Program.findOne({ code: 'MBA' });
  lecturer = await helpers.createUser();
  other = await helpers.createUser();
  director = await helpers.createUser({ role: 'director' });
});
afterAll(helpers.disconnectDb);
beforeEach(() => references.invalidateCache());

const create = (user, body) => request(app).post('/api/syllabus').set(bearer(user)).send({ programId: String(mba._id), ...body });

describe('A04 · силабус належить призначенню курс × набір', () => {
  test('без offeringId призначення знаходиться за кодом: чужий курс → 403, свій → прив\'язка, повтор → 409', async () => {
    const offering = await CourseOffering.create({ programCode: 'MBA28', courseCode: 'AUD.1', type: 'core', lecturerId: lecturer._id });
    const foreign = await create(other, { title: 'Audit course', programCode: 'MBA28', courseCode: 'aud.1' });
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('OFFERING_FORBIDDEN');

    const own = await create(lecturer, { title: 'Audit course', programCode: 'MBA28', courseCode: ' AUD.1 ' });
    expect(own.status).toBe(201);
    const saved = await Syllabus.findById(own.body.syllabus._id).lean();
    expect(String(saved.offeringId)).toBe(String(offering._id));
    expect(saved.course.code).toBe('AUD.1');

    const dup = await create(lecturer, { title: 'Audit course again', programCode: 'MBA28', courseCode: 'AUD.1' });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'OFFERING_TAKEN', syllabusId: String(saved._id) });
    const withId = await create(lecturer, { title: 'Audit course again', programCode: 'MBA28', offeringId: String(offering._id) });
    expect(withId.status).toBe(409);
  });

  test('код курсу прив\'язаного силабуса не змінюється через PUT', async () => {
    await CourseOffering.create({ programCode: 'MBA28', courseCode: 'AUD.2', type: 'elective', lecturerId: lecturer._id });
    const res = await create(lecturer, { title: 'Second', programCode: 'MBA28', courseCode: 'AUD.2' });
    const put = await request(app).put(`/api/syllabus/${res.body.syllabus._id}`).set(bearer(lecturer)).send({ courseCode: 'OTHER.9' });
    expect(put.status).toBe(400);
    expect(put.body.code).toBe('OFFERING_COURSE_LOCKED');
  });

  test('курс без призначення створюється як і раніше (без offeringId)', async () => {
    const res = await create(other, { title: 'Free elective', programCode: 'MBA28', courseCode: 'FREE.1' });
    expect(res.status).toBe(201);
    expect((await Syllabus.findById(res.body.syllabus._id).lean()).offeringId).toBeUndefined();
  });
});

describe('A05 · трек 2 бере код курсу з призначення або форми', () => {
  function depsFor(s, r) {
    return {
      extractSlots: jest.fn(async () => ({ slots: s, warnings: [] })),
      matchPolicies: jest.fn(async () => ({ policies: policiesFromRefs(r), matches: [], lockedNotes: [] })),
      courseKind: jest.fn(async () => ({ kind: 'elective', matchedBy: null, course: null })),
    };
  }

  test('у файлі коду немає → код із форми; призначення має пріоритет над файлом', async () => {
    const r = { ...fixtureRefs('MBA28'), offeringTypes: { 'AUDIT-CORE': 'core' } };
    const s = parseSlots();
    s.header.code = null;
    const fromForm = await parseToState({ blocks: [], programCode: 'MBA28', refs: r, course: { title: 'X', code: 'AUDIT-CORE' } }, depsFor(s, r));
    expect(fromForm.state.header).toMatchObject({ courseCode: 'AUDIT-CORE', courseKind: 'core' });

    const s2 = parseSlots();
    s2.header.code = 'FILE.1';
    const fromOffering = await parseToState({ blocks: [], programCode: 'MBA28', refs: r, course: { code: 'AUDIT-CORE', fromOffering: true } }, depsFor(s2, r));
    expect(fromOffering.state.header.courseCode).toBe('AUDIT-CORE');
    const fileWins = await parseToState({ blocks: [], programCode: 'MBA28', refs: r, course: { code: 'AUDIT-CORE' } }, depsFor(s2, r));
    expect(fileWins.state.header.courseCode).toBe('FILE.1');
  });
});

describe('A06 · зміна типу призначення доходить до стану силабусів', () => {
  test('PUT core → elective: кеш скинуто, courseKind перераховано, затвердження At a Glance знято', async () => {
    const created = await request(app).post('/api/cabinet/offerings').set(bearer(director))
      .send({ programCode: 'MBA28', courseCode: 'SYNC.1', type: 'core', lecturerId: String(lecturer._id) });
    expect(created.status).toBe(201);
    const res = await create(lecturer, { title: 'Sync course', programCode: 'MBA28', courseCode: 'SYNC.1' });
    const id = res.body.syllabus._id;
    let { state, revision } = await store.getState(id);
    expect(state.header.courseKind).toBe('core');
    await Syllabus.updateOne({ _id: id }, { $set: { 'state.sections.at_a_glance': { approved: true } } });

    const put = await request(app).put(`/api/cabinet/offerings/${created.body._id}`).set(bearer(director)).send({ type: 'elective' });
    expect(put.status).toBe(200);
    expect((await references.getRefs('MBA28')).offeringTypes['SYNC.1']).toBe('elective');
    ({ state } = await store.getState(id));
    expect(state.header.courseKind).toBe('elective');
    expect(state.sections.at_a_glance).toBeUndefined();
    expect((await store.getState(id)).revision).toBeGreaterThan(revision);
  });
});

describe('A07 · непідтверджені зв\'язки CLO → PLO не зараховуються', () => {
  const refs = fixtureRefs('MBA28');
  const code = refs.outcomes[0].code;
  const stateWith = (confirmed) => ({
    programCode: 'MBA28',
    header: { courseKind: 'core', courseTitle: 'Core course' },
    outcomes: [{ id: 'clo1', text: 'Apply', plo: [{ code, coverage: 'full', confirmed }], assessmentIds: [] }],
  });

  test('confirmed: false → core-перевірка не пройдена; confirmed: true → пройдена', () => {
    const pending = ploCheck.run(stateWith(false), refs).find((c) => c.id.startsWith('plo.coverage'));
    expect(pending.passed).toBe(false);
    expect(pending.message).toMatch(/waiting for your confirmation/);
    const confirmed = ploCheck.run(stateWith(true), refs).find((c) => c.id.startsWith('plo.coverage'));
    expect(confirmed.passed).toBe(true);
  });

  test('трек 2: картка підтвердження зв\'язків із файлу', () => {
    const cards = ploConfirmCards(stateWith(false), refs);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'edit', target: { path: 'outcomes[clo1].plo' } });
    expect(ploConfirmCards(stateWith(true), refs)).toEqual([]);
  });
});

describe('A09 · сканер фактів зіставляє число з одиницею', () => {
  test('«48 students» не робить відомим «48 hours»', () => {
    expect(scanFacts('The assignment deadline is 48 hours.', { known: ['We have 48 students'] }).map((f) => f.value)).toEqual(['48 hours']);
    expect(scanFacts('The assignment deadline is 48 hours.', { known: ['students get 48 hours'] })).toEqual([]);
    expect(scanFacts('Each session lasts 2 hours.', { known: ['two-hour sessions'] })).toEqual([]);
    expect(scanFacts('Weight: 30%.', { known: ['session 30'] }).map((f) => f.value)).toEqual(['30%']);
    expect(scanFacts('Due December 1, 2026.', { known: ['due Dec 1'] }).map((f) => f.value)).toEqual(['December 1, 2026']);
    expect(scanFacts('Due December 1.', { known: ['the deadline is 2026-12-01'] })).toEqual([]);
  });
});

describe('A03 · відповідь на картку-питання стає чернеткою за типом цілі', () => {
  const refs = fixtureRefs('MBA28');
  const item = (fields) => ({
    id: null, label: '', hours: null, weight: null, type: null, format: null, date: null, time: null, deadline: null, criteria: null, guest: null, url: null, group: null, ...fields,
  });
  /** Оркестратор-скрипт: один виклик інструмента, потім текстова відповідь. */
  const scriptTool = (name, args) => createResponse.mockImplementation(async (req) => {
    if (req.input.some((i) => i.type === 'function_call_output')) return { output_text: 'The draft is on a card.', output: [] };
    return { output: [{ type: 'function_call', call_id: 'c1', name, arguments: JSON.stringify(args) }] };
  });

  async function syllabusWithQuestion(target, question) {
    const s = await helpers.createSyllabus(lecturer, { programCode: 'MBA28', track: 'upload' });
    await store.initState(s._id, riskManagementState(), { refs });
    const { state } = await store.getState(s._id);
    const [q] = await createDraftSuggestions([{
      origin: 'check', checkId: 'assessment.participation', severity: 'high', kind: 'question', title: 'Participation weight',
      description: question, question, target,
    }], { syllabusId: s._id, state, refs, known: [] });
    return { s, q };
  }
  const answer = (s, q, text) => request(app).post(`/api/chat/${s._id}/suggestions/${q._id}/answer`).set(bearer(lecturer)).send({ answer: text });

  beforeEach(() => createResponse.mockReset());

  test('вага компонента: «The weight is 30 percent.» → картка-чернетка → Confirm → weight 30', async () => {
    const { s, q } = await syllabusWithQuestion({ path: 'assessments[as1].weight', entityId: 'as1' }, 'Class participation is 35%; the maximum is 30%. What weight should it have?');
    scriptTool('propose_items', { key: 'assessment.components', mode: 'append', items: [item({ id: 'as1', weight: 30 })] });
    const res = await answer(s, q, 'The weight is 30 percent.');
    expect(res.status).toBe(200);
    const view = res.body.suggestions.find((v) => v.id === String(q._id));
    expect(view).toMatchObject({ kind: 'edit', status: 'pending', answer: 'The weight is 30 percent.', target: { path: 'assessments[]' } });
    expect(view.draft.value.find((a) => a.id === 'as1').weight).toBe(30);
    expect(view.draft.proposedValues).toEqual([]); // 30 percent назвав сам викладач
    // Дубль картки оркестратора не лишається; оркестратор отримав контекст картки
    expect(res.body.suggestions.filter((v) => v.target.path === 'assessments[]' && v.status === 'pending')).toHaveLength(1);
    expect(createResponse.mock.calls[0][0].input.some((i) => i.role === 'system' && /answering a question card/.test(i.content))).toBe(true);
    const accepted = await request(app).post(`/api/chat/${s._id}/suggestions/${q._id}/accept`).set(bearer(lecturer)).send({});
    expect(accepted.status).toBe(200);
    expect((await store.getState(s._id)).state.assessments.find((a) => a.id === 'as1').weight).toBe(30);
  });

  test('вигадане значення не обходить підтвердження: «lower it» → weight 25 як proposedValue; Change the value → 20', async () => {
    const { s, q } = await syllabusWithQuestion({ path: 'assessments[as1].weight', entityId: 'as1' }, 'What weight should participation have?');
    scriptTool('propose_items', { key: 'assessment.components', mode: 'append', items: [item({ id: 'as1', weight: 25 })] });
    const res = await answer(s, q, 'Please lower it a bit.');
    const view = res.body.suggestions.find((v) => v.id === String(q._id));
    expect(view.draft.proposedValues).toMatchObject([{ value: '25', path: '[as1].weight', confirmed: false }]);
    const pv = view.draft.proposedValues[0];
    const changed = await request(app).post(`/api/chat/${s._id}/suggestions/${q._id}/values`).set(bearer(lecturer))
      .send({ values: [{ id: pv.id, value: '20', confirmed: true }] });
    expect(changed.status).toBe(200);
    expect(changed.body.suggestions.find((v) => v.id === String(q._id)).draft.value.find((a) => a.id === 'as1').weight).toBe(20);
    expect((await request(app).post(`/api/chat/${s._id}/suggestions/${q._id}/accept`).set(bearer(lecturer)).send({})).status).toBe(200);
    expect((await store.getState(s._id)).state.assessments.find((a) => a.id === 'as1').weight).toBe(20);
  });

  test('скаляр, названий дослівно: set_slot пише значення, питання закрите', async () => {
    const { s, q } = await syllabusWithQuestion({ path: 'header.ects', section: 'at_a_glance' }, 'How many ECTS credits does the course have?');
    scriptTool('set_slot', { key: 'glance.ects', value: 6 });
    const res = await answer(s, q, 'It is 6 ECTS.');
    expect(res.status).toBe(200);
    expect(res.body.suggestions.find((v) => v.id === String(q._id)).status).toBe('accepted');
    expect((await store.getState(s._id)).state.header.ects).toBe(6);
  });

  test('питання про політику → вибір: дослівна відповідь викладача або варіант довідника, без дефолту', async () => {
    const { s, q } = await syllabusWithQuestion({ path: 'policies{policy.attendance}', section: 'policies' }, 'How should attendance work?');
    const res = await answer(s, q, 'Students may miss two sessions without penalty.');
    expect(createResponse).not.toHaveBeenCalled();
    const view = res.body.suggestions.find((v) => v.id === String(q._id));
    expect(view.kind).toBe('choice');
    expect(view.options[0]).toMatchObject({ id: 'answer', value: 'Students may miss two sessions without penalty.' });
    expect(view.options.length).toBeGreaterThan(1);
  });

  test('профіль викладача: propose_instructor → картка, email не з репліки → proposedValue', async () => {
    const { s, q } = await syllabusWithQuestion({ path: 'instructors[]', section: 'instructor' }, 'What are your office hours?');
    scriptTool('propose_instructor', {
      name: null, position: null, email: 'o.gromyko@kse.org.ua', office_hours: 'Wednesdays 18:00-19:00', assistants: null, expertise: null, education: null, experience: null,
    });
    const res = await answer(s, q, 'Office hours on Wednesdays 18:00-19:00.');
    const view = res.body.suggestions.find((v) => v.id === String(q._id));
    expect(view.kind).toBe('edit');
    expect(view.draft.value[0]).toMatchObject({ name: 'Oleksii Gromyko', officeHours: 'Wednesdays 18:00-19:00', email: 'o.gromyko@kse.org.ua' });
    expect(view.draft.proposedValues.map((v) => v.value)).toEqual(['o.gromyko@kse.org.ua']);
  });
});
