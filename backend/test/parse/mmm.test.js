// Розбір силабуса MMM (B-8.8): українські розділи 0–9, модулі, гості, бали з рубрикою, матеріали за сесіями,
// ПРН рівня курсу. Витяг — синтетичний (як відповідь LLM), файли пакета ТЗ у тести не потрапляють.
const { toState } = require('../../services/ai/parse/toState');
const { sanitize, validateExtraction, buildSchema } = require('../../services/ai/parse/extractSlots');
const { programmeOutcomeCards } = require('../../services/ai/parse/cards');
const { validateState } = require('../../services/syllabusState/schema');
const { renderState, renderText } = require('../../services/syllabusState/render');
const { slots: mbaSlots, textItem, refs } = require('./fixtures');

const mmm = refs('MMM26');
const ids = (n) => [`b${String(n).padStart(4, '0')}`];
const blocks = Array.from({ length: 40 }, (_, i) => ({ id: `b${String(i + 1).padStart(4, '0')}`, kind: 'paragraph', text: '' }));
blocks[19].text = '7 лекцій × максимум 2 бали = 14 балів; 0 — немає внеску, 1 — частковий, 2 — повний';

const mmmSlots = () => ({
  ...mbaSlots(),
  header: {
    title: 'Кількісні маркетингові дослідження', code: null, department: null, ects: 3, totalHours: null, language: 'Українська', studyMode: null,
    deliveryFormat: 'offline', termText: null, termStart: null, termEnd: null, programBlock: 'Корпус 1 → блок 1.1 Consumer & Research', blockIds: ids(1),
  },
  shortDescription: textItem('Курс вчить ухвалювати маркетингові рішення на основі кількісних даних, а не інтуїції.', ids(2)),
  objectives: [],
  outcomes: [
    { id: 'clo1', text: 'Спланувати кількісне дослідження для власного бізнесу', ploCodes: [], blockIds: ids(3) },
    { id: 'clo2', text: 'Оцінити якість вибірки', ploCodes: [], blockIds: ids(4) },
  ],
  practicalApplication: textItem('Учасники проводять опитування клієнтів власної компанії і презентують висновки.', ids(5)),
  programmeOutcomes: [{ ploCode: mmm.outcomes[0].code, text: 'Курс дає дані для інтегрованої системи.', blockIds: ids(6) }],
  modules: [{ id: 'm_a', title: 'Основи досліджень', blockIds: ids(7) }, { id: 'm_b', title: 'Аналіз даних', blockIds: ids(8) }],
  sessions: [
    { topic: 'Вступ', type: null, hours: 2, format: null, guest: null, additional: 'Воркшоп', date: null, time: null, moduleId: 'm_a', prep: 'Відео 15 хв', deadline: '', blockIds: ids(9) },
    { topic: 'Вибірка', type: null, hours: 2, format: null, guest: 'Олена Коваль', additional: null, date: null, time: null, moduleId: 'm_a', prep: '', deadline: '', blockIds: ids(10) },
    { topic: 'Регресія', type: null, hours: 2, format: null, guest: null, additional: null, date: null, time: null, moduleId: 'm_b', prep: '', deadline: '20.12.2026', blockIds: ids(11) },
  ],
  guests: [{ name: 'Олена Коваль', company: 'Brand Co, CMO', topic: 'Кейс, Q&A', status: 'confirmed', blockIds: ids(12) }],
  individualWork: [],
  assessments: [{
    id: 'as1', name: 'Активна участь', weight: 30, criteria: 'Якість внеску', deadline: 'Увесь курс', isParticipation: true, isControl: false, outcomeIds: [],
    maxPoints: 14, unitCount: 7, rubric: [{ points: 0, descriptor: 'немає внеску' }, { points: 1, descriptor: 'частковий' }, { points: 2, descriptor: 'повний' }, { points: 5, descriptor: 'вигадано' }],
    blockIds: ids(20),
  }],
  materials: {
    required: [{ citation: 'Sharp B. How Brands Grow', url: null, blockIds: ids(13) }],
    recommended: [],
    bySession: [{ session: '2.1', citation: 'Стаття про регресію', url: null, blockIds: ids(14) }],
  },
  policySegments: [],
});

