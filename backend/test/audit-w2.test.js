// Регресійні тести виправлень аудиту W2 (docs/AUDIT_W2.md): серверні репліки не є словами викладача (M1/M2),
// корпус «відомого» без id (M2), неперевірені URL у чернетках (M4) і дрібні m4, m6, m7, m9–m12.
// LLM-модулі замокано, як у chat.test.js.
jest.mock('../services/ai/prompts/formulator', () => ({ reword: jest.fn(), draftFromNarrative: jest.fn() }));
jest.mock('../services/ai/client', () => ({ ...jest.requireActual('../services/ai/client'), createResponse: jest.fn() }));
jest.mock('../services/ai/tools/runner', () => ({ runOrchestratorTurn: jest.fn() }));
jest.mock('../services/ai/prompts/interviewer', () => ({ nextQuestion: jest.fn() }));

const request = require('supertest');
const mongoose = require('mongoose');
const helpers = require('./helpers');
const app = require('../server');
const formulator = require('../services/ai/prompts/formulator');
const runner = require('../services/ai/tools/runner');
const interviewer = require('../services/ai/prompts/interviewer');
const Syllabus = require('../models/Syllabus');
const Suggestion = require('../models/Suggestion');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const SlotChange = require('../models/SlotChange');
const store = require('../services/syllabusState/store');
const flow = require('../services/chat/flow');
const { createEmptyState } = require('../services/syllabusState/empty');
const { sectionGaps } = require('../services/syllabusState/slots');
const { loadFixtureRefs } = require('../services/references/fixtureRefs');
const { seedReferences } = require('../services/references/seed');
const { createDraftSuggestions, buildDraftSuggestion, SOURCE_NOT_CONFIRMED } = require('../services/chat/draftSuggestions');
const { readableText } = require('../services/chat/known');
const { candidates } = require('../services/ai/interviewPlan');
const { numbersOf, scanFacts } = require('../services/ai/facts');
const { removeOutputDir } = require('../services/outputs');
const { riskManagementState } = require('./fixtures/state/riskManagement');

const refs = loadFixtureRefs('MBA28');
const notImplemented = () => Object.assign(new Error('not implemented'), { statusCode: 501, code: 'NOT_IMPLEMENTED' });

let owner;
let stranger;
const created = [];

const authOf = (user) => ({ Authorization: `Bearer ${helpers.tokenFor(user)}` });
const chat = (s) => `/api/chat/${s._id}`;
const post = (s, path, body = {}, user = owner) => request(app).post(`${chat(s)}${path}`).set(authOf(user)).send(body);
const get = (s, path = '', user = owner) => request(app).get(`${chat(s)}${path}`).set(authOf(user));

async function uploaded(extra = {}) {
  const s = await helpers.createSyllabus(owner, { programCode: 'MBA28', track: 'upload', ...extra });
  await store.initState(s._id, riskManagementState(), { refs });
  created.push(s._id);
  return Syllabus.findById(s._id);
}

async function scratch() {
  const s = await helpers.createSyllabus(owner, { programCode: 'MBA28', track: 'scratch', title: 'Negotiations' });
  // At a Glance уже заповнено: сценарії перевіряють розмову після блоку At a Glance (B-3.6 — окремий тест)
  const initial = createEmptyState({ programCode: 'MBA28', track: 'scratch', refs, course: { title: 'Negotiations' } });
  initial.header = { ...initial.header, deliveryFormat: 'offline', ects: 3 };
  await store.initState(s._id, initial, { refs });
  created.push(s._id);
  return Syllabus.findById(s._id);
}

async function card(s, input = {}) {
  const { state } = await store.getState(s._id);
  const [doc] = await createDraftSuggestions([{
    origin: 'reviewer', severity: 'medium', kind: 'edit', title: 'Rewrite the short description',
    description: 'The description is too generic.', rationale: 'Needs concrete topics.',
    target: { path: 'summary.shortDescription' },
    text: 'This course teaches students to identify, assess and monitor project risks.',
    ...input,
  }], { syllabusId: s._id, state, refs, known: [] });
  return doc;
}

