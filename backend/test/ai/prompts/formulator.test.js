jest.mock('../../../services/ai/client', () => ({ createResponse: jest.fn(), llmModel: 'gpt-test' }));
const { createResponse } = require('../../../services/ai/client');
const { respond, assertStrictSchema } = require('../helpers');
const { loadFixtureRefs } = require('../../../services/references/fixtureRefs');
const { createEmptyState } = require('../../../services/syllabusState/empty');
const { riskManagementState } = require('../../fixtures/state/riskManagement');
const { buildDraftSuggestion } = require('../../../services/chat/draftSuggestions');
const { draftFromNarrative, reword } = require('../../../services/ai/prompts/formulator');

const refs = loadFixtureRefs('MBA28');
const state = createEmptyState({ programCode: 'MBA28', refs, course: { title: 'Risk Management' } });
const CRITERIA = refs.capstone.criteria.map((c) => c.key);

const DESCRIPTION = 'You will learn to see risk before it becomes a crisis. Together we work through real company stories. You leave with a practical toolkit you can use on Monday.';
const draft = (slotKey, text, extra = {}) => ({ slotKey, text, criteriaKeys: [], proposedValues: [], rationale: 'From your description.', ...extra });
const schemaOf = (n = 0) => createResponse.mock.calls[n][0].text.format;

beforeEach(() => createResponse.mockReset());

test('одна розповідь → чернетки кількох D-слотів; strict-схема з enum слотів і критеріїв Capstone', async () => {
  createResponse.mockResolvedValue(respond({ drafts: [
    draft('course.description', DESCRIPTION),
    draft('course.objectives', 'Introduce core risk frameworks\nBuild a risk register for a real company'),
    draft('course.outcomes', '- Apply risk frameworks to real cases\n- Design mitigation strategies'),
    draft('course.capstone', 'This course prepares you for the analytical depth and the implementation plan of your Capstone.', { criteriaKeys: ['analytical_depth', 'implementation_plan'] }),
  ] }));
  const out = await draftFromNarrative({
    state, refs, narrative: 'A course about spotting and managing risk using real company cases.',
    slotKeys: ['course.description', 'course.objectives', 'course.outcomes', 'course.capstone'], transcript: ['It is about risk'],
  });

  const { format } = createResponse.mock.calls[0][0].text;
  expect(format).toMatchObject({ type: 'json_schema', strict: true });
  assertStrictSchema(format.schema);
  const item = format.schema.properties.drafts.items.properties;
  expect(item.slotKey.enum).toEqual(['course.description', 'course.objectives', 'course.outcomes', 'course.capstone']);
  expect(item.criteriaKeys.items.enum).toEqual(CRITERIA);
  expect(createResponse.mock.calls[0][0].input[0].content).toContain('Never add unnoticed');

  expect(out.map((d) => d.slotKey)).toEqual(['course.description', 'course.objectives', 'course.outcomes', 'course.capstone']);
  expect(out[0]).toMatchObject({ kind: 'edit', target: { path: 'summary.shortDescription' }, value: DESCRIPTION, text: DESCRIPTION });
  expect(out[1]).toMatchObject({ target: { path: 'summary.objectives[]' } });
  expect(out[1].value).toEqual([
    expect.objectContaining({ id: 'obj1', text: 'Introduce core risk frameworks', source: 'ai_draft' }),
    expect.objectContaining({ id: 'obj2', text: 'Build a risk register for a real company' }),
  ]);
  expect(out[2].value.map((o) => o.text)).toEqual(['Apply risk frameworks to real cases', 'Design mitigation strategies']);
  expect(out[2].value[0]).toMatchObject({ plo: [], assessmentIds: [] });
  expect(out[3].target.path).toBe('summary.capstone');
  expect(out[3].description).toContain('Analytical Depth and Methodology');

  // Результат — готовий вхід для createDraftSuggestions
  const card = buildDraftSuggestion({ origin: 'orchestrator', ...out[0] }, { syllabusId: 's1', state, refs, known: [] });
  expect(card).toMatchObject({ kind: 'edit', section: 'short_description', draft: { value: DESCRIPTION } });
});

test('слоти поза D-списком ігноруються, без слотів/розповіді моделі не викликають', async () => {
  expect(await draftFromNarrative({ state, refs, narrative: 'x', slotKeys: ['glance.program', 'policy.late'] })).toEqual([]);
  expect(await draftFromNarrative({ state, refs, narrative: '  ', slotKeys: ['course.description'] })).toEqual([]);
  expect(createResponse).not.toHaveBeenCalled();
});

test('description: 3–5 речень і звертання «you» перевіряються кодом із коригувальним повтором', async () => {
  createResponse
    .mockResolvedValueOnce(respond({ drafts: [draft('course.description', 'Students will study risk. It is useful.')] }))
    .mockResolvedValueOnce(respond({ drafts: [draft('course.description', DESCRIPTION)] }));
  const out = await draftFromNarrative({ state, refs, narrative: 'risk', slotKeys: ['course.description'] });
  expect(out[0].value).toBe(DESCRIPTION);
  expect(createResponse).toHaveBeenCalledTimes(2);
  const retry = createResponse.mock.calls[1][0].input[1].content;
  expect(retry).toContain('3 to 5 sentences');
  expect(retry).toContain('address the reader as "you"');
});

