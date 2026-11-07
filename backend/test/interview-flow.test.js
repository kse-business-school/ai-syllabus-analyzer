// Трек 1 (ТЗ v2.1): інтерв'юер + розповідь → чернетки + мапінг PLO + політики-картки. Мережі немає: мокається лише
// services/ai/client.createResponse. Інтерв'юер, формулювальник, мапінг PLO і оркестратор (runner → handlers →
// propose_items) — справжній код: сесії, оцінювання й матеріали потрапляють у стан лише через картки й Confirm (аудит A02).
jest.mock('../services/ai/client', () => ({ ...jest.requireActual('../services/ai/client'), createResponse: jest.fn() }));

const helpers = require('./helpers');
const request = require('supertest');
const app = require('../server');
const { createResponse } = require('../services/ai/client');
const runner = require('../services/ai/tools/runner');
const Syllabus = require('../models/Syllabus');
const Suggestion = require('../models/Suggestion');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const store = require('../services/syllabusState/store');
const flow = require('../services/chat/flow');
const { createEmptyState } = require('../services/syllabusState/empty');
const { SLOTS, sectionGaps } = require('../services/syllabusState/slots');
const { loadFixtureRefs } = require('../services/references/fixtureRefs');
const { seedReferences } = require('../services/references/seed');
const { normalizePloCode } = require('../services/references');
const { removeOutputDir } = require('../services/outputs');

const refs = loadFixtureRefs('MBA28');
const QUESTIONS = {
  'course.description': 'What is the course about and what will happen in class?',
  'schedule.sessions': 'Which sessions will you run: topic, academic hours and type?',
  'schedule.individual_work': 'What individual work do students do?',
  'assessment.criteria': 'How do you assess students: components, weights, criteria and deadlines?',
  'materials.required': 'Which readings are mandatory?',
};
const DRAFTS = {
  'course.description': 'You will learn to negotiate under pressure. Together we practise with realistic counterparts. You leave with a toolkit you can apply at work.',
  'course.objectives': 'Introduce the core negotiation frameworks.\nBuild a preparation plan for a real deal.',
  'course.outcomes': 'Prepare a negotiation plan for a complex deal\nAnalyze the interests of the counterpart',
  'course.capstone': 'This course prepares you for the analytical depth of your Capstone project.',
};
// Що «модель-оркестратор» пропонує інструментом propose_items на відповідь про кожен слот
const SESSION_TOPICS = ['Interests and positions', 'BATNA', 'Value creation', 'Anchoring', 'Team negotiations', 'Final simulation'];
const item = (fields) => ({
  id: null, label: '', hours: null, weight: null, type: null, format: null, date: null, time: null, deadline: null, criteria: null, guest: null, url: null, group: null, ...fields,
});
const ORCHESTRATOR_ITEMS = {
  'schedule.sessions': { key: 'schedule.sessions', mode: 'append', items: SESSION_TOPICS.map((label) => item({ label, hours: 2, type: 'lecture' })) },
  'assessment.criteria': { key: 'assessment.components', mode: 'append', items: [
    item({ label: 'Negotiation simulation', weight: 60, deadline: '2026-12-01', criteria: 'Preparation and outcome quality.' }),
    item({ label: 'Final paper', weight: 40, deadline: '2026-12-15', criteria: 'Depth of analysis.' }),
  ] },
  // Модель переформулювала назву: дослівно викладач її не казав → proposedValue для підтвердження
  'materials.required': { key: 'materials.required', mode: 'append', items: [item({ label: 'Fisher, R., Ury, W. Getting to Yes.' })] },
};
const SLOT_RE = /\b(?:course|schedule|assessment|materials|instructor|glance)\.[a-z_]+/;

let owner;
const created = [];
const auth = () => ({ Authorization: `Bearer ${helpers.tokenFor(owner)}` });
const post = (s, path, body = {}) => request(app).post(`/api/chat/${s._id}${path}`).set(auth()).send(body);

/**
 * Модель-скрипт: оркестратор (виклик з tools) — один propose_items для поточного слота, потім текстова відповідь;
 * решта — відповідь за ім'ям strict json_schema.
 */
