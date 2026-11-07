// Профіль викладача (етап 6 ТЗ): API, адаптер CRM, картка підтвердження, write-back при Confirm, префіл треку 1.
jest.mock('../services/ai/prompts/formulator', () => ({ reword: jest.fn(), draftFromNarrative: jest.fn() }));
jest.mock('../services/ai/client', () => ({ ...jest.requireActual('../services/ai/client'), createResponse: jest.fn() }));
jest.mock('../services/ai/tools/runner', () => ({ runOrchestratorTurn: jest.fn() }));
jest.mock('../services/ai/prompts/interviewer', () => ({ nextQuestion: jest.fn() }));

const helpers = require('./helpers');
const request = require('supertest');
const app = require('../server');
const interviewer = require('../services/ai/prompts/interviewer');
const User = require('../models/User');
const Program = require('../models/Program');
const Syllabus = require('../models/Syllabus');
const Suggestion = require('../models/Suggestion');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const crm = require('../services/lecturers/crm');
const store = require('../services/syllabusState/store');
const { createEmptyState } = require('../services/syllabusState/empty');
const { loadFixtureRefs } = require('../services/references/fixtureRefs');
const { seedReferences } = require('../services/references/seed');
const { createDraftSuggestions } = require('../services/chat/draftSuggestions');
const { resolveProfile } = require('../services/lecturers/profile');
const { prepareInstructor } = require('../services/lecturers/cards');

const refs = loadFixtureRefs('MBA28');
let owner;
let other;
const authOf = (user) => ({ Authorization: `Bearer ${helpers.tokenFor(user)}` });
const auth = () => authOf(owner);
const PROFILE_URL = '/api/users/profile/lecturer';

beforeAll(async () => {
  await helpers.connectDb();
  await Program.seedDefaults();
  await seedReferences();
});
afterAll(helpers.disconnectDb);
beforeEach(async () => {
  jest.restoreAllMocks();
  interviewer.nextQuestion.mockRejectedValue(Object.assign(new Error('not implemented'), { statusCode: 501, code: 'NOT_IMPLEMENTED' }));
  owner = await helpers.createUser();
  other = await helpers.createUser();
});

const full = {
  name: 'Jane Doe', position: 'Associate professor', email: 'jane.doe@example.org', officeHours: 'Tue 14:00-16:00', assistants: 'John Smith',
  expertise: ['Negotiation', 'Leadership', 'Strategy'], education: ['PhD, KSE'], experience: ['10 years in consulting'],
};

describe('GET/PUT /api/users/profile/lecturer', () => {
  test('GET без збереженого профілю: ім\'я й email з акаунта, source instructor_directed, попередження про expertise', async () => {
    const res = await request(app).get(PROFILE_URL).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('instructor_directed');
    expect(res.body.profile).toMatchObject({ name: 'Test User', email: owner.email, expertise: [], education: [], experience: [], crmId: null });
    expect(res.body.warnings).toHaveLength(1);
  });

  test('PUT зберігає профіль, нормалізує списки; 3–6 expertise без попередження; чужий профіль не змінюється', async () => {
    const res = await request(app).put(PROFILE_URL).set(auth()).send({ ...full, education: [' PhD, KSE ', ''] });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Lecturer profile updated.');
    expect(res.body.profile).toMatchObject({ ...full, updatedAt: expect.any(String) });
    expect(res.body.warnings).toEqual([]);
    expect(res.body.crmWriteBack).toEqual({ ok: false, reason: 'CRM_NOT_CONFIGURED' });

    const again = await request(app).get(PROFILE_URL).set(auth());
    expect(again.body.profile).toMatchObject(full);
    const stranger = await request(app).get(PROFILE_URL).set(authOf(other));
    expect(stranger.body.profile.name).toBe('Test User');
    expect(stranger.body.profile.officeHours).toBe('');
  });

  test('часткове оновлення зберігає решту; expertise поза 3–6 — попередження, не помилка', async () => {
    await request(app).put(PROFILE_URL).set(auth()).send(full);
    const res = await request(app).put(PROFILE_URL).set(auth()).send({ expertise: Array.from({ length: 7 }, (_, i) => `Topic ${i}`) });
    expect(res.status).toBe(200);
    expect(res.body.profile.position).toBe('Associate professor');
    expect(res.body.warnings[0]).toMatch(/3–6/);
  });

  test('валідація: невідоме поле, не масив, не рядок, поганий email → 400; без токена → 401', async () => {
    for (const body of [{ crmId: 'x' }, { expertise: 'a' }, { expertise: [1] }, { name: 5 }, { email: 'nope' }, []]) {
      const res = await request(app).put(PROFILE_URL).set(auth()).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR', message: expect.any(String) });
    }
    expect((await request(app).get(PROFILE_URL)).status).toBe(401);
    expect((await request(app).put(PROFILE_URL).send({})).status).toBe(401);
  });
});