beforeAll(async () => {
  await helpers.connectDb();
  await seedReferences();
  owner = await helpers.createUser();
  stranger = await helpers.createUser();
});

afterAll(async () => {
  for (const id of created) await removeOutputDir(id);
  await helpers.disconnectDb();
});

beforeEach(() => {
  jest.clearAllMocks();
  interviewer.nextQuestion.mockRejectedValue(notImplemented());
});

describe('M1/M2: серверні репліки від імені викладача', () => {
  test('Confirmed/Cancelled/Back to — origin: server; транскрипт для LLM і корпус фактів їх не містять', async () => {
    const s = await uploaded();
    const a = await card(s, { title: 'Require 70% attendance', target: { path: 'summary.capstone' }, text: 'Connects the course to the capstone project.' });
    const b = await card(s);
    expect((await post(s, `/suggestions/${a._id}/accept`)).status).toBe(200);
    const conversation = await Conversation.findOne({ syllabusId: s._id });
    const confirmed = await Message.findOne({ conversationId: conversation._id, content: 'Confirmed: Require 70% attendance' }).lean();
    expect(confirmed).toMatchObject({ role: 'user', origin: 'server' });
    expect((await Message.findOne({ conversationId: conversation._id, role: 'ai' }).lean()).origin).toBeUndefined();

    const { transcript, instructorLines } = await flow.transcriptOf(conversation);
    expect(transcript.join('\n')).not.toContain('Confirmed:');
    expect(instructorLines).toEqual([]);

    // «70%» з заголовка підтвердженої картки не легалізується: у новій чернетці це факт на підтвердження
    formulator.reword.mockResolvedValue({ text: 'Students must attend 70% of the classes to pass.', proposedValues: [] });
    const res = await post(s, `/suggestions/${b._id}/refine`, { feedback: 'Make it stricter' });
    expect(res.status).toBe(200);
    expect(formulator.reword.mock.calls[0][0].transcript.join('\n')).not.toContain('Confirmed:');
    const view = res.body.suggestions.find((x) => x.id === String(b._id));
    expect(view.draft.proposedValues.map((v) => v.value)).toContain('70%');
    // Відгук Reword — справжня репліка викладача
    expect(await Message.findOne({ conversationId: conversation._id, content: 'Make it stricter' }).lean()).toMatchObject({ role: 'user', origin: 'instructor' });
  });

  test('/message: історія ходу оркестратора без серверних реплік', async () => {
    const s = await uploaded();
    const a = await card(s);
    await post(s, `/suggestions/${a._id}/reject`, {});
    runner.runOrchestratorTurn.mockResolvedValue({ reply: 'Sure.', createdSuggestionIds: [], stateChanged: false, currentSlotKey: null });
    expect((await post(s, '/message', { text: 'Write the late policy please' })).status).toBe(200);
    const { messages } = runner.runOrchestratorTurn.mock.calls[0][0];
    expect(messages.some((m) => m.origin === 'server' || /^Cancelled:/.test(m.content))).toBe(false);
    expect(messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['Write the late policy please']);
  });

  test('Skip (трек 1) — серверна репліка', async () => {
    const s = await scratch();
    await post(s, '/start');
    const slotKey = (await Conversation.findOne({ syllabusId: s._id })).currentSlotKey;
    expect((await post(s, '/skip', { slotKey })).status).toBe(200);
    const skip = await Message.findOne({ content: /^Skip: / }).sort({ _id: -1 }).lean();
    expect(skip).toMatchObject({ role: 'user', origin: 'server' });
  });
});