function scriptedModel() {
  createResponse.mockImplementation(async (args) => {
    if (args.tools) {
      const done = args.input.some((i) => i.type === 'function_call_output');
      const slot = (SLOT_RE.exec(String(args.input[1].content)) || [])[0];
      const call = ORCHESTRATOR_ITEMS[slot];
      if (done || !call) return { output_text: done ? 'The draft is on a card. Press Confirm to save it.' : 'Noted.', output: [] };
      return { output: [{ type: 'function_call', call_id: `call_${slot}`, name: 'propose_items', arguments: JSON.stringify(call) }] };
    }
    const name = args.text.format.name;
    const user = args.input[1].content;
    const respond = (v) => ({ output_text: JSON.stringify(v) });
    if (name === 'interviewer_next_question') {
      const slotKey = /Allowed empty slots in flow order: (.+)/.exec(user)[1].split(', ')[0];
      return respond({ slotKey, question: QUESTIONS[slotKey] || `Tell me about ${slotKey}?`, why: 'This input is still missing.' });
    }
    if (name === 'formulator_narrative') {
      const wanted = /Requested slots: (.+)/.exec(user)[1].split(', ');
      return respond({ drafts: wanted.map((slotKey) => ({
        slotKey, text: DRAFTS[slotKey], proposedValues: [], rationale: 'From your description.',
        criteriaKeys: slotKey === 'course.capstone' ? [refs.capstone.criteria[0].key] : [],
      })) });
    }
    if (name === 'lo_plo_mapping') {
      const ids = /Return one mapping per CLO id: (.+?)\.$/m.exec(user)[1].split(', ');
      const codes = refs.outcomes.map((o) => normalizePloCode(o.code));
      return respond({ mappings: ids.map((outcomeId) => ({ outcomeId, plo: codes.slice(0, 2).map((code) => ({ code, coverage: 'full', reason: 'Matches the wording.' })) })) });
    }
    throw new Error(`unexpected LLM call: ${name}`);
  });
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

const log = async (s) => {
  const conv = await Conversation.findOne({ syllabusId: s._id });
  return Message.find({ conversationId: conv._id }).sort({ createdAt: 1, _id: 1 }).lean();
};
// Питання інтерв'юера; policy-choice — картки вибору (одна за раз після кліку), не питання
const isQuestion = (m) => m.role === 'ai' && m.kind === 'question';
const pending = (s) => Suggestion.find({ syllabusId: s._id, status: 'pending' }).sort({ order: 1, _id: 1 });
const slotType = (key) => SLOTS.find((x) => x.key === key)?.type || 'B'; // policy.* — тип B

/** Асерт «ніколи два питання поспіль»: між двома питаннями інтерв'юера завжди є відповідь/Skip викладача або картка. */
function expectNoTwoQuestionsInARow(messages) {
  messages.forEach((m, i) => {
    if (i > 0 && isQuestion(m)) expect(isQuestion(messages[i - 1])).toBe(false);
  });
}

/** Confirm кожної pending-картки; непідтверджені proposedValues спершу підтверджуються (як робить кнопка Confirm у UI). */
async function acceptAllPending(s) {
  let guard = 0;
  for (let c = await pending(s); c.length && guard < 20; c = await pending(s), guard += 1) {
    const unconfirmed = (c[0].draft?.proposedValues || []).filter((v) => !v.confirmed);
    if (unconfirmed.length) {
      expect((await post(s, `/suggestions/${c[0]._id}/accept`, {})).body.code).toBe('UNCONFIRMED_VALUES');
      const values = await post(s, `/suggestions/${c[0]._id}/values`, { values: unconfirmed.map((v) => ({ id: v.id, confirmed: true })) });
      expect(values.status).toBe(200);
    }
    const res = await post(s, `/suggestions/${c[0]._id}/accept`, {});
    expect(res.status).toBe(200);
  }
}

beforeAll(async () => {
  await helpers.connectDb();
  await seedReferences();
  owner = await helpers.createUser();
});
afterAll(async () => {
  for (const id of created) await removeOutputDir(id);
  await helpers.disconnectDb();
});
beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  scriptedModel();
  jest.spyOn(runner, 'runOrchestratorTurn');
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => console.error.mockRestore());