describe('адаптер CRM', () => {
  test('не налаштований: getProfile → null, writeBack → CRM_NOT_CONFIGURED', async () => {
    expect(await crm.getProfile({ userId: 'u1', email: 'a@b.c' })).toBeNull();
    expect(await crm.writeBack({ name: 'X' })).toEqual({ ok: false, reason: 'CRM_NOT_CONFIGURED' });
  });

  test('профіль з CRM має пріоритет і source crm', async () => {
    jest.spyOn(crm, 'getProfile').mockResolvedValue({ ...full, crmId: 'crm-7', updatedAt: null });
    const { profile, source } = await resolveProfile(owner._id);
    expect(source).toBe('crm');
    expect(profile).toMatchObject({ name: 'Jane Doe', crmId: 'crm-7' });
  });
});

describe('перенесення розділу 2 з попереднього силабуса', () => {
  const makeSyllabus = (instructors, extra = {}) => Syllabus.create({
    title: 'Prev', instructor: owner._id, programCode: 'MBA28', track: 'scratch', status: 'in_progress',
    state: { instructors }, ...extra,
  });

  test('профіль не редагували: підставляється instructors[0] попереднього силабуса', async () => {
    await makeSyllabus([{ id: 'instructor1', ...full }]);
    const { profile, source } = await resolveProfile(owner._id);
    expect(source).toBe('instructor_directed');
    expect(profile).toMatchObject({ name: 'Jane Doe', position: full.position });
  });

  test('поточний силабус виключається з пошуку', async () => {
    const current = await makeSyllabus([{ id: 'instructor1', ...full }]);
    const { profile } = await resolveProfile(owner._id, { excludeSyllabusId: current._id });
    expect(profile.name).not.toBe('Jane Doe');
  });

  test('збережений профіль має пріоритет над силабусом', async () => {
    await makeSyllabus([{ id: 'instructor1', ...full }]);
    await request(app).put(PROFILE_URL).set(auth()).send({ ...full, name: 'Jane Updated' });
    const { profile } = await resolveProfile(owner._id);
    expect(profile.name).toBe('Jane Updated');
  });

  test('порожній instructors[0] пропускається', async () => {
    await makeSyllabus([{ id: 'instructor1', name: '', expertise: [] }]);
    const { profile } = await resolveProfile(owner._id);
    expect(profile.name).not.toBe('');
  });
});

describe('префіл треку 1 і картка підтвердження', () => {
  test('POST /api/syllabus: instructors[0] з профілю до initState, pending-картка Yes / Update', async () => {
    await request(app).put(PROFILE_URL).set(auth()).send(full);
    const mba = await Program.findOne({ code: 'MBA' });
    const res = await request(app).post('/api/syllabus').set(auth()).send({ title: 'Negotiations', programId: String(mba._id), programCode: 'MBA28' });
    expect(res.status).toBe(201);
    const saved = await Syllabus.findById(res.body.syllabus._id).lean();
    expect(saved.state.instructors).toHaveLength(1);
    expect(saved.state.instructors[0]).toMatchObject({ ...full, source: 'instructor_directed' });
    expect(saved.baselineState.instructors[0].name).toBe('Jane Doe');

    const cards = await Suggestion.find({ syllabusId: saved._id }).lean();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ origin: 'interviewer', kind: 'choice', section: 'instructor', status: 'pending', target: { path: 'instructors[]' } });
    expect(cards[0].title).toBe('Here is your profile. Is it up to date?');
    expect(cards[0].options.map((o) => o.label)).toEqual(["Yes, it's up to date", 'Update']);
  });

  test('без збереженого профілю префіл бере ім\'я й email акаунта', async () => {
    const state = createEmptyState({ programCode: 'MBA28', track: 'scratch', refs, course: { title: 'X' } });
    prepareInstructor(state, await resolveProfile(owner._id));
    expect(state.instructors[0]).toMatchObject({ name: 'Test User', email: owner.email, source: 'instructor_directed' });
  });
});

