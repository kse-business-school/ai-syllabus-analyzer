// Редактор довідників набору: ПРН, нормативні курси, Capstone (PUT /api/references/:programCode/*).
const request = require('supertest');
const helpers = require('./helpers');
const app = require('../server');
const Program = require('../models/Program');
const Syllabus = require('../models/Syllabus');
const ProgramOutcome = require('../models/ProgramOutcome');
const references = require('../services/references');
const store = require('../services/syllabusState/store');
const { seedReferences } = require('../services/references/seed');
const { createEmptyState } = require('../services/syllabusState/empty');

let manager; let lecturer; let mba;
const bearer = (user) => ({ Authorization: `Bearer ${helpers.tokenFor(user)}` });
const put = (code, kind, body, user = manager) => request(app).put(`/api/references/${code}/${kind}`).set(bearer(user)).send(body);

beforeAll(async () => {
  await helpers.connectDb();
  await Program.seedDefaults();
  await seedReferences();
  manager = await helpers.createUser({ role: 'manager' });
  lecturer = await helpers.createUser();
  mba = await Program.findOne({ code: 'MBA' });
  // Порожній новий набір, як після «Start empty»
  await request(app).put(`/api/cabinet/programs/${mba._id}`).set(bearer(await helpers.createUser({ role: 'admin' })))
    .send({ editions: [{ code: 'MBA27' }, { code: 'MBA28' }, { code: 'MBA30', label: 'MBA30' }] });
});
afterAll(helpers.disconnectDb);
beforeEach(() => references.invalidateCache());

async function syllabusIn(programCode, { courseCode = null, plo = [], criteriaKeys = [] } = {}) {
  const refs = await references.getRefs(programCode);
  const s = await helpers.createSyllabus(lecturer, { programCode, track: 'scratch', course: { code: courseCode } });
  const state = createEmptyState({ programCode, track: 'scratch', refs, course: { title: 'X', code: courseCode } });
  state.outcomes = plo.length ? [{ id: 'clo1', text: 'Apply', plo, assessmentIds: [], source: 'ai_draft', evidenceBlockIds: [] }] : [];
  state.summary.capstone.criteriaKeys = criteriaKeys;
  await store.initState(s._id, state, { refs });
  return s;
}

test('ПРН нового набору: додати, змінити, впорядкувати; доступ — лише manager/director/admin', async () => {
  expect((await put('MBA30', 'outcomes', { outcomes: [] }, lecturer)).status).toBe(403);
  const res = await put('MBA30', 'outcomes', { outcomes: [
    { code: 'ПРН1', text: 'Стратегічне мислення в умовах невизначеності.', label: 'Strategic thinking' },
    { code: 'ПРН2', text: 'Лідерство та управління змінами.', label: '' },
  ] });
  expect(res.status).toBe(200);
  expect(res.body.map((o) => [o.code, o.order, o.label])).toEqual([['ПРН1', 1, 'Strategic thinking'], ['ПРН2', 2, '']]);
  const reordered = await put('MBA30', 'outcomes', { outcomes: [
    { code: 'ПРН2', text: 'Лідерство та управління змінами (ред. 2).', label: 'Leadership' }, { code: 'ПРН1', text: 'Стратегічне мислення.', label: 'Strategy' },
  ] });
  expect(reordered.body.map((o) => o.code)).toEqual(['ПРН2', 'ПРН1']);
  expect((await references.getRefs('MBA30')).outcomes[0]).toMatchObject({ code: 'ПРН2', label: 'Leadership' });
  expect((await put('MBA30', 'outcomes', { outcomes: [{ code: 'ПРН1', text: '' }] })).body.code).toBe('VALIDATION_ERROR');
  expect((await put('MBA30', 'outcomes', { outcomes: [{ code: 'ПРН1', text: 'a' }, { code: 'PRN1', text: 'b' }] })).status).toBe(400);
  expect((await put('NOPE99', 'outcomes', { outcomes: [] })).status).toBe(404);
});

