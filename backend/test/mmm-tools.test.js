// Інструменти чату для слотів MMM (B-3.1, B-3.4, B-6.2, B-6.3, B-8.2, B-8.4, B-8.6) — чисті функції, без БД і LLM.
const { itemsDraft } = require('../services/ai/slotDrafts');
const { slotKeysOf, buildTools } = require('../services/ai/tools/definitions');
const { HANDLERS } = require('../services/ai/tools/handlers');
const { createEmptyState } = require('../services/syllabusState/empty');
const { loadFixtureRefs } = require('../services/references/fixtureRefs');

const mmm = loadFixtureRefs('MMM26');
const mba = loadFixtureRefs('MBA28');
const e = { source: 'instructor_directed', evidenceBlockIds: [] };
const base = () => {
  const s = createEmptyState({ programCode: 'MMM26', refs: mmm, language: 'uk' });
  s.modules = [{ id: 'mod1', n: 1, title: 'Основи', ...e }];
  s.guests = [{ id: 'g1', name: 'Олена Коваль', company: null, topic: null, format: null, status: 'confirmed', ...e }];
  return s;
};

describe('слоти за профілем програми', () => {
  test('MMM має гостей, модулі, матеріали за сесіями й блок програми; MBA — ні', () => {
    const m = slotKeysOf(createEmptyState({ refs: mmm }), mmm);
    expect(m).toEqual(expect.arrayContaining(['guests.list', 'schedule.modules', 'materials.by_session', 'glance.program_block', 'course.practical_application']));
    expect(m).not.toContain('course.objectives');
    const b = slotKeysOf(createEmptyState({ refs: mba }), mba);
    expect(b).not.toContain('guests.list');
    expect(b).not.toContain('glance.program_block');
    const tool = buildTools(createEmptyState({ refs: mba }), mba).find((t) => t.name === 'propose_items');
    expect(tool.parameters.properties.key.enum).not.toContain('guests.list');
  });
});

describe('propose_items: нові списки й поля', () => {
  const known = ['Сесія 1: Вступ, модуль 1, гість Олена Коваль, підготовка: відео 15 хв. Участь: 0 — немає внеску, 1 — частковий, 2 — повний; 7 лекцій по 2 бали, 14 балів.'];

  test('сесія з модулем, підготовкою і гостем; невідомий модуль — помилка', () => {
    const part = itemsDraft('schedule.sessions', { state: base(), known, items: [{ id: null, label: 'Вступ', module_id: 'mod1', prep: 'відео 15 хв', guest_id: 'g1' }] });
    expect(part.value[0]).toMatchObject({ topic: 'Вступ', moduleId: 'mod1', prep: 'відео 15 хв', guestId: 'g1' });
    expect(itemsDraft('schedule.sessions', { state: base(), known, items: [{ id: null, label: 'X', module_id: 'nope' }] }).error).toBe('INVALID_VALUE');
  });

  test('гості й модулі як окремі списки', () => {
    expect(itemsDraft('guests.list', { state: base(), known: ['Іван Петренко, Brand Co'], items: [{ id: null, label: 'Іван Петренко', company: 'Brand Co', status: 'tbd' }] }).value[1])
      .toMatchObject({ name: 'Іван Петренко', company: 'Brand Co', status: 'tbd' });
    expect(itemsDraft('schedule.modules', { state: base(), known: ['Модуль 2 Аналітика'], items: [{ id: null, label: 'Аналітика' }] }).value.map((m) => m.n)).toEqual([1, 2]);
  });

  test('бали з рубрикою — лише дослівно від викладача', () => {
    const rubric = [{ points: 0, descriptor: 'немає внеску' }, { points: 1, descriptor: 'частковий' }, { points: 2, descriptor: 'повний' }];
    const ok = itemsDraft('assessment.components', { state: base(), known, items: [{ id: null, label: 'Участь', max_points: 14, unit_count: 7, rubric }] });
    expect(ok.value[0]).toMatchObject({ maxPoints: 14, unitCount: 7, rubric });
    const invented = itemsDraft('assessment.components', { state: base(), known, items: [{ id: null, label: 'Участь', rubric: [{ points: 3, descriptor: 'відмінно' }] }] });
    expect(invented.error).toBe('RUBRIC_NOT_STATED');
  });
});