describe('розповідь → чернетки', () => {
  test('одна відповідь про курс → 4 чернетки з proposedValues-пайплайном; питання не ставиться, поки картка pending', async () => {
    const s = await scratch();
    const start = await post(s, '/start');
    expect(start.body.messages.find((m) => m.kind === 'question')).toMatchObject({
      content: QUESTIONS['course.description'], payload: { slotKey: 'course.description', why: 'This input is still missing.' },
    });

    const res = await post(s, '/message', { text: 'It is about negotiating complex deals through simulations.' });
    expect(res.status).toBe(200);
    const cards = await pending(s);
    expect(cards.map((c) => c.target.path)).toEqual(['summary.shortDescription', 'summary.objectives[]', 'outcomes[]', 'summary.capstone']);
    expect(cards.every((c) => c.origin === 'interviewer' && c.draft && Array.isArray(c.draft.proposedValues))).toBe(true);
    // Нічого не записано в стан без Confirm
    expect((await store.getState(s._id)).state.summary.shortDescription.text).toBeFalsy();
    // Видима одна картка (по одній), питання немає
    const messages = await log(s);
    expect(messages.filter((m) => m.kind === 'suggestion')).toHaveLength(1);
    expect(messages.filter(isQuestion)).toHaveLength(1);
    expect(runner.runOrchestratorTurn).not.toHaveBeenCalled();

    // Рішення по картках відкривають наступну; лише після останньої з'являється PLO-мапінг, а потім питання
    await post(s, `/suggestions/${cards[0]._id}/accept`, {});
    expect((await log(s)).filter(isQuestion)).toHaveLength(1);
    expect((await pending(s)).length).toBe(3);
  });
});

describe('skip і стрибок у розділ', () => {
  test('Skip залишає слот порожнім і видимим, питання йде далі; пропуск розповіді закриває її чернетки', async () => {
    const s = await scratch();
    await post(s, '/start');
    const res = await post(s, '/skip', { slotKey: 'course.description' });
    expect(res.status).toBe(200);
    const { state } = await store.getState(s._id);
    expect(state.summary.shortDescription.text).toBeFalsy();
    const questions = (await log(s)).filter(isQuestion);
    expect(questions.map((q) => q.payload.slotKey)).toEqual(['course.description', 'schedule.sessions']);
    expect(res.body.conversation.currentSlotKey).toBe('schedule.sessions');
    expect(res.body.conversation.skippedSlots).toEqual(['course.description']);
    expectNoTwoQuestionsInARow(await log(s));
    // Розповідь не питається знову
    const conv = await Conversation.findOne({ syllabusId: s._id });
    expect(conv.answeredSlots).toEqual(expect.arrayContaining(['course.objectives', 'course.outcomes', 'course.capstone']));
  });

  test('«Let\'s work on Assessment» → наступне питання про оцінювання, навіть якщо раніше було інше', async () => {
    const s = await scratch();
    await post(s, '/start');
    await post(s, '/message', { text: "Let's work on Assessment" });
    const messages = await log(s);
    const last = messages.at(-1);
    expect(last).toMatchObject({ kind: 'question', payload: { slotKey: 'assessment.criteria' } });
    expect((await Conversation.findOne({ syllabusId: s._id })).currentSlotKey).toBe('assessment.criteria');
    expect(runner.runOrchestratorTurn).not.toHaveBeenCalled();
    expectNoTwoQuestionsInARow(messages);
    // Відповідь іде в оркестратор зі слотом оцінювання; компоненти — картка propose_items, у стан без Confirm не потрапляють
    await post(s, '/message', { text: 'A negotiation simulation (60%) and a final paper (40%).' });
    expect(runner.runOrchestratorTurn).toHaveBeenCalledWith(expect.objectContaining({ currentSlotKey: 'assessment.criteria' }));
    const [card] = await pending(s);
    expect(card).toMatchObject({ origin: 'orchestrator', kind: 'edit', target: { path: 'assessments[]' } });
    // Дедлайни 2026-12-01 / 2026-12-15 викладач не називав → окремі proposedValues полів
    expect(card.draft.proposedValues.map((v) => [v.path, v.value])).toEqual([['[as1].deadline', '2026-12-01'], ['[as2].deadline', '2026-12-15']]);
    expect((await store.getState(s._id)).state.assessments).toEqual([]);
  });

  test('повторний postNextStep при відкритому питанні не додає друге питання', async () => {
    const s = await scratch();
    await post(s, '/start');
    const conv = await Conversation.findOne({ syllabusId: s._id });
    await flow.postNextStep(conv);
    await flow.postNextStep(await Conversation.findById(conv._id), { preferQuestion: true });
    expect((await log(s)).filter(isQuestion)).toHaveLength(1);
  });
});

