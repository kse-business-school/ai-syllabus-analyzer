// Чат v5: View, /start, рішення по картках, розділи, політики, документ, вихід .docx. LLM-модулі (formulator,
// runner, interviewer) замокані — їх реалізують F і W3; тут перевіряється лише шар чату.
jest.mock('../services/ai/prompts/formulator', () => ({ reword: jest.fn(), draftFromNarrative: jest.fn() }));
jest.mock('../services/ai/client', () => ({ ...jest.requireActual('../services/ai/client'), createResponse: jest.fn() }));
jest.mock('../services/ai/tools/runner', () => ({ runOrchestratorTurn: jest.fn() }));
jest.mock('../services/ai/prompts/interviewer', () => ({ nextQuestion: jest.fn() }));

const helpers = require('./helpers');

const request = require('supertest');
const JSZip = require('jszip');
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
const { setPath, getPath } = require('../services/syllabusState/paths');
const { createEmptyState } = require('../services/syllabusState/empty');
const { loadFixtureRefs } = require('../services/references/fixtureRefs');
const { seedReferences } = require('../services/references/seed');
const { createDraftSuggestions } = require('../services/chat/draftSuggestions');
const { computeReadiness } = require('../services/syllabusState/readiness');
const { removeOutputDir } = require('../services/outputs');
const { riskManagementState } = require('./fixtures/state/riskManagement');

const refs = loadFixtureRefs('MBA28');
const notImplemented = () => Object.assign(new Error('not implemented'), { statusCode: 501, code: 'NOT_IMPLEMENTED' });

let owner;
let admin;
let stranger;
const created = [];

const authOf = (user) => ({ Authorization: `Bearer ${helpers.tokenFor(user)}` });
const api = (s) => `/api/chat/${s._id}`;
const post = (s, path, body = {}, user = owner) => request(app).post(`${api(s)}${path}`).set(authOf(user)).send(body);
const get = (s, path = '', user = owner) => request(app).get(`${api(s)}${path}`).set(authOf(user));