describe('M2: корпус «відомого»', () => {
  test('числа з id (clo3, b0012, obj2) не є числами; слова-числа — лише цілі', () => {
    expect(numbersOf('clo3 b0012 obj2 as1')).toEqual([]);
    expect(numbersOf('2nd week, 48-hour, 10% and twenty one')).toEqual(['2', '48', '10', '21']);
    expect(numbersOf('often, someone, weight')).toEqual([]);
    expect(scanFacts('Submit within 2 weeks.', { known: ['clo1 clo2 clo3'] }).map((f) => f.value)).toEqual(['2 weeks']);
  });

  test('readableText: людський текст значення без id, blockIds і провенансу', () => {
    const text = readableText(riskManagementState().outcomes);
    expect(text).toContain('Apply risk management frameworks');
    expect(text).not.toMatch(/clo\d|b\d{4}|parsed/);
  });

  test('Reword списку outcomes: «within 2 weeks» підсвічується, хоча в id є clo2', async () => {
    const s = await uploaded();
    const { state } = await store.getState(s._id);
    const c = await card(s, { target: { path: 'outcomes[]' }, value: state.outcomes, text: undefined, title: 'Rewrite outcomes' });
    formulator.reword.mockResolvedValue({ text: '- Apply risk frameworks within 2 weeks\n- Create a risk profile\n- Design mitigation plans', proposedValues: [] });
    const res = await post(s, `/suggestions/${c._id}/refine`, { feedback: 'Make them sharper' });
    expect(res.status).toBe(200);
    const view = res.body.suggestions.find((x) => x.id === String(c._id));
    expect(view.draft.proposedValues.map((v) => v.value)).toContain('2 weeks');
  });
});

describe('M4: неперевірені URL у чернетках', () => {
  test('Reword з вигаданим hbr.org → URL вирізано, картка позначена; URL викладача лишається', async () => {
    const s = await uploaded();
    const c = await card(s);
    formulator.reword.mockResolvedValueOnce({ text: 'Discuss the HBR case https://hbr.org/2019/05/invented-case in session 3.', proposedValues: [] });
    const res = await post(s, `/suggestions/${c._id}/refine`, { feedback: 'add a link to the HBR case' });
    expect(res.status).toBe(200);
    const view = res.body.suggestions.find((x) => x.id === String(c._id));
    expect(view.draft.value).not.toMatch(/https?:/);
    expect(view.description).toContain(SOURCE_NOT_CONFIRMED);

    formulator.reword.mockResolvedValueOnce({ text: 'Discuss the case https://www.thecasecentre.org/case-123 in session 3.', proposedValues: [] });
    const own = await post(s, `/suggestions/${c._id}/refine`, { feedback: 'use https://www.thecasecentre.org/case-123' });
    const ownView = own.body.suggestions.find((x) => x.id === String(c._id));
    expect(ownView.draft.value).toContain('https://www.thecasecentre.org/case-123');
    // Позначка не дублюється і знімається, коли посилання підтверджене
    expect(ownView.description).not.toContain(SOURCE_NOT_CONFIRMED);
  });

  test('answer: вигаданий URL вирізано', async () => {
    const s = await uploaded();
    const q = await card(s, { kind: 'question', question: 'What is the course about?', text: undefined });
    formulator.draftFromNarrative.mockResolvedValueOnce([{ slotKey: 'course.description', target: { path: 'summary.shortDescription' }, text: 'Project risks, see http://fake.example.net/case.', proposedValues: [] }]);
    const res = await post(s, `/suggestions/${q._id}/answer`, { answer: 'Project risks.' });
    const view = res.body.suggestions.find((x) => x.id === String(q._id));
    expect(view.draft.value).toBe('Project risks, see.');
    expect(view.description).toContain(SOURCE_NOT_CONFIRMED);
  });

  test('перевірений URL рідінгів (sources verified) і наявний у стані URL лишаються; вигаданий — ні', () => {
    const state = riskManagementState();
    state.materials.recommended[0].url = 'https://www.example-library.org/deepwater';
    const existing = state.materials.recommended;
    const built = buildDraftSuggestion({
      kind: 'edit', target: { path: 'materials.recommended[]' }, description: 'Readings',
      value: [...existing,
        { id: 'm9', citation: 'Pepsico Ukraine', url: 'https://hbsp.harvard.edu/product/real', verified: true, source: 'ai_draft', evidenceBlockIds: [] },
        { id: 'm10', citation: 'Invented', url: 'https://hbr.org/invented', verified: true, source: 'ai_draft', evidenceBlockIds: [] }],
      sources: [{ title: 'Pepsico Ukraine', url: 'https://hbsp.harvard.edu/product/real', verified: true }],
    }, { syllabusId: null, state, refs, known: [] });
    const urls = built.draft.value.map((m) => m.url);
    expect(urls).toContain('https://www.example-library.org/deepwater');
    expect(urls).toContain('https://hbsp.harvard.edu/product/real');
    expect(built.draft.value.find((m) => m.id === 'm10')).toMatchObject({ url: null, verified: false });
    expect(built.description).toBe(`Readings\n\n${SOURCE_NOT_CONFIRMED}`);
  });
});