describe('сценарний діалог треку 1', () => {
  test('усі обов\'язкові розділи охоплено, ≤ 8 питань інтерв\'юера, ніколи A/B/E і не два питання поспіль', async () => {
    const s = await scratch();
    await post(s, '/start');

    // 1. Розповідь про курс → чернетки (Description, Objectives, LO, Capstone), Confirm кожної; далі мапінг CLO → PLO
    await post(s, '/message', { text: 'It is about negotiating complex deals through simulations.' });
    await acceptAllPending(s);
    let { state } = await store.getState(s._id);
    expect(state.outcomes).toHaveLength(2);
    expect(state.outcomes.every((o) => o.plo.length === 2)).toBe(true); // PLO-картки теж підтверджено
    expect(createResponse.mock.calls.map((c) => c[0].text.format.name)).toEqual(
      ['interviewer_next_question', 'formulator_narrative', 'lo_plo_mapping', 'interviewer_next_question'],
    );

    // 2. Сесії → відповідь; індивідуальну роботу пропускаємо; 3. оцінювання; 4. матеріали
    let current = (await Conversation.findOne({ syllabusId: s._id })).currentSlotKey;
    expect(current).toBe('schedule.sessions');
    await post(s, '/message', { text: `Six two-hour lectures: ${SESSION_TOPICS.join(', ')}.` });
    // Чернетка сесій — картка: до Confirm стан порожній, наступного питання немає
    expect((await store.getState(s._id)).state.sessions).toEqual([]);
    const [sessionsCard] = await pending(s);
    expect(sessionsCard).toMatchObject({ target: { path: 'sessions[]' } });
    expect(sessionsCard.draft.proposedValues).toEqual([]); // години й теми названо викладачем
    await acceptAllPending(s);
    expect((await store.getState(s._id)).state.sessions.map((x) => [x.n, x.topic, x.hours])).toEqual(SESSION_TOPICS.map((t, i) => [i + 1, t, 2]));
    current = (await Conversation.findOne({ syllabusId: s._id })).currentSlotKey;
    expect(current).toBe('schedule.individual_work');
    await post(s, '/skip', { slotKey: 'schedule.individual_work' });
    expect((await Conversation.findOne({ syllabusId: s._id })).currentSlotKey).toBe('assessment.criteria');
    await post(s, '/message', { text: 'A negotiation simulation, 60%, due 2026-12-01, graded on preparation and outcome quality; a final paper, 40%, due 2026-12-15, graded on depth of analysis.' });
    expect((await pending(s))[0].draft.proposedValues).toEqual([]);
    await acceptAllPending(s);
    expect((await Conversation.findOne({ syllabusId: s._id })).currentSlotKey).toBe('materials.required');
    await post(s, '/message', { text: 'Getting to Yes by Fisher and Ury.' });
    const [materialsCard] = await pending(s);
    expect(materialsCard.draft.proposedValues.map((v) => v.value)).toEqual(['Fisher, R., Ury, W. Getting to Yes.']);
    await acceptAllPending(s);

    // 5. Політики — картки policy-choice, а не питання інтерв'юера: обираємо перший варіант кожної
    let guard = 0;
    for (let msgs = await log(s); msgs.at(-1).kind === 'policy-choice' && guard < 30; msgs = await log(s), guard += 1) {
      const { policyKey } = msgs.at(-1).payload;
      const block = refs.policyLibrary.blocks.find((b) => b.key === policyKey);
      const res = await post(s, `/policies/${policyKey}/choose`, { optionKey: block.options[0].key });
      expect(res.status).toBe(200);
    }
    expect(guard).toBeGreaterThan(0);

    // 6. Перевірки й завершення
    const messages = await log(s);
    expect(messages.at(-1)).toMatchObject({ role: 'ai', kind: 'text', content: expect.stringContaining('download the .docx') });
    ({ state } = await store.getState(s._id));
    for (const section of ['short_description', 'course_objectives', 'learning_outcomes', 'connection_to_capstone', 'schedule', 'assessment', 'materials', 'policies']) {
      expect([section, sectionGaps(section, state)]).toEqual([section, []]);
    }
    expect(state.assessments.reduce((sum, a) => sum + a.weight, 0)).toBe(100);

    // Лічильник питань: лише питання інтерв'юера (kind 'question'); політики рахуємо окремо
    const asked = messages.filter((m) => m.role === 'ai' && m.kind === 'question');
    expect(asked.map((m) => m.payload.slotKey)).toEqual([
      'course.description', 'schedule.sessions', 'schedule.individual_work', 'assessment.criteria', 'materials.required',
    ]);
    expect(asked.length).toBeLessThanOrEqual(8);
    expect(asked.every((m) => ['C', 'D'].includes(slotType(m.payload.slotKey)))).toBe(true);
    const policies = messages.filter((m) => m.kind === 'policy-choice');
    expect(policies.every((m) => slotType(m.payload.slotKey) === 'B')).toBe(true);
    expectNoTwoQuestionsInARow(messages);
    expect(policies).toHaveLength(10); // library-політики довідника MBA28: по картці, не питання
  }, 120000);
});