test('outcomes мусять починатися з дієслова; capstone — називати критерій', async () => {
  createResponse
    .mockResolvedValueOnce(respond({ drafts: [draft('course.outcomes', 'The ability to apply frameworks\nStudents will design plans'), draft('course.capstone', 'Prepares you for the Capstone.', { criteriaKeys: [] })] }))
    .mockResolvedValueOnce(respond({ drafts: [draft('course.outcomes', 'Apply frameworks\nDesign plans'), draft('course.capstone', 'Prepares you for solution design.', { criteriaKeys: ['solution_design'] })] }));
  const out = await draftFromNarrative({ state, refs, narrative: 'risk', slotKeys: ['course.outcomes', 'course.capstone'] });
  expect(out).toHaveLength(2);
  const retry = createResponse.mock.calls[1][0].input[1].content;
  expect(retry).toMatch(/start with an action verb/);
  expect(retry).toMatch(/at least one Capstone criterion/);
});

test('кожен слот рівно один раз; невідомий ключ критерію відхиляє strict-валідація', async () => {
  createResponse.mockResolvedValue(respond({ drafts: [draft('course.capstone', 'Prepares you for it.', { criteriaKeys: ['made_up'] })] }));
  await expect(draftFromNarrative({ state, refs, narrative: 'risk', slotKeys: ['course.capstone'] })).rejects.toThrow(/invalid enum/);
  expect(createResponse).toHaveBeenCalledTimes(3);
});

test('факти моделі повертаються як proposedValues', async () => {
  createResponse.mockResolvedValue(respond({ drafts: [draft('course.objectives', 'Cover 5 frameworks', { proposedValues: [{ label: 'Count', value: '5 frameworks' }] })] }));
  const [out] = await draftFromNarrative({ state, refs, narrative: 'risk', slotKeys: ['course.objectives'] });
  expect(out.proposedValues).toEqual([{ label: 'Count', value: '5 frameworks' }]);
});

describe('reword', () => {
  const suggestion = (value, path = 'summary.shortDescription') => ({ target: { path }, draft: { value, proposedValues: [] } });
  const reply = (text) => respond({ text, proposedValues: [], rationale: 'Shorter as asked.', title: 'Shorter description', description: 'Shortened to three sentences.' });
  const rmState = riskManagementState();

  test('текстова чернетка → нова версія, відгук іде в запит', async () => {
    createResponse.mockResolvedValue(reply(DESCRIPTION));
    const out = await reword({ suggestion: suggestion('Old text for you. Long. Very long.'), feedback: 'make it shorter', state: rmState, refs, transcript: [] });
    expect(out).toMatchObject({ text: DESCRIPTION, value: DESCRIPTION, rationale: 'Shorter as asked.', title: 'Shorter description', proposedValues: [] });
    assertStrictSchema(schemaOf().schema);
    expect(createResponse.mock.calls[0][0].input[1].content).toContain('make it shorter');
  });

  test('список: id наявних сутностей зберігаються', async () => {
    createResponse.mockResolvedValue(reply('Analyze risk\nDesign controls'));
    const current = [{ id: 'clo1', text: 'Apply frameworks', plo: [{ code: 'ПРН1', coverage: 'full', confirmed: true }], assessmentIds: ['as1'], source: 'parsed', evidenceBlockIds: [] }];
    const out = await reword({ suggestion: suggestion(current, 'outcomes[]'), feedback: 'use stronger verbs', state: rmState, refs });
    expect(out.value[0]).toMatchObject({ id: 'clo1', text: 'Analyze risk', plo: [{ code: 'ПРН1' }] });
    expect(out.value[1]).toMatchObject({ id: 'clo2', text: 'Design controls', plo: [] });
  });

  test('політика: переформульовування за вказівкою (feedback)', async () => {
    createResponse.mockResolvedValue(reply('Attendance is mandatory.'));
    const out = await reword({ suggestion: suggestion('Attendance is required.', 'policies{policy.attendance}'), feedback: 'say mandatory', state: rmState, refs });
    expect(out.value).toBe('Attendance is mandatory.');
    expect(createResponse.mock.calls[0][0].input[0].content).toMatch(/Do not add rules/);
  });

  test('не текстові чернетки (ПРН, рідінги) і порожній відгук відхиляються', async () => {
    const plo = suggestion([{ code: 'ПРН1', coverage: 'full', confirmed: false }], 'outcomes[clo1].plo');
    await expect(reword({ suggestion: plo, feedback: 'x', state: rmState, refs })).rejects.toMatchObject({ statusCode: 422, code: 'NOT_REWORDABLE' });
    await expect(reword({ suggestion: suggestion('t'), feedback: ' ', state: rmState, refs })).rejects.toMatchObject({ statusCode: 400 });
    expect(createResponse).not.toHaveBeenCalled();
  });
});

// Живий прогін 07.11: українські чернетки MMM відхилялися англомовною валідацією («you», англійські дієслова) → 503
test('validateDraft: українські вимоги для силабуса uk', () => {
  const { validateDraft } = require('../../../services/ai/prompts/formulator');
  expect(validateDraft('course.outcomes', { text: 'Аналізувати бренд\nРозробити план аудиту' }, 'uk')).toEqual([]);
  expect(validateDraft('course.outcomes', { text: 'Розуміти бренд' }, 'uk')[0]).toMatch(/action verb/);
  expect(validateDraft('course.description', { text: 'Курс про бренди. Ви навчитеся будувати бренд. Ми працюємо з кейсами.' }, 'uk')).toEqual([]);
  expect(validateDraft('course.description', { text: 'Курс про бренди. Студенти вчаться. Ми працюємо з кейсами.' }, 'uk')[0]).toMatch(/«?ви/);
});