test('схема витягу має поля MMM; невідомий модуль сесії — помилка валідації', () => {
  const schema = buildSchema(mmm.outcomes.map((o) => o.code));
  expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['modules', 'guests', 'practicalApplication', 'programmeOutcomes']));
  const x = mmmSlots();
  x.sessions[0].moduleId = 'nope';
  expect(validateExtraction(x, blocks, mmm).join(' ')).toMatch(/unknown moduleId nope/);
});

test('рівні рубрики з балами, яких немає в цитованих блоках, відкидаються', () => {
  const { slots, warnings } = sanitize(mmmSlots(), blocks);
  expect(slots.assessments[0].rubric.map((r) => r.points)).toEqual([0, 1, 2]);
  expect(warnings.join(' ')).toMatch(/rubric/);
});

test('стан MMM: мова uk, блок програми зі списку, модулі, гості, бали, матеріали за сесіями — валідний', () => {
  const state = toState({ slots: sanitize(mmmSlots(), blocks).slots, programCode: 'MMM26', refs: mmm });
  expect(validateState(state)).toEqual([]);
  expect(state.language).toBe('uk');
  expect(state.header.programBlock).toBe('1.1 Consumer & Research');
  expect(state.modules.map((m) => [m.id, m.title])).toEqual([['mod1', 'Основи досліджень'], ['mod2', 'Аналіз даних']]);
  expect(state.sessions.map((s) => s.moduleId)).toEqual(['mod1', 'mod1', 'mod2']);
  expect(state.sessions[0].prep).toBe('Відео 15 хв');
  expect(state.sessions[1].guestId).toBe('g1');
  expect(state.guests[0]).toMatchObject({ name: 'Олена Коваль', status: 'confirmed', source: 'parsed' });
  expect(state.assessments[0]).toMatchObject({ maxPoints: 14, unitCount: 7 });
  expect(state.materials.bySession[0]).toMatchObject({ sessionId: 's3', citation: 'Стаття про регресію' });
  expect(state.summary.practicalApplication.text).toMatch(/опитування/);
  const text = renderText(renderState(state, mmm));
  expect(text).toContain('## 4. Структура курсу та розклад занять');
  expect(text).toContain('2.1 | Регресія');
});

test('ПРН із розділу 1 файлу — картка-питання, а не непідтверджені зв\'язки', () => {
  const state = toState({ slots: mmmSlots(), programCode: 'MMM26', refs: mmm });
  expect(state.outcomes.every((o) => o.plo.length === 0)).toBe(true);
  const [card] = programmeOutcomeCards(mmmSlots().programmeOutcomes, state, mmm);
  expect(card).toMatchObject({ kind: 'question', target: { section: 'programme_outcomes' } });
  expect(card.question).toContain(mmm.outcomes[0].code);
  // У MBA розділу немає — картки теж
  expect(programmeOutcomeCards(mmmSlots().programmeOutcomes, state, refs('MBA28'))).toEqual([]);
});

test('B01: рівень рубрики з вигаданим описом чи URL відкидається, навіть якщо бал написано', () => {
  const x = mmmSlots();
  x.assessments[0].rubric = [{ points: 2, descriptor: 'Analyze the Secret Example Corporation case at https://invented.example/audit' }, { points: 1, descriptor: 'частковий' }];
  const { slots, warnings } = sanitize(x, blocks);
  expect(slots.assessments[0].rubric).toEqual([{ points: 1, descriptor: 'частковий' }]);
  expect(warnings.join(' ')).toMatch(/rubric/);
});

test('B06: українські тексти політик із файлу збігаються з textUk довідника; locked — українською', async () => {
  const { matchPolicies } = require('../../services/ai/parse/policyMatch');
  const attendance = mmm.policyLibrary.blocks.find((b) => b.key === 'policy.attendance');
  const absence = mmm.policyLibrary.blocks.find((b) => b.key === 'policy.absence');
  const segments = [{ text: attendance.options[0].textUk, blockIds: ids(30), topicHint: 'attendance' }];
  const res = await matchPolicies({ segments, refs: mmm, language: 'uk' }, {
    classify: async () => [{ segmentIndex: 0, blockKey: 'policy.attendance', optionKey: attendance.options[0].key, match: 'exact' }],
  });
  expect(res.matches[0]).toMatchObject({ key: 'policy.attendance', candidateOptionKey: attendance.options[0].key });
  expect(res.policies.find((p) => p.key === 'policy.absence').text).toBe(absence.textUk);
});