describe('m4: порожній довідник політик', () => {
  test('розділ policies без жодного блоку — неповний', () => {
    expect(sectionGaps('policies', { policies: [] })).toEqual(['Policies: the policy library is empty']);
    expect(sectionGaps('policies', {})).toHaveLength(1);
  });
});

describe('m6/m7: approve-all з ключами й ревізією', () => {
  test('sections — лише ці розділи; expectedRevision застарів → 409; невідомий ключ → 400', async () => {
    const probe = await uploaded();
    const all = (await post(probe, '/sections/approve-all')).body.approved;
    expect(all.length).toBeGreaterThan(1);

    const s = await uploaded();
    const revision = (await get(s)).body.revision;
    const res = await post(s, '/sections/approve-all', { sections: [all[0], 'policies'], expectedRevision: revision });
    expect(res.status).toBe(200);
    expect(res.body.approved).toEqual([all[0]]);
    expect(res.body.skipped.map((x) => x.key)).toEqual(['policies']);
    expect(res.body.state.sections[all[1]]).toBeUndefined();

    const stale = await post(s, '/sections/approve-all', { sections: [all[1]], expectedRevision: revision });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STATE_CONFLICT');
    expect((await post(s, '/sections/approve-all', { sections: ['nope'] })).body.code).toBe('UNKNOWN_SECTION');
    expect((await post(s, '/sections/approve-all', { sections: 'x' })).status).toBe(400);
  });
});

describe('m9: англійські повідомлення і code', () => {
  test('routes/syllabus.js і 404 server.js', async () => {
    const bad = await request(app).get('/api/syllabus/not-an-id').set(authOf(owner));
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ message: 'Invalid syllabus id', code: 'INVALID_ID' });
    const missing = await request(app).get(`/api/syllabus/${new mongoose.Types.ObjectId()}`).set(authOf(owner));
    expect(missing.body).toEqual({ message: 'Syllabus not found', code: 'NOT_FOUND' });
    const s = await uploaded();
    const foreign = await request(app).get(`/api/syllabus/${s._id}/status`).set(authOf(stranger));
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('FORBIDDEN');
    const route = await request(app).get('/api/nope').set(authOf(owner));
    expect(route.status).toBe(404);
    expect(route.body).toEqual({ message: 'Route not found', code: 'ROUTE_NOT_FOUND' });
    const json = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
    expect(json.body).toEqual({ message: 'Invalid JSON in the request body.', code: 'INVALID_JSON' });
  });
});