test('ПРН, з яким пов\'язані результати курсу силабусів набору, не видаляється', async () => {
  await syllabusIn('MBA30', { plo: [{ code: 'ПРН1', coverage: 'full', confirmed: true }] });
  const res = await put('MBA30', 'outcomes', { outcomes: [{ code: 'ПРН2', text: 'Лідерство.' }] });
  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({ code: 'OUTCOME_IN_USE', codes: ['ПРН1'] });
  expect(await ProgramOutcome.exists({ programCode: 'MBA30', code: 'ПРН1' })).toBeTruthy();
});

test('сід не перезаписує ПРН набору, зміненого в кабінеті, і не повертає видалені', async () => {
  const before = (await references.getRefs('MBA28')).outcomes;
  const kept = before.slice(0, 3).map((o, i) => ({ code: o.code, text: i === 0 ? `${o.text} (edited)` : o.text, label: o.label }));
  expect((await put('MBA28', 'outcomes', { outcomes: kept })).status).toBe(200);
  await seedReferences();
  references.invalidateCache();
  const after = (await references.getRefs('MBA28')).outcomes;
  expect(after.map((o) => o.code)).toEqual(kept.map((o) => o.code));
  expect(after[0].text).toMatch(/\(edited\)$/);
});

test('нормативний курс: додавання робить курс core у силабусах набору, прибирання — elective', async () => {
  const s = await syllabusIn('MBA30', { courseCode: 'NEW.1' });
  expect((await store.getState(s._id)).state.header.courseKind).toBe('elective');
  const add = await put('MBA30', 'courses', { courses: [{ code: 'NEW.1', uk: 'Новий курс', en: 'New course', ects: 3 }] });
  expect(add.status).toBe(200);
  expect(add.body).toMatchObject({ courses: [{ code: 'NEW.1', ects: 3 }], resynced: 1 });
  expect((await store.getState(s._id)).state.header.courseKind).toBe('core');
  await put('MBA30', 'courses', { courses: [] });
  expect((await store.getState(s._id)).state.header.courseKind).toBe('elective');
  expect((await put('MBA30', 'courses', { courses: [{ code: 'X', uk: 'X', ects: -1 }] })).status).toBe(400);
});

test('Capstone: критерії з вагами 100%, ключі з назв; критерій, який згадують силабуси, не видаляється', async () => {
  const bad = await put('MBA30', 'capstone', { criteria: [{ name: 'Problem', weight: 0.5 }] });
  expect(bad.body.message).toMatch(/add up to 100%/);
  const ok = await put('MBA30', 'capstone', {
    projectTypes: [{ label: 'New Business' }], structure: ['Diagnostics', 'Plan'],
    criteria: [{ name: 'Problem Definition', weight: 0.4, description: 'Clarity.' }, { name: 'Implementation', weight: 0.6 }],
  });
  expect(ok.status).toBe(200);
  expect(ok.body.criteria.map((c) => [c.key, c.weight])).toEqual([['problem_definition', 0.4], ['implementation', 0.6]]);
  expect((await references.getRefs('MBA30')).capstone.criteria).toHaveLength(2);
  await syllabusIn('MBA30', { criteriaKeys: ['implementation'] });
  const removing = await put('MBA30', 'capstone', { criteria: [{ key: 'problem_definition', name: 'Problem Definition', weight: 1 }] });
  expect(removing.status).toBe(409);
  expect(removing.body.code).toBe('CRITERION_IN_USE');
});

test('програма без наборів має власні довідники за своїм кодом', async () => {
  const res = await put('CORPORATE', 'outcomes', { outcomes: [{ code: 'ПРН1', text: 'Корпоративний результат.' }] });
  expect(res.status).toBe(200);
  expect((await references.getRefs('CORPORATE')).outcomes).toHaveLength(1);
});
