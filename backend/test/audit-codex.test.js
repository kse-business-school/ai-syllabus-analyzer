// Регресійні тести за незалежним аудитом Codex від 05.11.2026 (C01–C16): обходи призначень, атомарність
// довідників і наборів, сканер фактів, структуровані картки. LLM мокається (services/ai/client.createResponse).
jest.mock('../services/ai/client', () => ({ ...jest.requireActual('../services/ai/client'), createResponse: jest.fn() }));
const request = require('supertest');
const helpers = require('./helpers');
const app = require('../server');
const Program = require('../models/Program');
const ProgramCode = require('../models/ProgramCode');
const Syllabus = require('../models/Syllabus');
const CourseOffering = require('../models/CourseOffering');
const ProgramOutcome = require('../models/ProgramOutcome');
const ReferenceOverride = require('../models/ReferenceOverride');
const CapstoneGuide = require('../models/CapstoneGuide');
const references = require('../services/references');
const store = require('../services/syllabusState/store');
const programs = require('../services/programs');
const editor = require('../services/references/editor');
const { seedReferences } = require('../services/references/seed');
const { createEmptyState } = require('../services/syllabusState/empty');
const { createDraftSuggestions } = require('../services/chat/draftSuggestions');
const { courseHintCards } = require('../services/ai/parse/cards');
const { scanFacts } = require('../services/ai/facts');
const slotDrafts = require('../services/ai/slotDrafts');
const { writeSlot } = require('../services/chat/slotWrite');
const assessmentChecks = require('../services/checks/assessment');
const ploChecks = require('../services/checks/plo');
const { loadFixtureRefs } = require('../services/references/fixtureRefs');
const { createResponse } = require('../services/ai/client');

let admin; let director; let lecturer; let other; let mba; let corporate;
const bearer = (user) => ({ Authorization: `Bearer ${helpers.tokenFor(user)}` });

beforeAll(async () => {
  await helpers.connectDb();
  await Program.seedDefaults();
  await seedReferences();
  await Promise.all([Syllabus, CourseOffering, ProgramCode, ReferenceOverride].map((m) => m.syncIndexes()));
  [admin, director, lecturer, other] = await Promise.all([
    helpers.createUser({ role: 'admin' }), helpers.createUser({ role: 'director' }), helpers.createUser(), helpers.createUser(),
  ]);
  mba = await Program.findOne({ code: 'MBA' });
  corporate = await Program.findOne({ code: 'CORPORATE' });
});
afterAll(helpers.disconnectDb);
beforeEach(() => { references.invalidateCache(); createResponse.mockReset(); });
afterEach(() => jest.restoreAllMocks());

const createSyllabus = (user, body) => request(app).post('/api/syllabus').set(bearer(user)).send({ programId: String(mba._id), programCode: 'MBA28', title: 'Course', ...body });
const offering = (courseCode, lecturerId, type = 'core', programCode = 'MBA28') => CourseOffering.create({ programCode, courseCode, type, lecturerId });