describe('m10: двох питань поспіль не буває', () => {
  test('питання без дії викладача лишається поточним; після рішення — нове питання', async () => {
    const s = await scratch();
    await post(s, '/start');
    let conversation = await Conversation.findOne({ syllabusId: s._id });
    const first = conversation.currentSlotKey;
    expect(first).toBeTruthy();
    // Інтерв'юер хоче інший слот
    interviewer.nextQuestion.mockImplementation(async (input) => {
      const other = candidates(input).find((x) => x.key !== first);
      return { slotKey: other.key, question: `About ${other.key}?`, why: 'test' };
    });
    const count = () => Message.countDocuments({ conversationId: conversation._id, kind: { $in: ['question', 'policy-choice'] } });
    const before = await count();
    // Слот розмови знято без відповіді викладача (останнє повідомлення — досі питання AI)
    await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSlotKey: null } });
    const step = await flow.postNextStep(await Conversation.findById(conversation._id));
    expect(step.question.slotKey).toBe(first);
    expect(await count()).toBe(before);
    expect((await Conversation.findById(conversation._id)).currentSlotKey).toBe(first);

    // Дія викладача (рішення) після питання → нове питання дозволене
    await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSlotKey: null, lastDecisionAt: new Date(Date.now() + 1000) } });
    conversation = await Conversation.findById(conversation._id);
    const next = await flow.postNextStep(conversation);
    expect(next.question.slotKey).not.toBe(first);
    expect(await count()).toBe(before + 1);
  });
});

describe('m11: завантаження до появи стану', () => {
  test('analyzing → 409 ANALYSIS_IN_PROGRESS, error → 409 ANALYSIS_FAILED', async () => {
    const analyzing = await helpers.createSyllabus(owner, { status: 'analyzing', programCode: 'MBA28', track: 'upload' });
    const failed = await helpers.createSyllabus(owner, { status: 'error', programCode: 'MBA28', track: 'upload' });
    created.push(analyzing._id, failed._id);
    const a = await get(analyzing, '/outputs/syllabus.docx');
    expect(a.status).toBe(409);
    expect(a.body).toMatchObject({ code: 'ANALYSIS_IN_PROGRESS', retryable: true });
    const f = await get(failed, '/outputs/syllabus.docx');
    expect(f.status).toBe(409);
    expect(f.body.code).toBe('ANALYSIS_FAILED');
  });
});

describe('m12: PUT /api/syllabus/:id', () => {
  const put = (s, body, user = owner) => request(app).put(`/api/syllabus/${s._id}`).set(authOf(user)).send(body);

  test('назва й код курсу — через store.mutate у state.header; зміна програми → 400; під час аналізу → 409', async () => {
    const s = await uploaded();
    const revision = (await store.getState(s._id)).revision;
    const res = await put(s, { title: 'Risk Management 2.0', courseCode: 'RM-101' });
    expect(res.status).toBe(200);
    expect(res.body.syllabus.title).toBe('Risk Management 2.0');
    expect(res.body.syllabus.state).toBeUndefined();
    const saved = await store.getState(s._id);
    expect(saved.revision).toBe(revision + 1);
    expect(saved.state.header).toMatchObject({ courseTitle: 'Risk Management 2.0', courseCode: 'RM-101' });
    expect(await SlotChange.findOne({ syllabusId: s._id, path: 'header.courseTitle' }).lean()).toMatchObject({ after: 'Risk Management 2.0' });

    const program = await put(s, { programId: String(new mongoose.Types.ObjectId()) });
    expect(program.status).toBe(400);
    expect(program.body.code).toBe('PROGRAM_CHANGE_NOT_ALLOWED');
    expect((await put(s, { programCode: 'MBA27' })).body.code).toBe('PROGRAM_CHANGE_NOT_ALLOWED');
    expect((await put(s, { programCode: 'mba28' })).status).toBe(200);

    await Syllabus.updateOne({ _id: s._id }, { $set: { status: 'analyzing' } });
    const busy = await put(s, { title: 'Another' });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('ANALYSIS_IN_PROGRESS');
    expect((await put(s, { title: 'x' }, stranger)).status).toBe(403);
  });
});