describe('set_slot: корпус і блок програми', () => {
  const tctx = (state, utterance) => ({
    state, refs: mmm, lastUtterance: utterance, utterances: [utterance], wrote: false, conversationSlotKey: null,
    deps: { mutate: async (id, rev, fn) => { const next = structuredClone(state); return { state: fn(next) || next, revision: 1, changes: [{}] }; } },
  });
  test('«блок 2.2» → повна назва зі списку; значення поза списком — помилка', async () => {
    const ctx = tctx(base(), 'Мій курс у блоці 2.2');
    expect(await HANDLERS.set_slot(ctx, { key: 'glance.program_block', value: '2.2' })).toMatchObject({ ok: true });
    expect(ctx.state.header.programBlock).toBe('2.2 Підходи до агресивного зростання');
    expect(await HANDLERS.set_slot(tctx(base(), 'блок 9.9'), { key: 'glance.program_block', value: '9.9' })).toMatchObject({ error: 'INVALID_VALUE' });
  });
});

describe('B-6.3: перевірка балів', () => {
  const assessmentChecks = require('../services/checks/assessment');
  const comp = (maxPoints) => ({ id: 'as1', name: 'Участь', weight: 30, criteria: 'x', deadline: 'y', maxPoints, unitCount: 7, rubric: [{ points: 0, descriptor: 'a' }, { points: 2, descriptor: 'b' }] });
  test('7 × 2 = 14 — без зауважень; 7 × 2 ≠ 15 — high', () => {
    const ids = (a) => assessmentChecks.run({ language: 'uk', header: {}, sessions: [], assessments: [a] }, {}).map((c) => c.id);
    expect(ids(comp(14))).not.toContain('assessment.points_consistency:as1');
    expect(ids(comp(15))).toContain('assessment.points_consistency:as1');
  });
});

describe('B-9.3: прохідний бал програми', () => {
  const regulations = require('../services/checks/regulations');
  const state = { language: 'en', header: {}, sessions: [], assessments: [], outcomes: [], instructors: [], summary: {}, policies: [{ key: 'policy.passing', mode: 'locked', text: 'To pass the course a student must earn at least 50 points out of 100.' }] };
  const ids = (refs) => regulations.run(state, refs).map((c) => c.id);
  test('за замовчуванням — 60 школи; програма з порогом 50 вважає 50 правильним', () => {
    expect(ids({})).toContain('regulations.passing_score');
    expect(ids({ passingScore: 50 })).not.toContain('regulations.passing_score');
  });
});

describe('аудит B: факти українською і блок програми', () => {
  test('B02: «20 годин підготовки» за відомих «20 студентів» — proposedValue; слова-числа й дати теж', () => {
    const part = itemsDraft('schedule.sessions', { state: base(), known: ['Курс розрахований на 20 студентів'], items: [{ id: null, label: 'Вступ', prep: '20 годин підготовки', deadline: 'першого грудня' }] });
    expect(part.proposedValues.map((v) => v.value)).toEqual(expect.arrayContaining(['20 годин', 'першого грудня']));
  });
  test('B03: propose_draft для блоку програми — лише зі списку', async () => {
    const ctx = { state: base(), refs: mmm, lastUtterance: 'Мій блок 9.9', utterances: ['Мій блок 9.9'], createdIds: [], deps: { createDraftSuggestions: async () => [{ _id: 'x', draft: {} }] } };
    expect(await HANDLERS.propose_draft(ctx, { key: 'glance.program_block', text: '9.9' })).toMatchObject({ error: 'INVALID_VALUE' });
  });
});