function binary(req) {
  return req.buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

/** Силабус треку 2 зі станом Risk Management (policies — текст з файлу без вибору). */
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

async function stateOf(s) {
  return (await store.getState(s._id)).state;
}

/** Картка edit на шлях стану; факти з тексту сканер виносить у proposedValues. */
async function card(s, input = {}) {
  const { state } = await store.getState(s._id);
  const [doc] = await createDraftSuggestions([{
    origin: 'reviewer', severity: 'medium', kind: 'edit', title: 'Rewrite the short description',
    description: 'The description is too generic.', rationale: 'Needs concrete topics.',
    target: { path: 'summary.shortDescription' },
    text: 'This course teaches MBA students to identify, assess and monitor project risks.',
    ...input,
  }], { syllabusId: s._id, state, refs, known: [] });
  return doc;
}

beforeAll(async () => {
  await helpers.connectDb();
  await seedReferences();
  owner = await helpers.createUser();
  admin = await helpers.createUser({ role: 'admin' });
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

describe('GET /api/chat/:id — View', () => {
  test('форма View, доступ власника, admin (read-only) і стороннього', async () => {
    const s = await uploaded({ title: 'Risk Management' });
    const res = await get(s);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['checks', 'conversation', 'messages', 'programBlocks', 'readiness', 'revision', 'sections', 'state', 'suggestions', 'syllabus'].sort());
    expect(res.body.syllabus).toMatchObject({
      id: String(s._id), title: 'Risk Management', status: 'in_progress', track: 'upload', programCode: 'MBA28', canMutate: true, needsRebuild: false,
    });
    expect(res.body.conversation).toBeNull();
    expect(res.body.revision).toBe(1);
    expect(res.body.state.policies).toHaveLength(13);
    expect(res.body.sections.map((x) => x.key)).toEqual(refs.template.map((x) => x.key));
    expect(res.body.readiness).toMatchObject({ score: 0, counts: { approved: 0, required: 11, pendingSuggestions: 0 } });
    expect(res.body.readiness.sections.policies).toMatchObject({ status: 'draft', complete: false });
    expect(res.body.checks.length).toBeGreaterThan(0);

    const asAdmin = await get(s, '', admin);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.syllabus.canMutate).toBe(false);
    expect((await get(s, '', stranger)).status).toBe(403);
  });

  test('SuggestionView v5: target, draft з proposedValues, before/after', async () => {
    const s = await uploaded();
    const c = await card(s, { text: 'The course lasts 48 hours and covers project risks.' });
    const res = await get(s);
    const v = res.body.suggestions[0];
    expect(v).toMatchObject({
      id: String(c._id), kind: 'edit', status: 'pending', stale: false, applicable: true, unconfirmedCount: 1,
      target: { section: 'short_description', path: 'summary.shortDescription' },
      after: 'The course lasts 48 hours and covers project risks.',
    });
    expect(v.before).toBe((await stateOf(s)).summary.shortDescription.text);
    expect(v.draft.proposedValues).toEqual([expect.objectContaining({ label: 'Quantity', value: '48 hours', confirmed: false })]);
    expect(v.draft.template).toContain('{{v1}}');
    expect(res.body.readiness.counts.pendingSuggestions).toBe(1);
  });

  test('силабус v4 (без state): лише читання з підказкою, мутації → 409 NEEDS_REBUILD', async () => {
    const s = await helpers.createSyllabus(owner, { title: 'Old', legacy: false });
    created.push(s._id);
    const res = await get(s);
    expect(res.status).toBe(200);
    expect(res.body.syllabus).toMatchObject({ needsRebuild: true, hint: 'Rebuild in the new format', canMutate: false });
    expect(res.body.state).toBeNull();
    expect(res.body.suggestions).toEqual([]);
    for (const [path, body] of [['/start', {}], ['/message', { text: 'hi' }], ['/skip', { slotKey: 'x' }], ['/sections/approve-all', {}]]) {
      const r = await post(s, path, body);
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('NEEDS_REBUILD');
    }
    const flagged = await uploaded({ needsRebuild: true });
    expect((await post(flagged, '/start')).body.code).toBe('NEEDS_REBUILD');
  });

  test('аналіз ще триває → 409 ANALYSIS_IN_PROGRESS', async () => {
    const s = await helpers.createSyllabus(owner, { status: 'analyzing', programCode: 'MBA28' });
    created.push(s._id);
    expect((await post(s, '/start')).body.code).toBe('ANALYSIS_IN_PROGRESS');
  });
});

describe('POST /start', () => {
  test('трек 2: «Here\'s what I found…», картка approve-all і перша pending-картка за order', async () => {
    const s = await uploaded();
    await card(s, { severity: 'low', title: 'Low priority' });
    const first = await card(s, { severity: 'critical', title: 'Critical first', target: { path: 'summary.capstone' }, text: 'Connects the course to the capstone project.' });
    const res = await post(s, '/start');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['checks', 'conversation', 'messages', 'programBlocks', 'readiness', 'revision', 'sections', 'state', 'suggestions', 'syllabus'].sort());
    const kinds = res.body.messages.map((m) => m.kind);
    expect(res.body.messages[0].content).toMatch(/^Here's what I found in your file: \d+ of 11 sections have content/);
    expect(kinds).toContain('approve-all');
    const approveAll = res.body.messages.find((m) => m.kind === 'approve-all');
    expect(approveAll.payload.sections.length).toBeGreaterThan(0);
    const cards = res.body.messages.filter((m) => m.kind === 'suggestion');
    expect(cards).toHaveLength(1);
    expect(cards[0].relatedSuggestionId).toBe(String(first._id));
    expect(res.body.conversation.currentSuggestionId).toBe(String(first._id));

    // Ідемпотентно: повторний /start нічого не дублює
    const again = await post(s, '/start');
    expect(again.body.messages).toHaveLength(res.body.messages.length);
  });

  test('трек 1: привітання, картка курсу (показана, не запитана) і перше питання; на збій інтерв\'юера — питання TemplateSection', async () => {
    const s = await scratch();
    const res = await post(s, '/start');
    expect(res.status).toBe(200);
    expect(res.body.messages[0].content).toMatch(/^Hi! I'll help you build the syllabus for "Negotiations"/);
    expect(res.body.messages[1]).toMatchObject({ kind: 'text', content: expect.stringContaining('Course: Negotiations'), payload: { courseCard: true } });
    const q = res.body.messages.find((m) => m.kind === 'question');
    const section = refs.template.find((t) => t.key === 'short_description');
    expect(q.payload).toMatchObject({ slotKey: 'course.description', question: section.question });
    expect(res.body.conversation.currentSlotKey).toBe('course.description');
  });

  test('трек 1: питання інтерв\'юера, коли він реалізований', async () => {
    interviewer.nextQuestion.mockResolvedValue({ slotKey: 'course.description', question: 'What is the course about?', why: 'It is the core of the Summary.' });
    const s = await scratch();
    const res = await post(s, '/start');
    const q = res.body.messages.find((m) => m.kind === 'question');
    expect(q).toMatchObject({ content: 'What is the course about?', payload: { slotKey: 'course.description', why: 'It is the core of the Summary.' } });
    expect(interviewer.nextQuestion).toHaveBeenCalledWith(expect.objectContaining({ skipped: [], transcript: expect.any(Array) }));
  });

  test('POST /skip: слот пропущено, наступне питання інше', async () => {
    const s = await scratch();
    const start = await post(s, '/start');
    const slotKey = start.body.messages.find((m) => m.kind === 'question').payload.slotKey;
    const res = await post(s, '/skip', { slotKey });
    expect(res.status).toBe(200);
    expect(res.body.conversation.skippedSlots).toEqual([slotKey]);
    const questions = res.body.messages.filter((m) => m.kind === 'question');
    expect(questions).toHaveLength(2);
    expect(questions[1].payload.slotKey).not.toBe(slotKey);
    expect((await post(s, '/skip', {})).status).toBe(400);
  });
});

describe('accept (Confirm)', () => {
  test('proposedValues: 409 UNCONFIRMED_VALUES → values → accept; журнал, ревізія, зняття approved', async () => {
    const s = await uploaded();
    await store.approveSection(s._id, 'instructor');
    const c = await card(s, { text: 'The course lasts 48 hours and covers project risks.' });
    const rev = (await store.getState(s._id)).revision;

    const blocked = await post(s, `/suggestions/${c._id}/accept`, { expectedRevision: rev });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('UNCONFIRMED_VALUES');
    expect(blocked.body.unconfirmed).toEqual(['v1']);

    const changed = await post(s, `/suggestions/${c._id}/values`, { values: [{ id: 'v1', value: '36 hours', confirmed: true }] });
    expect(changed.status).toBe(200);
    const view = changed.body.suggestions.find((x) => x.id === String(c._id));
    expect(view.draft.value).toBe('The course lasts 36 hours and covers project risks.');
    expect(view.draft.proposedValues[0]).toMatchObject({ value: '36 hours', confirmed: true });
    expect(view.versionsCount).toBe(1);

    const ok = await post(s, `/suggestions/${c._id}/accept`, { expectedRevision: rev });
    expect(ok.status).toBe(200);
    expect(ok.body.state.summary.shortDescription).toMatchObject({
      text: 'The course lasts 36 hours and covers project risks.', source: 'ai_draft',
    });
    expect(ok.body.revision).toBe(rev + 1);
    expect(ok.body.state.sections.instructor).toBeDefined(); // чужий розділ не зачеплено
    const accepted = ok.body.suggestions.find((x) => x.id === String(c._id));
    expect(accepted.status).toBe('accepted');
    expect(accepted.after).toBe('The course lasts 36 hours and covers project risks.');
    expect(await SlotChange.countDocuments({ syllabusId: s._id, suggestionId: c._id })).toBe(1);

    const again = await post(s, `/suggestions/${c._id}/accept`, {});
    expect(again.body.code).toBe('NOT_PENDING');
  });

  test('values: невідомий id → 400, порожнє значення → 400', async () => {
    const s = await uploaded();
    const c = await card(s, { text: 'The course lasts 48 hours.' });
    expect((await post(s, `/suggestions/${c._id}/values`, { values: [{ id: 'zz', value: '1 hour' }] })).body.code).toBe('UNKNOWN_VALUE');
    expect((await post(s, `/suggestions/${c._id}/values`, { values: [{ id: 'v1', value: '' }] })).status).toBe(400);
  });

  test('STALE_DRAFT: значення слота змінилось після створення чернетки; інші картки на шлях → stale', async () => {
    const s = await uploaded();
    const a = await card(s, { text: 'Draft A about project risk management in practice.' });
    const b = await card(s, { text: 'Draft B about project risk management in practice.' });
    await store.mutate(s._id, (await store.getState(s._id)).revision, (st) => setPath(st, 'summary.shortDescription', { ...st.summary.shortDescription, text: 'Changed elsewhere.' }));

    const res = await post(s, `/suggestions/${a._id}/accept`, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STALE_DRAFT');
    expect((await get(s)).body.suggestions.every((v) => v.stale)).toBe(true);

    // Reword створює чернетку від поточного значення — accept проходить, друга картка лишається stale
    formulator.reword.mockResolvedValue({ text: 'Reworded draft A about project risk management.', proposedValues: [], rationale: 'r' });
    expect((await post(s, `/suggestions/${a._id}/refine`, { feedback: 'Make it shorter' })).status).toBe(200);
    expect((await post(s, `/suggestions/${a._id}/accept`, {})).status).toBe(200);
    const views = (await get(s)).body.suggestions;
    expect(views.find((v) => v.id === String(b._id))).toMatchObject({ status: 'pending', stale: true });
  });

  test('locked: мутація слота, який лише для читання → 409 LOCKED', async () => {
    const s = await uploaded();
    const c = await card(s, { target: { path: 'policies{policy.passing}' }, text: 'Passing grade is whatever.' });
    const res = await post(s, `/suggestions/${c._id}/accept`, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LOCKED');
    expect((await Suggestion.findById(c._id)).status).toBe('pending');
  });

  test('question → 409 ANSWER_REQUIRED; порада applicable:false → accepted без змін стану', async () => {
    const s = await uploaded();
    const q = await card(s, { kind: 'question', question: 'What topics?', text: undefined });
    expect((await post(s, `/suggestions/${q._id}/accept`, {})).body.code).toBe('ANSWER_REQUIRED');
    const advice = await card(s, { applicable: false, text: undefined, title: 'Consider adding a guest lecture' });
    const rev = (await store.getState(s._id)).revision;
    const res = await post(s, `/suggestions/${advice._id}/accept`, {});
    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(rev);
    expect(res.body.suggestions.find((v) => v.id === String(advice._id)).status).toBe('accepted');
  });

  test('expectedRevision, що не збігається, → 409 STATE_CONFLICT, картка лишається pending', async () => {
    const s = await uploaded();
    const c = await card(s, { text: 'Draft about project risk management in practice.' });
    const res = await post(s, `/suggestions/${c._id}/accept`, { expectedRevision: 99 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STATE_CONFLICT');
    expect((await Suggestion.findById(c._id)).status).toBe('pending');
  });

  test('масив сутностей: outcomes[] з рядків стають сутностями з source ai_draft', async () => {
    const s = await uploaded();
    const c = await card(s, { target: { path: 'outcomes[]' }, value: ['Assess project risks.', 'Plan risk responses.'], text: undefined });
    const res = await post(s, `/suggestions/${c._id}/accept`, {});
    expect(res.status).toBe(200);
    expect(res.body.state.outcomes.map((o) => o.text)).toEqual(['Assess project risks.', 'Plan risk responses.']);
    expect(res.body.state.outcomes[0]).toMatchObject({ source: 'ai_draft', plo: [], assessmentIds: [] });
  });
});

describe('політики', () => {
  test('choose optionKey: варіант довідника, source fixture; невідомий варіант 400; locked 409', async () => {
    const s = await uploaded();
    const res = await post(s, '/policies/policy.attendance/choose', { optionKey: 'attendance_std' });
    expect(res.status).toBe(200);
    const block = res.body.state.policies.find((p) => p.key === 'policy.attendance');
    const option = refs.policyLibrary.blocks.find((b) => b.key === 'policy.attendance').options.find((o) => o.key === 'attendance_std');
    expect(block).toMatchObject({ optionKey: 'attendance_std', text: option.text, source: 'fixture', modified: false });
    expect((await post(s, '/policies/policy.late/choose', { optionKey: 'nope' })).body.code).toBe('UNKNOWN_OPTION');
    const locked = await post(s, '/policies/policy.passing/choose', { optionKey: 'x' });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('LOCKED');
    expect((await post(s, '/policies/policy.nope/choose', { optionKey: 'x' })).status).toBe(404);
    expect((await post(s, '/policies/policy.late/choose', {})).status).toBe(400);
  });

  test('keepText: текст з файлу стає рішенням (instructor_directed, modified)', async () => {
    const s = await uploaded();
    const res = await post(s, '/policies/late/choose', { keepText: true }); // ключ без префікса policy.
    expect(res.status).toBe(200);
    expect(res.body.state.policies.find((p) => p.key === 'policy.late')).toMatchObject({ source: 'instructor_directed', modified: true, optionKey: null });
  });

  test('writeOwn: розмова переходить на слот, поля немає; locked → 409; /message передає currentSlotKey', async () => {
    const s = await uploaded();
    const res = await post(s, '/policies/policy.late/choose', { writeOwn: true });
    expect(res.status).toBe(200);
    expect(res.body.conversation.currentSlotKey).toBe('policy.late');
    expect(res.body.messages.at(-1)).toMatchObject({ role: 'ai', content: 'Tell me in your own words how this policy should work.' });
    expect(res.body.state.policies.find((p) => p.key === 'policy.late').source).toBe('parsed'); // стан не змінено
    expect((await post(s, '/policies/policy.passing/choose', { writeOwn: true })).body.code).toBe('LOCKED');

    runner.runOrchestratorTurn.mockResolvedValue({ reply: 'Got it.', createdSuggestionIds: [], stateChanged: false });
    await post(s, '/message', { text: 'No late work accepted at all.' });
    expect(runner.runOrchestratorTurn).toHaveBeenCalledWith(expect.objectContaining({ currentSlotKey: 'policy.late', userText: 'No late work accepted at all.' }));
  });

  test('картка політики: edit → instructor_directed/fixture_edited, choice з optionKey → fixture', async () => {
    const s = await uploaded();
    const edit = await card(s, { target: { path: 'policies{policy.appeal}' }, text: 'Write to me within a week.' });
    const r1 = await post(s, `/suggestions/${edit._id}/accept`, {});
    expect(r1.body.state.policies.find((p) => p.key === 'policy.appeal')).toMatchObject({ text: 'Write to me within a week.', source: 'instructor_directed', modified: true });

    await post(s, '/policies/policy.attendance/choose', { optionKey: 'attendance_std' });
    const edited = await card(s, { target: { path: 'policies{policy.attendance}' }, text: 'Attendance is expected at every session.' });
    const r2 = await post(s, `/suggestions/${edited._id}/accept`, {});
    expect(r2.body.state.policies.find((p) => p.key === 'policy.attendance')).toMatchObject({
      optionKey: 'attendance_std', source: 'fixture_edited', modified: true, text: 'Attendance is expected at every session.',
    });

    const choice = await card(s, {
      kind: 'choice', target: { path: 'policies{policy.late}' }, title: 'Late submission',
      options: [{ id: 'o1', label: 'Use late_daily', optionKey: 'late_daily' }, { id: 'o2', label: 'Keep my text' }], text: undefined,
    });
    expect((await post(s, `/suggestions/${choice._id}/accept`, {})).body.code).toBe('OPTION_REQUIRED');
    const r3 = await post(s, `/suggestions/${choice._id}/accept`, { optionId: 'o1' });
    expect(r3.status).toBe(200);
    expect(r3.body.state.policies.find((p) => p.key === 'policy.late')).toMatchObject({ optionKey: 'late_daily', source: 'fixture', modified: false });
    const view = r3.body.suggestions.find((v) => v.id === String(choice._id));
    expect(view.options[0].after).toBe(refs.policyLibrary.blocks.find((b) => b.key === 'policy.late').options.find((o) => o.key === 'late_daily').text);
  });
});

describe('розділи', () => {
  test('approve: SECTION_INCOMPLETE { gaps }, успіх, зняття; зміна розділу знімає затвердження', async () => {
    const s = await uploaded();
    const bad = await post(s, '/sections/policies/approve');
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('SECTION_INCOMPLETE');
    expect(bad.body.gaps[0]).toMatch(/choose an option/);

    const ok = await post(s, '/sections/instructor/approve');
    expect(ok.status).toBe(200);
    expect(ok.body.state.sections.instructor.approved).toBe(true);
    expect(ok.body.readiness.sections.instructor.status).toBe('approved');
    expect(ok.body.readiness.score).toBe(Math.round(100 / 11));
    expect(await Conversation.findOne({ syllabusId: s._id })).toBeNull(); // розмови ще немає

    const off = await request(app).delete(`${api(s)}/sections/instructor/approve`).set(authOf(owner));
    expect(off.status).toBe(200);
    expect(off.body.state.sections.instructor).toBeUndefined();
    expect((await post(s, '/sections/nope/approve')).status).toBe(400);
  });

  test('approve-all: затверджує готові розділи, skipped з причинами (неповні, відкриті картки, перевірки)', async () => {
    const s = await uploaded();
    await card(s, { target: { path: 'summary.capstone' }, text: 'Connects the course to the capstone project.' }); // блокує connection_to_capstone
    const res = await post(s, '/sections/approve-all');
    expect(res.status).toBe(200);
    const skipped = Object.fromEntries(res.body.skipped.map((x) => [x.key, x.reason]));
    expect(skipped.policies).toMatch(/^Incomplete:/);
    expect(skipped.connection_to_capstone).toBe('1 open suggestion');
    expect(res.body.approved).not.toContain('connection_to_capstone');
    expect(res.body.approved.length).toBeGreaterThan(0);
    for (const key of res.body.approved) expect(res.body.state.sections[key].approved).toBe(true);
    // Перевірка severity ≥ warning у розділі блокує (participation 35% → warning в assessment)
    expect(res.body.approved).not.toContain('assessment');
    expect(skipped.assessment).toMatch(/^(Open checks: |Incomplete: )/);
  });
});

describe('reject (Cancel)', () => {
  test('critical/high без причини → 400 REASON_REQUIRED; з причиною ок; Readiness не знижується', async () => {
    const s = await uploaded();
    await store.approveSection(s._id, 'instructor');
    const crit = await card(s, { severity: 'critical', title: 'Critical one', text: 'Draft about project risk management in practice.' });
    const low = await card(s, { severity: 'warning', title: 'Warning one', target: { path: 'summary.capstone' }, text: 'Capstone link in a full sentence.' });
    const before = (await get(s)).body.readiness;

    const noReason = await post(s, `/suggestions/${crit._id}/reject`, {});
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe('REASON_REQUIRED');
    expect((await post(s, `/suggestions/${crit._id}/reject`, { reason: 'x', rejectTag: 'bogus' })).status).toBe(400);

    const ok = await post(s, `/suggestions/${crit._id}/reject`, { reason: 'Already covered in section 2', rejectTag: 'already_present' });
    expect(ok.status).toBe(200);
    expect(ok.body.suggestions.find((v) => v.id === String(crit._id))).toMatchObject({ status: 'rejected', rejectTag: 'already_present', decisionReason: 'Already covered in section 2' });
    expect((await post(s, `/suggestions/${low._id}/reject`, {})).status).toBe(200);

    const after = ok.body.readiness;
    expect(after.score).toBe(before.score);
    expect(after.counts.approved).toBe(before.counts.approved);
    const final = (await get(s)).body.readiness;
    expect(final.score).toBe(before.score);
    expect(final.counts.pendingSuggestions).toBe(0);
    // Той самий результат, що й чиста функція без карток
    const { state } = await store.getState(s._id);
    expect(computeReadiness(state, { refs }).score).toBe(before.score);
  });
});

describe('reopen', () => {
  test('accept → reopen повертає значення і картку в pending; після зміни слота → 409 REOPEN_CONFLICT', async () => {
    const s = await uploaded();
    const original = (await stateOf(s)).summary.shortDescription;
    const c = await card(s, { text: 'Draft about project risk management in practice.' });
    await post(s, `/suggestions/${c._id}/accept`, {});
    expect((await stateOf(s)).summary.shortDescription.text).toBe('Draft about project risk management in practice.');

    const res = await post(s, `/suggestions/${c._id}/reopen`);
    expect(res.status).toBe(200);
    expect(res.body.state.summary.shortDescription).toEqual(original);
    expect(res.body.suggestions.find((v) => v.id === String(c._id))).toMatchObject({ status: 'pending', stale: false });
    expect(res.body.messages.at(-1)).toMatchObject({ kind: 'suggestion', relatedSuggestionId: String(c._id) });

    // Повторне прийняття і конфлікт
    await post(s, `/suggestions/${c._id}/accept`, {});
    await store.mutate(s._id, (await store.getState(s._id)).revision, (st) => setPath(st, 'summary.shortDescription.text', 'Edited by hand.'));
    const conflict = await post(s, `/suggestions/${c._id}/reopen`);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('REOPEN_CONFLICT');
    expect((await Suggestion.findById(c._id)).status).toBe('accepted');
    expect((await post(s, `/suggestions/${c._id}/reopen`)).status).toBe(409);
  });

  test('відхилена картка відкривається без змін стану; pending → 409 NOT_DECIDED', async () => {
    const s = await uploaded();
    const c = await card(s, { text: 'Draft about project risk management in practice.' });
    expect((await post(s, `/suggestions/${c._id}/reopen`)).body.code).toBe('NOT_DECIDED');
    await post(s, `/suggestions/${c._id}/reject`, {});
    const rev = (await store.getState(s._id)).revision;
    const res = await post(s, `/suggestions/${c._id}/reopen`);
    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(rev);
  });
});

describe('refine (Reword) і answer', () => {
  test('refine: нова чернетка, сканер фактів, попередня у versions; без відгуку 400', async () => {
    const s = await uploaded();
    const c = await card(s, { text: 'Draft about project risk management in practice.' });
    formulator.reword.mockResolvedValue({ text: 'A sharper draft that takes 12 weeks.', proposedValues: [], rationale: 'Shorter' });
    const res = await post(s, `/suggestions/${c._id}/refine`, { feedback: 'Make it sharper' });
    expect(res.status).toBe(200);
    const v = res.body.suggestions.find((x) => x.id === String(c._id));
    expect(v.draft.value).toBe('A sharper draft that takes 12 weeks.');
    expect(v.draft.proposedValues).toEqual([expect.objectContaining({ value: '12 weeks', confirmed: false })]);
    expect(v.versionsCount).toBe(1);
    expect(v.rationale).toBe('Shorter');
    expect(formulator.reword).toHaveBeenCalledWith(expect.objectContaining({ feedback: 'Make it sharper', suggestion: expect.objectContaining({ kind: 'edit' }) }));
    expect((await post(s, `/suggestions/${c._id}/refine`, { feedback: '' })).status).toBe(400);
  });

  test('refine: 501/збій LLM → 503 retryable, лічильник збоїв; 3 поспіль → status error; успіх скидає', async () => {
    const s = await uploaded();
    const c = await card(s, { text: 'Draft about project risk management in practice.' });
    formulator.reword.mockRejectedValue(notImplemented());
    for (let i = 1; i <= 3; i += 1) {
      const res = await post(s, `/suggestions/${c._id}/refine`, { feedback: 'again' });
      expect(res.status).toBe(503);
      expect(res.body.retryable).toBe(true);
      expect((await Conversation.findOne({ syllabusId: s._id })).consecutiveAiFailures).toBe(i);
    }
    expect((await Conversation.findOne({ syllabusId: s._id })).status).toBe('error');
    formulator.reword.mockResolvedValue({ text: 'Fine now, a full sentence draft.', proposedValues: [] });
    expect((await post(s, `/suggestions/${c._id}/refine`, { feedback: 'again' })).status).toBe(200);
    expect(await Conversation.findOne({ syllabusId: s._id })).toMatchObject({ status: 'active', consecutiveAiFailures: 0 });
  });

  test('answer: питання → edit з чернеткою; без чернетки картка лишається питанням', async () => {
    const s = await uploaded();
    const q = await card(s, { kind: 'question', question: 'What is the course about?', text: undefined });
    formulator.draftFromNarrative.mockResolvedValueOnce([]);
    const none = await post(s, `/suggestions/${q._id}/answer`, { answer: 'Risks.' });
    expect(none.status).toBe(200);
    expect(none.body.suggestions.find((v) => v.id === String(q._id))).toMatchObject({ kind: 'question', answer: 'Risks.' });

    formulator.draftFromNarrative.mockResolvedValueOnce([{ slotKey: 'course.description', target: { path: 'summary.shortDescription' }, text: 'The course is about managing project risks.', proposedValues: [], rationale: 'From your answer' }]);
    const res = await post(s, `/suggestions/${q._id}/answer`, { answer: 'It is about managing project risks.' });
    expect(res.status).toBe(200);
    const v = res.body.suggestions.find((x) => x.id === String(q._id));
    expect(v).toMatchObject({ kind: 'edit', status: 'pending', after: 'The course is about managing project risks.' });
    expect(v.versionsCount).toBe(2);
    expect(formulator.draftFromNarrative).toHaveBeenLastCalledWith(expect.objectContaining({ narrative: 'It is about managing project risks.', slotKeys: ['course.description'] }));
    const notQuestion = await post(s, `/suggestions/${q._id}/answer`, { answer: 'again' });
    expect(notQuestion.body.code).toBe('NOT_A_QUESTION');
  });
});

describe('POST /message', () => {
  test('хід оркестратора: deps, відповідь AI, картки створених пропозицій', async () => {
    const s = await uploaded();
    runner.runOrchestratorTurn.mockImplementation(async (ctx) => {
      expect(Object.keys(ctx.deps)).toEqual(['acceptSuggestion']);
      const { deps } = require('../services/ai/tools/handlers').createToolContext(ctx);
      expect(ctx.refs.programCode).toBe('MBA28');
      expect(deps.runChecks(ctx.state, ctx.refs).length).toBeGreaterThan(0);
      const [draft] = await deps.createDraftSuggestions([{
        severity: 'medium', kind: 'edit', title: 'Capstone link', target: { path: 'summary.capstone' }, text: 'It prepares you for the capstone in 8 weeks.',
      }], { syllabusId: s._id, state: ctx.state, refs: ctx.refs, known: [ctx.userText] });
      await deps.mutate(s._id, ctx.revision, (st) => setPath(st, 'header.department', 'Management'), { source: 'instructor_directed', refs: ctx.refs });
      return { reply: 'Here is a draft.', createdSuggestionIds: [String(draft._id)], stateChanged: true };
    });
    const res = await post(s, '/message', { text: 'It prepares for the capstone' });
    expect(res.status).toBe(200);
    expect(res.body.state.header.department).toBe('Management');
    expect(res.body.revision).toBe(2);
    const last = res.body.messages.slice(-3);
    expect(last.map((m) => m.role)).toEqual(['user', 'ai', 'ai']);
    expect(last[1].content).toBe('Here is a draft.');
    expect(last[2].kind).toBe('suggestion');
    const v = res.body.suggestions[0];
    expect(v.unconfirmedCount).toBe(1); // сканер фактів: «8 weeks» ніхто не називав
    expect(res.body.conversation.currentSuggestionId).toBe(v.id);
  });

  test('deps.acceptSuggestion = Confirm з перевірками: UNCONFIRMED_VALUES', async () => {
    const s = await uploaded();
    const c = await card(s, { text: 'The course lasts 48 hours and covers project risks.' });
    let error;
    runner.runOrchestratorTurn.mockImplementation(async (ctx) => {
      try { await ctx.deps.acceptSuggestion(String(c._id)); } catch (err) { error = err; }
      return { reply: 'Please confirm the values.', createdSuggestionIds: [], stateChanged: false };
    });
    expect((await post(s, '/message', { text: 'apply it' })).status).toBe(200);
    expect(error).toMatchObject({ statusCode: 409, code: 'UNCONFIRMED_VALUES' });
    expect((await Suggestion.findById(c._id)).status).toBe('pending');
  });

  test('501 / збій LLM → 503 retryable, лічильник збоїв; валідація тексту; admin не може писати', async () => {
    const s = await uploaded();
    runner.runOrchestratorTurn.mockRejectedValue(notImplemented());
    const res = await post(s, '/message', { text: 'hello' });
    expect(res.status).toBe(503);
    expect(res.body.retryable).toBe(true);
    expect((await Conversation.findOne({ syllabusId: s._id })).consecutiveAiFailures).toBe(1);
    expect((await post(s, '/message', { text: '' })).status).toBe(400);
    expect((await post(s, '/message', { text: 'hi' }, admin)).status).toBe(403);
  });
});

describe('GET /document', () => {
  test('diff=0: розділи й блоки; library-політика з файлу — з позначкою, без тексту — плейсхолдер', async () => {
    const s = await uploaded();
    const res = await get(s, '/document?diff=0');
    expect(res.status).toBe(200);
    expect(res.body.sections.map((x) => x.key)).toEqual(refs.template.map((x) => x.key));
    const policies = res.body.sections.find((x) => x.key === 'policies').blocks;
    const attendance = policies[policies.findIndex((b) => b.text === 'Attendance') + 1];
    expect(attendance.text).toMatch(/^Attendance is mandatory\..* \(from your file — choose an option or keep your text\)$/);
    expect(attendance.parts).toBeUndefined();
    expect(policies[policies.findIndex((b) => b.text === 'Participation Credit') + 1].text).toBe('[Choose an option]');
    expect((await get(s, '/document?diff=2')).status).toBe(400);
  });

  test('diff=1: зміни проти baselineState у parts', async () => {
    const s = await uploaded();
    const c = await card(s, { text: 'A completely different short description of the course.' });
    await post(s, `/suggestions/${c._id}/accept`, {});
    const res = await get(s, '/document?diff=1');
    const desc = res.body.sections.find((x) => x.key === 'short_description').blocks;
    expect(desc.some((b) => b.parts.some((p) => p.type === 'ins'))).toBe(true);
    expect(desc.some((b) => b.parts.some((p) => p.type === 'del'))).toBe(true);
    const unchanged = res.body.sections.find((x) => x.key === 'instructor').blocks;
    expect(unchanged.every((b) => b.parts.every((p) => p.type === 'eq'))).toBe(true);
  });
});

describe('вихід .docx', () => {
  test('завантаження: валідний zip, ім\'я <Title>_syllabus.docx, downloads++, кеш за ревізією, admin теж може', async () => {
    const s = await uploaded();
    const res = await binary(get(s, '/outputs/syllabus.docx'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('wordprocessingml.document');
    expect(res.headers['content-disposition']).toContain('Risk_Management_syllabus.docx');
    const zip = await JSZip.loadAsync(res.body);
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('Risk Management');
    expect(xml).toContain('from your file'); // політики з файлу без вибору — з позначкою
    expect((await Syllabus.findById(s._id)).downloads).toBe(1);

    const again = await binary(get(s, '/outputs/syllabus.docx', admin));
    expect(again.status).toBe(200);
    expect((await Syllabus.findById(s._id)).downloads).toBe(2);
    expect(again.body.equals(res.body)).toBe(true);

    // Нова ревізія стану → новий файл
    await post(s, '/policies/policy.late/choose', { optionKey: 'late_daily' });
    const next = await binary(get(s, '/outputs/syllabus.docx'));
    const nextXml = await (await JSZip.loadAsync(next.body)).file('word/document.xml').async('string');
    expect(nextXml).not.toEqual(xml);
    expect((await get(s, '/outputs/syllabus.docx', stranger)).status).toBe(403);
  });

  test('порожній стан (трек 1) теж завантажується; v4-силабус → 409; старі імена → 404', async () => {
    const s = await scratch();
    const res = await binary(get(s, '/outputs/syllabus.docx'));
    expect(res.status).toBe(200);
    expect((await JSZip.loadAsync(res.body)).file('word/document.xml')).toBeTruthy();
    for (const name of ['tracked.docx', 'clean.docx', 'tracked.pdf', 'annotated.pdf', 'edited.pptx', 'preview.pdf']) {
      const r = await get(s, `/outputs/${name}`);
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('OUTPUT_NOT_AVAILABLE');
    }
    const v4 = await helpers.createSyllabus(owner);
    created.push(v4._id);
    expect((await get(v4, '/outputs/syllabus.docx')).body.code).toBe('NEEDS_REBUILD');
  });

  test('submit, slides, старий preview прибрано (404); View не містить submission-cta', async () => {
    const s = await uploaded();
    const c = await card(s);
    expect((await post(s, '/submit')).status).toBe(404);
    expect((await get(s, `/suggestions/${c._id}/slides`)).status).toBe(404);
    expect((await get(s, `/suggestions/${c._id}/preview`)).status).toBe(404);
    expect((await get(s, '/document/preview')).status).toBe(404);
    await post(s, `/suggestions/${c._id}/reject`, {});
    const view = await get(s);
    expect(view.body.messages.some((m) => m.kind === 'submission-cta')).toBe(false);
  });
});

describe('після рішення', () => {
  test('знімок readiness у Conversation і наступна картка за order', async () => {
    const s = await uploaded();
    const first = await card(s, { severity: 'high', title: 'First', text: 'Draft about project risk management in practice.' });
    const second = await card(s, { severity: 'medium', title: 'Second', target: { path: 'summary.capstone' }, text: 'Capstone link in a full sentence.' });
    await post(s, '/start');
    const res = await post(s, `/suggestions/${first._id}/reject`, { reason: 'Not needed' });
    expect(res.body.conversation.currentSuggestionId).toBe(String(second._id));
    expect(res.body.conversation.readiness).toMatchObject({ counts: { required: 11, pendingSuggestions: 1 } });
    const cards = res.body.messages.filter((m) => m.kind === 'suggestion').map((m) => m.relatedSuggestionId);
    expect(cards).toEqual([String(first._id), String(second._id)]);
    expect((await Message.countDocuments({ conversationId: res.body.conversation._id, kind: 'submission-cta' }))).toBe(0);
  });

  test('мутації лише для власника', async () => {
    const s = await uploaded();
    const c = await card(s);
    for (const [path, body] of [[`/suggestions/${c._id}/accept`, {}], [`/suggestions/${c._id}/reject`, { reason: 'x' }], ['/start', {}], ['/sections/instructor/approve', {}]]) {
      expect((await post(s, path, body, admin)).status).toBe(403);
      expect((await post(s, path, body, stranger)).status).toBe(403);
    }
    expect(getPath(await stateOf(s), 'summary.shortDescription.text')).not.toBeNull();
  });
});

// Інтеграційні межі між шаром чату і справжніми інструментами F; замоканий тільки виклик моделі.
describe('інтеграція v5', () => {
  const { createResponse } = require('../services/ai/client');
  const actualRunner = jest.requireActual('../services/ai/tools/runner');
  const tool = (name, args) => ({ output: [{ type: 'function_call', call_id: `call_${name}`, name, arguments: JSON.stringify(args) }] });
  const reply = (text) => ({ output_text: text, output: [] });

  beforeEach(() => {
    createResponse.mockReset();
    runner.runOrchestratorTurn.mockImplementation(actualRunner.runOrchestratorTurn);
  });

  test('справжній set_slot отримує сигнатуру store і зберігає число', async () => {
    const s = await scratch();
    createResponse.mockResolvedValueOnce(tool('set_slot', { key: 'glance.ects', value: 6 }))
      .mockResolvedValueOnce(reply('Saved 6 ECTS.'));
    const res = await post(s, '/message', { text: '6 ECTS' });
    expect(res.status).toBe(200);
    expect(res.body.state.header.ects).toBe(6);
    expect(res.body.revision).toBe(2);
    expect(res.body.conversation.readiness).toEqual(res.body.readiness);
  });

  test('writeOwn доходить до моделі й лишається контекстом, поки інструмент не змінить слот', async () => {
    const s = await uploaded();
    await post(s, '/policies/policy.late/choose', { writeOwn: true });
    createResponse.mockResolvedValueOnce(reply('How many days should students have?'));
    const res = await post(s, '/message', { text: 'I want to allow late work.' });
    expect(res.status).toBe(200);
    expect(createResponse.mock.calls[0][0].input.some((m) => m.role === 'system' && m.content.includes('policy.late'))).toBe(true);
    expect(res.body.conversation.currentSlotKey).toBe('policy.late');
  });

  test('справжній propose_draft → підтвердження фактів → apply_edit через спільний Confirm', async () => {
    const s = await uploaded();
    createResponse.mockResolvedValueOnce(tool('propose_draft', {
      key: 'course.description', text: 'You will practise risk analysis for 48 hours.',
      instruction: null, entity_id: null, proposed_values: [],
    })).mockResolvedValueOnce(reply('Please confirm the draft and its duration.'));
    const proposed = await post(s, '/message', { text: 'Focus on risk analysis.' });
    expect(proposed.status).toBe(200);
    const c = proposed.body.suggestions[0];
    expect(c.draft.proposedValues).toEqual([expect.objectContaining({ value: '48 hours', confirmed: false })]);
    await post(s, `/suggestions/${c.id}/values`, { values: [{ id: 'v1', confirmed: true }] });

    // Переданий expectedRevision не можна відкинути в адаптері. Картку показано останньою — «confirm» її застосовує.
    const mutate = jest.spyOn(store, 'mutate');
    createResponse.mockResolvedValueOnce(tool('apply_edit', { draft_id: c.id })).mockResolvedValueOnce(reply('Saved.'));
    const accepted = await post(s, '/message', { text: 'confirm' });
    expect(accepted.status).toBe(200);
    expect(mutate.mock.calls[0][1]).toBe(proposed.body.revision);
    mutate.mockRestore();
    expect(accepted.body.state.summary.shortDescription.text).toBe('You will practise risk analysis for 48 hours.');
    expect(accepted.body.suggestions[0].status).toBe('accepted');
  });

  test('M3: «Shall I look for readings?» → «yes» не застосовує показану раніше картку; STATE_CONFLICT лишає картку pending', async () => {
    const s = await uploaded();
    const c = await card(s);
    await post(s, '/start');
    // Картку показано; викладач питає про інше, AI ставить своє питання
    createResponse.mockResolvedValueOnce(reply('Shall I look for readings?'));
    await post(s, '/message', { text: 'Can we add some readings?' });
    createResponse.mockResolvedValueOnce(tool('apply_edit', { draft_id: String(c._id) })).mockResolvedValueOnce(reply('Okay.'));
    const res = await post(s, '/message', { text: 'yes' });
    expect(res.status).toBe(200);
    const output = JSON.parse(createResponse.mock.calls.at(-1)[0].input.find((m) => m.type === 'function_call_output').output);
    expect(output).toMatchObject({ error: 'NEEDS_CONFIRM', reason: 'not_current_card' });
    expect((await Suggestion.findById(c._id)).status).toBe('pending');
    expect((await stateOf(s)).summary.shortDescription.text).not.toBe(c.draft.value);

    // Конфлікт ревізії під час Confirm у чаті: картка лишається pending
    const fresh = await uploaded();
    const d = await card(fresh);
    await post(fresh, '/start');
    const conflict = Object.assign(new Error('changed'), { statusCode: 409, code: 'STATE_CONFLICT' });
    const mutate = jest.spyOn(store, 'mutate').mockRejectedValueOnce(conflict);
    createResponse.mockResolvedValueOnce(tool('apply_edit', { draft_id: String(d._id) })).mockResolvedValueOnce(reply('Please try again.'));
    expect((await post(fresh, '/message', { text: 'confirm' })).status).toBe(200);
    expect(mutate).toHaveBeenCalled();
    expect((await Suggestion.findById(d._id)).status).toBe('pending');
    mutate.mockRestore();
  });

  test('PLO mapping Confirm підтверджує кожен зв’язок; before завжди поточне значення', async () => {
    const s = await uploaded();
    const outcome = (await stateOf(s)).outcomes[0];
    const value = [{ code: refs.outcomes[0].code, coverage: 'partial', confirmed: false }];
    const c = await card(s, { target: { path: `outcomes[${outcome.id}].plo`, entityId: outcome.id }, value, text: undefined });
    const res = await post(s, `/suggestions/${c._id}/accept`, {});
    expect(res.status).toBe(200);
    expect(res.body.state.outcomes[0].plo).toEqual([{ ...value[0], confirmed: true }]);
    expect(res.body.suggestions[0].before).toEqual(res.body.state.outcomes[0].plo);
    expect(res.body.suggestions[0].after).toEqual(value);
  });

  test('values зберігає повні сутності, числовий тип і versions.action без LLM', async () => {
    const s = await uploaded();
    const value = [{ id: 'clo_new', text: 'Analyze risks over 48 hours.', plo: [], assessmentIds: [], source: 'ai_draft', evidenceBlockIds: [] }];
    const list = await card(s, { target: { path: 'outcomes[]' }, value, text: undefined });
    const changed = await post(s, `/suggestions/${list._id}/values`, { values: [{ id: 'v1', value: '36 hours', confirmed: true }] });
    expect(changed.status).toBe(200);
    expect(changed.body.suggestions[0].draft.value).toEqual([{ ...value[0], text: 'Analyze risks over 36 hours.' }]);
    expect((await Suggestion.findById(list._id)).versions[0].action).toBe('values');
    expect((await post(s, `/suggestions/${list._id}/accept`, {})).status).toBe(200);

    const number = await card(s, { target: { path: 'header.ects' }, value: 6, text: '6' });
    const numeric = await post(s, `/suggestions/${number._id}/values`, { values: [{ id: 'v1', value: '4', confirmed: true }] });
    expect(numeric.status).toBe(200);
    expect(numeric.body.suggestions.find((x) => x.id === String(number._id)).draft.value).toBe(4);
    expect((await post(s, `/suggestions/${number._id}/accept`, {})).body.state.header.ects).toBe(4);
    expect(createResponse).not.toHaveBeenCalled();
  });

  test('entityId: criteria і additional застосовуються до конкретної сутності; рекомендовані матеріали замінюються', async () => {
    const s = await uploaded();
    const state = await stateOf(s);
    for (const [path, entityId, value] of [
      [`assessments[${state.assessments[0].id}].criteria`, state.assessments[0].id, 'Clear argument supported by evidence.'],
      [`sessions[${state.sessions[0].id}].additional`, state.sessions[0].id, 'Discuss the instructor’s example.'],
      ['materials.recommended[]', null, [{ id: 'reading1', citation: 'Instructor reading', url: null, verified: false, source: 'instructor_directed', evidenceBlockIds: [] }]],
    ]) {
      const c = await card(s, { target: { path, entityId }, value, text: undefined });
      const res = await post(s, `/suggestions/${c._id}/accept`, {});
      expect(res.status).toBe(200);
      expect(getPath(res.body.state, path)).toEqual(value);
    }
  });

  test('трек scratch: з pending-карткою питання не ставиться, спершу картка', async () => {
    const s = await scratch();
    const c = await card(s, { text: 'A draft for your course.' });
    const res = await post(s, '/start');
    expect(res.status).toBe(200);
    // Поки є pending-картка, нового питання немає (питання не стоїть поруч із карткою)
    expect(res.body.messages.map((m) => m.kind)).toEqual(['text', 'text', 'suggestion']);
    expect(res.body.messages.at(-1).relatedSuggestionId).toBe(String(c._id));
  });
});

// Атомарність і відкат мають стосуватися саме тієї версії картки, яку бачив викладач.
describe('конкурентні рішення', () => {
  test('паралельні Confirm не застосовують одну картку двічі', async () => {
    const s = await uploaded();
    const c = await card(s, { text: 'A draft about managing risk.' });
    const results = await Promise.all([post(s, `/suggestions/${c._id}/accept`, {}), post(s, `/suggestions/${c._id}/accept`, {})]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await SlotChange.countDocuments({ syllabusId: s._id, suggestionId: c._id })).toBe(1);
  });

  test('Reword у польоті не перезаписує values, які викладач щойно підтвердив', async () => {
    const s = await uploaded();
    const c = await card(s, { text: 'A course lasting 48 hours.' });
    let finish;
    let started;
    const entered = new Promise((resolve) => { started = resolve; });
    formulator.reword.mockImplementationOnce(() => { started(); return new Promise((resolve) => { finish = resolve; }); });
    const inFlight = post(s, `/suggestions/${c._id}/refine`, { feedback: 'Make it clearer' }).then((res) => res);
    await entered;
    expect((await post(s, `/suggestions/${c._id}/values`, { values: [{ id: 'v1', confirmed: true }] })).status).toBe(200);
    finish({ text: 'A reworded course lasting 48 hours.' });
    expect((await inFlight).status).toBe(409);
    const saved = await Suggestion.findById(c._id);
    expect(saved.draft.value).toBe('A course lasting 48 hours.');
    expect(saved.draft.proposedValues[0].confirmed).toBe(true);
  });

  test('reopen після Confirm без зміни стану не відкочує попереднє прийняття', async () => {
    const s = await uploaded();
    const text = 'A draft about managing project risk.';
    const c = await card(s, { text });
    const accepted = await post(s, `/suggestions/${c._id}/accept`, {});
    const value = accepted.body.state.summary.shortDescription;
    await post(s, `/suggestions/${c._id}/reopen`);
    await store.mutate(s._id, (await store.getState(s._id)).revision, (st) => setPath(st, 'summary.shortDescription', value));
    formulator.reword.mockResolvedValueOnce({ text, proposedValues: [] });
    expect((await post(s, `/suggestions/${c._id}/refine`, { feedback: 'Keep exactly this text' })).status).toBe(200);
    const revision = (await store.getState(s._id)).revision;
    expect((await post(s, `/suggestions/${c._id}/accept`, {})).body.revision).toBe(revision);
    expect((await Suggestion.findById(c._id)).acceptedRevision).toBeNull();
    const reopened = await post(s, `/suggestions/${c._id}/reopen`);
    expect(reopened.status).toBe(200);
    expect(reopened.body.state.summary.shortDescription).toEqual(value);
    expect(reopened.body.revision).toBe(revision);
  });

  test('deps.acceptSuggestion зберігає expectedRevision; текст за прямою вказівкою має відповідний provenance', async () => {
    const s = await uploaded();
    const c = await card(s, { text: 'Use the wording specified by the instructor.', source: 'instructor_directed' });
    runner.runOrchestratorTurn.mockImplementationOnce(async (ctx) => {
      await ctx.deps.acceptSuggestion(String(c._id), { expectedRevision: 999 });
      return { reply: 'Saved.' };
    });
    const conflict = await post(s, '/message', { text: 'Confirm' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('STATE_CONFLICT');
    expect((await Suggestion.findById(c._id)).status).toBe('pending');
    const accepted = await post(s, `/suggestions/${c._id}/accept`, {});
    expect(accepted.status).toBe(200);
    expect(accepted.body.state.summary.shortDescription.source).toBe('instructor_directed');
  });
});