describe('C01 · C02 · C09 · C16 — призначення курс × набір', () => {
  test('C01: зміна коду неприв\'язаного силабуса на чужий курс → 403, на зайнятий → 409, на свій → прив\'язка', async () => {
    await offering('C01-FOREIGN', other._id);
    const own = await offering('C01-OWN', lecturer._id);
    const free = await createSyllabus(lecturer, { courseCode: 'C01-FREE' });
    const id = free.body.syllabus._id;
    const put = (courseCode, user = lecturer) => request(app).put(`/api/syllabus/${id}`).set(bearer(user)).send({ courseCode });
    expect((await put('c01-foreign')).status).toBe(403);
    const { state } = await store.getState(id);
    expect(state.header.courseCode).toBe('C01-FREE');

    const linked = await put('c01-own');
    expect(linked.status).toBe(200);
    const doc = await Syllabus.findById(id).lean();
    expect(String(doc.offeringId)).toBe(String(own._id));
    expect((await store.getState(id)).state.header).toMatchObject({ courseCode: 'C01-OWN', courseKind: 'core' });

    const second = await createSyllabus(lecturer, { courseCode: 'C01-OTHER' });
    const taken = await request(app).put(`/api/syllabus/${second.body.syllabus._id}`).set(bearer(lecturer)).send({ courseCode: 'C01-OWN' });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('OFFERING_TAKEN');
  });

  test('C02: явне призначення іншої програми → 400 OFFERING_PROGRAM_MISMATCH', async () => {
    const own = await offering('C02-OWN', lecturer._id);
    const res = await request(app).post('/api/syllabus').set(bearer(lecturer))
      .send({ title: 'X', programId: String(corporate._id), offeringId: String(own._id) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OFFERING_PROGRAM_MISMATCH');
  });

  test('C09: призначення того самого курсу з іншим регістром/пробілами → 409', async () => {
    const body = { programCode: 'MBA28', type: 'core', lecturerId: String(other._id) };
    expect((await request(app).post('/api/cabinet/offerings').set(bearer(director)).send({ ...body, courseCode: 'C09.1' })).status).toBe(201);
    const dup = await request(app).post('/api/cabinet/offerings').set(bearer(director)).send({ ...body, courseCode: 'c09 .1' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('OFFERING_EXISTS');
  });

  test('призначення для програми без наборів (код програми) приймається', async () => {
    const res = await request(app).post('/api/cabinet/offerings').set(bearer(director))
      .send({ programCode: 'CORPORATE', courseCode: 'CORP.1', type: 'elective' });
    expect(res.status).toBe(201);
  });

  test('C16: картка-підказка коду — вибір; Confirm проходить перевірку призначення (чуже → 403, своє → прив\'язка)', async () => {
    const card = courseHintCards({ code: 'C16-CORE', title: 'Core course' })[0];
    expect(card.kind).toBe('choice');
    const refs = await references.getRefs('MBA28');
    const make = async () => {
      const s = await helpers.createSyllabus(lecturer, { programCode: 'MBA28', track: 'upload', programId: mba._id });
      await store.initState(s._id, createEmptyState({ programCode: 'MBA28', track: 'upload', refs }), { refs });
      const { state } = await store.getState(s._id);
      const [sg] = await createDraftSuggestions([card], { syllabusId: s._id, state, refs, known: [] });
      return { s, sg };
    };
    const accept = (s, sg) => request(app).post(`/api/chat/${s._id}/suggestions/${sg._id}/accept`).set(bearer(lecturer)).send({ optionId: 'confirm' });
    const foreign = await offering('C16-CORE', other._id);
    references.invalidateCache(); // призначення створено моделлю напряму, а не через API кабінету
    const a = await make();
    expect((await accept(a.s, a.sg)).status).toBe(403);
    expect((await store.getState(a.s._id)).state.header.courseCode).toBeNull();
    await CourseOffering.updateOne({ _id: foreign._id }, { $set: { lecturerId: lecturer._id } });
    const ok = await accept(a.s, a.sg);
    expect(ok.status).toBe(200);
    expect((await store.getState(a.s._id)).state.header).toMatchObject({ courseCode: 'C16-CORE', courseKind: 'core' });
    expect(String((await Syllabus.findById(a.s._id).lean()).offeringId)).toBe(String(foreign._id));
  });
});

describe('C04 · C08 · C13 — редактор довідників', () => {
  // eslint-disable-next-line no-unused-vars
  let edt;
  beforeAll(async () => {
    edt = (await programs.createProgram({ name: 'Editor', code: 'EDTP', editions: ['C04A', 'C04B', 'C08', 'C13'].map((code) => ({ code })) })).program;
  });

  test('C04: збій запису повертає попередній перелік і не лишає позначки', async () => {
    await editor.saveOutcomes('C04A', [{ code: 'ПРН1', text: 'Старий.' }]);
    await ReferenceOverride.deleteOne({ programCode: 'C04A', kind: 'outcomes' });
    jest.spyOn(ProgramOutcome, 'bulkWrite').mockImplementationOnce(async () => { throw new Error('disk full'); });
    await expect(editor.saveOutcomes('C04A', [{ code: 'ПРН2', text: 'Новий.' }, { code: 'ПРН3', text: 'Новий.' }])).rejects.toThrow('disk full');
    expect((await ProgramOutcome.find({ programCode: 'C04A' }).lean()).map((o) => o.code)).toEqual(['ПРН1']);
    expect(await ReferenceOverride.exists({ programCode: 'C04A', kind: 'outcomes' })).toBeNull();
  });

  test('C04: одночасні заміни не дають об\'єднання двох списків', async () => {
    const results = await Promise.allSettled([
      editor.saveOutcomes('C04B', [{ code: 'ПРН1', text: 'A.' }]), editor.saveOutcomes('C04B', [{ code: 'ПРН2', text: 'B.' }]),
    ]);
    const codes = (await ProgramOutcome.find({ programCode: 'C04B' }).lean()).map((o) => o.code);
    expect(codes).toHaveLength(1);
    results.filter((r) => r.status === 'rejected').forEach((r) => expect(r.reason.code).toBe('REFERENCE_CONFLICT'));
  });

  test('C08: «PRN1» зберігається як канонічний «ПРН1», зв\'язки CLO не рвуться', async () => {
    await editor.saveOutcomes('C08', [{ code: 'ПРН1', text: 'Результат.' }]);
    const saved = await editor.saveOutcomes('C08', [{ code: 'PRN 1', text: 'Результат (ред.).' }]);
    expect(saved.map((o) => o.code)).toEqual(['ПРН1']);
    const refs = await references.getRefs('C08');
    const state = { programCode: 'C08', header: { courseKind: 'core' }, outcomes: [{ id: 'clo1', plo: [{ code: 'ПРН1', coverage: 'full', confirmed: true }] }] };
    expect(ploChecks.run(state, refs).find((c) => c.id.startsWith('plo.coverage')).passed).toBe(true);
  });

  test('C13: Capstone-критерій, названий у тексті силабуса, не видаляється; ключі зберігаються разом з текстом', async () => {
    await editor.saveCapstone('C13', { criteria: [{ name: 'Problem Definition', weight: 0.5 }, { name: 'Implementation', weight: 0.5 }] });
    const refs = await references.getRefs('C13');
    const s = await helpers.createSyllabus(lecturer, { programCode: 'C13', track: 'scratch' });
    const empty = createEmptyState({ programCode: 'C13', track: 'scratch', refs });
    // Звичайний шлях Confirm: { text, criteriaKeys } зливається з полями слота
    const written = writeSlot(empty, 'summary.capstone', { text: 'You develop skills for the Problem Definition criterion.', criteriaKeys: [] }, { source: 'ai_draft' });
    expect(written.summary.capstone).toMatchObject({ projectTypes: [], criteriaKeys: [], text: expect.stringContaining('Problem Definition') });
    await store.initState(s._id, written, { refs });
    await expect(editor.saveCapstone('C13', { criteria: [{ name: 'Implementation', weight: 1 }] })).rejects.toMatchObject({ code: 'CRITERION_IN_USE' });
    await expect(editor.saveCapstone('C13', { plagiarismThreshold: { similarityPercent: 200 } })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('C05 · C06 · C14 — набори програм', () => {
  test('C05: прибрати неявний код програми, який використовують силабуси, не можна; код не належить двом програмам', async () => {
    const implicit = (await programs.createProgram({ name: 'Implicit', code: 'IMPLICIT' })).program;
    await Syllabus.create({ title: 'Uses implicit', instructor: lecturer._id, programId: implicit._id, programCode: 'IMPLICIT', status: 'in_progress' });
    await expect(programs.setEditions(implicit._id, [{ code: 'IMPLICIT1' }])).rejects.toMatchObject({ code: 'EDITION_IN_USE' });
    const intensive = await Program.findOne({ code: 'INTENSIVE' });
    await expect(programs.setEditions(intensive._id, [{ code: 'IMPLICIT' }])).rejects.toMatchObject({ code: 'EDITION_CODE_TAKEN' });
  });

  test('C05: одночасне захоплення одного коду двома програмами — успішне лише одне', async () => {
    const a = (await programs.createProgram({ name: 'Race A', code: 'RACEA' })).program;
    const b = (await programs.createProgram({ name: 'Race B', code: 'RACEB' })).program;
    const results = await Promise.allSettled([programs.setEditions(a._id, [{ code: 'SHARED' }]), programs.setEditions(b._id, [{ code: 'SHARED' }])]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await Program.countDocuments({ 'editions.code': 'SHARED' })).toBe(1);
    expect(await ProgramCode.countDocuments({ code: 'SHARED' })).toBe(1);
  });

  test('C06: збій копіювання другого набору відкочує програму, коди й скопійовані довідники', async () => {
    let calls = 0;
    const real = CapstoneGuide.create.bind(CapstoneGuide);
    jest.spyOn(CapstoneGuide, 'create').mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('copy failed');
      return real(...args);
    });
    await expect(programs.createProgram({ name: 'Copy', code: 'COPYP', editions: [{ code: 'COPY1', copyFrom: 'MBA28' }, { code: 'COPY2', copyFrom: 'MBA28' }] }))
      .rejects.toThrow('copy failed');
    expect(await Program.exists({ code: 'COPYP' })).toBeNull();
    expect(await ProgramOutcome.countDocuments({ programCode: { $in: ['COPY1', 'COPY2'] } })).toBe(0);
    expect(await ProgramCode.countDocuments({ code: { $in: ['COPYP', 'COPY1', 'COPY2'] } })).toBe(0);
  });

  test('C14: програму, на набір якої посилається призначення, не видалити', async () => {
    const p = (await programs.createProgram({ name: 'Del', code: 'DELP', editions: [{ code: 'DEL1' }] })).program;
    await offering('DEL.1', null, 'elective', 'DEL1');
    const res = await request(app).delete(`/api/cabinet/programs/${p._id}`).set(bearer(admin));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EDITION_IN_USE');
  });
});

describe('C07 — тип курсу й затвердження одним записом', () => {
  test('mutate з новим courseKind знімає затвердження At a Glance і Learning Outcomes у тому самому записі', async () => {
    const refs = await references.getRefs('MBA28');
    const s = await helpers.createSyllabus(lecturer, { programCode: 'MBA28', track: 'scratch' });
    await store.initState(s._id, createEmptyState({ programCode: 'MBA28', track: 'scratch', refs, course: { code: 'C07.1' } }), { refs });
    await Syllabus.updateOne({ _id: s._id }, { $set: { 'state.sections': { at_a_glance: { approved: true }, learning_outcomes: { approved: true }, materials: { approved: true } } } });
    const { revision } = await store.getState(s._id);
    const result = await store.mutate(s._id, revision, (st) => st, { refs: { ...refs, offeringTypes: { 'C07.1': 'core' } } });
    expect(result.state.header.courseKind).toBe('core');
    expect(Object.keys(result.state.sections)).toEqual(['materials']);
  });
});

describe('C03 · C10 · C12 · C15 — факти й структуровані чернетки', () => {
  test('C03: межі числа, порядок дати й часу', () => {
    expect(scanFacts('8 hours', { known: ['48 hours'] }).map((f) => f.value)).toEqual(['8 hours']);
    expect(scanFacts('Due 2026-12-01', { known: ['due 2026-01-12'] }).map((f) => f.value)).toEqual(['2026-12-01']);
    expect(scanFacts('At 09:10', { known: ['at 10:09'] }).map((f) => f.value)).toEqual(['09:10']);
    expect(scanFacts('Due 1.12.2026 at 6:00 pm', { known: ['due 2026-12-01 at 18:00'] })).toEqual([]);
  });

  test('C10: компонент «class participation» з прапорцем потрапляє під детерміновану перевірку частки', () => {
    const refs = loadFixtureRefs('MBA28');
    const state = createEmptyState({ programCode: 'MBA28', refs });
    const part = slotDrafts.itemsDraft('assessment.components', { state, known: [], items: [{ id: null, label: 'Class participation', weight: 100, participation: true }] });
    expect(part.value[0].isParticipation).toBe(true);
    expect(assessmentChecks.run({ ...state, assessments: part.value }, refs).map((c) => c.id)).toContain('assessment.participation_share');
  });

  test('C12: зміна кількох фактів одного поля застосовується так само, як показано на картці', () => {
    const value = [{ id: 's1', topic: 'Read 10 pages and write 20 pages' }];
    const before = [{ id: 'v1', value: '10 pages', path: '[s1].topic' }, { id: 'v2', value: '20 pages', path: '[s1].topic' }];
    const after = [{ ...before[0], value: '20 pages' }, { ...before[1], value: '30 pages' }];
    expect(slotDrafts.applyFieldValues(value, before, after).value[0].topic).toBe('Read 20 pages and write 30 pages');
  });

  test('C15: вигадані ім\'я, посада й установа профілю — окремі proposedValues', () => {
    const state = createEmptyState({ programCode: 'MBA28', refs: loadFixtureRefs('MBA28') });
    const part = slotDrafts.instructorDraft({
      state, known: ['Please suggest a profile'],
      values: { name: 'Invented Person', position: 'Professor at Imaginary University', education: ['PhD, Nowhere University'] },
    });
    expect(part.proposedValues.map((v) => v.value)).toEqual(['Invented Person', 'Professor at Imaginary University', 'PhD, Nowhere University']);
  });
});

describe('C11 — Reword структурованої картки', () => {
  test('Reword картки компонентів оцінювання замінює її чернетку новою з propose_items', async () => {
    const refs = await references.getRefs('MBA28');
    const s = await helpers.createSyllabus(lecturer, { programCode: 'MBA28', track: 'scratch' });
    await store.initState(s._id, createEmptyState({ programCode: 'MBA28', track: 'scratch', refs }), { refs });
    const { state } = await store.getState(s._id);
    const part = slotDrafts.itemsDraft('assessment.components', { state, known: [], items: [{ id: null, label: 'Exam', weight: 100 }] });
    const [card] = await createDraftSuggestions([{ origin: 'orchestrator', kind: 'edit', severity: 'medium', title: 'Draft', ...part, factsScanned: true }], { syllabusId: s._id, state, refs, known: [] });
    createResponse.mockImplementation(async (req) => {
      if (req.input.some((i) => i.type === 'function_call_output')) return { output_text: 'Updated.', output: [] };
      expect(req.input.some((i) => i.role === 'system' && /change the draft on their card/.test(i.content))).toBe(true);
      return { output: [{ type: 'function_call', call_id: 'c1', name: 'propose_items', arguments: JSON.stringify({ key: 'assessment.components', mode: 'replace', items: [{ id: null, label: 'Final exam', weight: 100 }] }) }] };
    });
    const res = await request(app).post(`/api/chat/${s._id}/suggestions/${card._id}/refine`).set(bearer(lecturer)).send({ feedback: 'Call it Final exam' });
    expect(res.status).toBe(200);
    const view = res.body.suggestions.find((v) => v.id === String(card._id));
    expect(view.draft.value.map((a) => a.name)).toEqual(['Final exam']);
    expect(res.body.suggestions.filter((v) => v.status === 'pending' && v.target.path === 'assessments[]')).toHaveLength(1);
  });
});