describe('Confirm картки профілю і write-back', () => {
  const post = (s, path, body = {}) => request(app).post(`/api/chat/${s._id}${path}`).set(auth()).send(body);

  async function withProfileCard({ parsedInstructor = null } = {}) {
    await request(app).put(PROFILE_URL).set(auth()).send(full);
    const s = await helpers.createSyllabus(owner, { programCode: 'MBA28', track: 'scratch', title: 'Negotiations' });
    const state = createEmptyState({ programCode: 'MBA28', track: 'scratch', refs, course: { title: 'Negotiations' } });
    if (parsedInstructor) state.instructors = [parsedInstructor];
    const card = prepareInstructor(state, await resolveProfile(owner._id));
    const saved = await store.initState(s._id, state, { refs });
    const [doc] = await createDraftSuggestions([card], { syllabusId: s._id, state: saved.state, refs });
    return { s, doc, revision: saved.revision };
  }

  test('Yes: стан не змінюється, профіль і CRM не чіпаємо', async () => {
    const spy = jest.spyOn(crm, 'writeBack');
    const { s, doc, revision } = await withProfileCard();
    spy.mockClear();
    const before = (await User.findById(owner._id).lean()).lecturerProfile.updatedAt;
    const res = await post(s, `/suggestions/${doc._id}/accept`, { optionId: 'yes', expectedRevision: revision });
    expect(res.status).toBe(200);
    expect(res.body.state.instructors[0]).toMatchObject(full);
    expect(spy).not.toHaveBeenCalled();
    expect((await User.findById(owner._id).lean()).lecturerProfile.updatedAt).toEqual(before);
    expect((await Suggestion.findById(doc._id)).status).toBe('accepted');
  });

  test('Update: стан не змінюється, розмова переходить до слота instructor.profile', async () => {
    const spy = jest.spyOn(crm, 'writeBack');
    const { s, doc, revision } = await withProfileCard();
    spy.mockClear();
    const res = await post(s, `/suggestions/${doc._id}/accept`, { optionId: 'update', expectedRevision: revision });
    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(revision);
    expect(res.body.state.instructors[0]).toMatchObject(full);
    expect(spy).not.toHaveBeenCalled();
    const conv = await Conversation.findOne({ syllabusId: s._id }).lean();
    expect(conv.currentSlotKey).toBe('instructor.profile');
    const last = await Message.find({ conversationId: conv._id }).sort({ createdAt: -1 }).limit(5).lean();
    expect(last.some((m) => /update in your instructor profile/.test(m.content))).toBe(true);
  });

  test('змінена картка instructors[] → Confirm пише в User.lecturerProfile і викликає crm.writeBack', async () => {
    const spy = jest.spyOn(crm, 'writeBack');
    const { s, revision } = await withProfileCard();
    spy.mockClear();
    const { state } = await store.getState(s._id);
    const edited = [{ ...state.instructors[0], officeHours: 'Fri 10:00-12:00', expertise: [...state.instructors[0].expertise, 'Ethics'] }];
    const [doc] = await createDraftSuggestions([{
      origin: 'interviewer', severity: 'medium', kind: 'edit', title: 'Update instructor profile',
      target: { path: 'instructors[]' }, value: edited, source: 'instructor_directed',
    }], { syllabusId: s._id, state, refs });
    const res = await post(s, `/suggestions/${doc._id}/accept`, { expectedRevision: revision });
    expect(res.status).toBe(200);
    expect(res.body.state.instructors[0]).toMatchObject({ officeHours: 'Fri 10:00-12:00' });
    const user = await User.findById(owner._id).lean();
    expect(user.lecturerProfile).toMatchObject({ officeHours: 'Fri 10:00-12:00', expertise: ['Negotiation', 'Leadership', 'Strategy', 'Ethics'], name: 'Jane Doe' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ officeHours: 'Fri 10:00-12:00' });
  });

  test('збій CRM не відкочує Confirm', async () => {
    jest.spyOn(crm, 'writeBack').mockRejectedValue(new Error('CRM down'));
    const { s, revision } = await withProfileCard();
    const { state } = await store.getState(s._id);
    const [doc] = await createDraftSuggestions([{
      origin: 'interviewer', severity: 'medium', kind: 'edit', title: 'Update instructor profile', target: { path: 'instructors[]' },
      value: [{ ...state.instructors[0], assistants: 'Mary Major' }], source: 'instructor_directed',
    }], { syllabusId: s._id, state, refs });
    const res = await post(s, `/suggestions/${doc._id}/accept`, { expectedRevision: revision });
    expect(res.status).toBe(200);
    expect((await User.findById(owner._id).lean()).lecturerProfile.assistants).toBe('Mary Major');
  });

  test('«Use my profile» (файл відрізняється): стан з профілю, без write-back', async () => {
    const spy = jest.spyOn(crm, 'writeBack');
    const { s, doc, revision } = await withProfileCard({
      parsedInstructor: { id: 'ins1', crmId: null, name: 'J. Doe', position: null, email: null, officeHours: null, assistants: null, expertise: [], education: [], experience: [], source: 'parsed', evidenceBlockIds: ['b1'] },
    });
    spy.mockClear();
    expect(doc.title).toBe('Your instructor details differ from your profile');
    expect(doc.options.map((o) => o.id)).toEqual(['use_profile', 'keep', 'update']);
    const res = await post(s, `/suggestions/${doc._id}/accept`, { optionId: 'use_profile', expectedRevision: revision });
    expect(res.status).toBe(200);
    expect(res.body.state.instructors[0]).toMatchObject({ name: 'Jane Doe', email: 'jane.doe@example.org' });
    expect(spy).not.toHaveBeenCalled();
  });

  test('«Keep the details from my file»: розпізнаний інструктор лишається, профіль не змінюється', async () => {
    const parsed = { id: 'ins1', crmId: null, name: 'J. Doe', position: null, email: null, officeHours: null, assistants: null, expertise: [], education: [], experience: [], source: 'parsed', evidenceBlockIds: ['b1'] };
    const spy = jest.spyOn(crm, 'writeBack');
    const { s, doc, revision } = await withProfileCard({ parsedInstructor: parsed });
    spy.mockClear();
    const res = await post(s, `/suggestions/${doc._id}/accept`, { optionId: 'keep', expectedRevision: revision });
    expect(res.status).toBe(200);
    expect(res.body.state.instructors[0]).toMatchObject({ name: 'J. Doe', source: 'parsed' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('B-10.3 — ім\'я викладача повністю', () => {
  const { fullNameOf } = require('../services/lecturers/profile');
  const user = { firstName: 'Olena', lastName: 'Khomenko' };
  test('порожнє або скорочене ім\'я профілю замінюється повним іменем облікового запису', () => {
    expect(fullNameOf('', user)).toBe('Olena Khomenko');
    expect(fullNameOf('Olena', user)).toBe('Olena Khomenko');
  });
  test('ім\'я з титулом чи по батькові лишається як є', () => {
    expect(fullNameOf('Dr. Olena Khomenko', user)).toBe('Dr. Olena Khomenko');
    expect(fullNameOf('Khomenko Olena Ivanivna', user)).toBe('Khomenko Olena Ivanivna');
  });
});
