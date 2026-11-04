jest.mock('../../../services/ai/client', () => ({ createResponse: jest.fn(), llmModel: 'gpt-test' }));
const { createResponse } = require('../../../services/ai/client');
const { respond, assertStrictSchema } = require('../helpers');
const { riskManagementState } = require('../../fixtures/state/riskManagement');
const { buildDraftSuggestion } = require('../../../services/chat/draftSuggestions');
const { loadFixtureRefs, readFixture } = require('../../../services/references/fixtureRefs');
const { suggestAiTools, normalizeCatalog, MAX_PICKS } = require('../../../services/ai/prompts/aiTools');
const { buildTools, TOOL_NAMES } = require('../../../services/ai/tools/definitions');

const refs = loadFixtureRefs('MBA28');
const state = riskManagementState();
const catalog = [
  { id: 'ait-1', title: 'AI risk-register critique', school: 'Example School A', disciplines: ['risk'], structure: 'critique', effort: 'low', description: 'Students critique an AI-generated risk register.' },
  { id: 'ait-2', title: 'Scenario debate with an AI opponent', school: 'Example School B', disciplines: ['strategy'], structure: 'debate', effort: 'medium', description: 'Students debate an AI persona.' },
  { id: 'ait-3', title: 'AI coach for case preparation', school: 'Example School C', disciplines: ['strategy'], structure: 'coaching', effort: 'high', description: 'An AI tutor prepares students for a case.' },
  { id: 'ait-4', title: 'AI memo review', school: 'Example School D', disciplines: ['finance'], structure: 'critique', effort: 'low', description: 'Students improve an AI-reviewed memo.' },
];
const pick = (itemId, extra = {}) => ({ itemId, fit: 'It trains judgement on how risks are identified in this course.', adaptation: 'Run it as a short in-class exercise on the risk topic.', ...extra });

beforeEach(() => createResponse.mockReset());

test('фікстура каталогу «AI in Your Course»: 57 повних записів з унікальними id', () => {
  const { items, areas } = readFixture('ai-tools.json');
  expect(items).toHaveLength(57);
  expect(areas).toHaveLength(13);
  const normalized = normalizeCatalog(items);
  expect(normalized).toHaveLength(57);
  expect(new Set(normalized.map((i) => i.id)).size).toBe(57);
});

test('порожній або неповний каталог → [] без виклику LLM', async () => {
  expect(await suggestAiTools({ state, refs, catalog: [] })).toEqual([]);
  expect(await suggestAiTools({ state, refs, catalog: [{ id: '', title: 'x', school: 'y' }, { id: 'a', title: '', school: 'y' }, { id: 'b', title: 't', school: '' }] })).toEqual([]);
  expect(createResponse).not.toHaveBeenCalled();
});

test('normalizeCatalog: відкидає неповні записи й дублікати id, нормалізує effort', () => {
  const out = normalizeCatalog([...catalog, { ...catalog[0], title: 'dup' }, { id: 'ait-9', title: 'T', school: 'S', effort: 'huge' }, null]);
  expect(out.map((i) => i.id)).toEqual(['ait-1', 'ait-2', 'ait-3', 'ait-4', 'ait-9']);
  expect(out.find((i) => i.id === 'ait-9')).toMatchObject({ effort: null, disciplines: [], structure: null });
});

test('вибір лише з каталогу: strict-схема з enum id; картка — kind question, назви й школи з каталогу', async () => {
  createResponse.mockResolvedValue(respond({ picks: [pick('ait-2'), pick('ait-1')] }));
  const result = await suggestAiTools({ state, refs, catalog });
  expect(createResponse).toHaveBeenCalledTimes(1);
  const req = createResponse.mock.calls[0][0];
  expect(req.text.format).toMatchObject({ type: 'json_schema', name: 'ai_tools_picks', strict: true });
  assertStrictSchema(req.text.format.schema);
  expect(req.text.format.schema.properties.picks.items.properties.itemId.enum).toEqual(['ait-1', 'ait-2', 'ait-3', 'ait-4']);
  expect(req.tools).toBeUndefined();
  expect(req.input[1].content).toContain('[ait-3] AI coach for case preparation (Example School C)');

  expect(result).toHaveLength(1);
  const [input] = result;
  expect(input).toMatchObject({ kind: 'question', severity: 'info', target: { path: 'sessions[].additional' } });
  expect(input.description).toContain('- Scenario debate with an AI opponent (Example School B, medium effort).');
  expect(input.description).toContain('- AI risk-register critique (Example School A, low effort).');
  expect(input.description).not.toContain('Example School C');
  expect(input.question).toMatch(/which one/);
  expect(input.rationale).toContain('ait-2, ait-1');
  // Придатне для createDraftSuggestions: питання без чернетки, не пропозиція зі значенням слота
  const doc = buildDraftSuggestion({ ...input, origin: 'orchestrator' }, { syllabusId: '65f000000000000000000001', state, refs });
  expect(doc).toMatchObject({ origin: 'orchestrator', kind: 'question', section: 'schedule', applicable: true });
  expect(doc.draft).toBeUndefined();
});

test('невідомий id, дублікат, понад ліміт і вигадані числа/назви → одна корекція, потім помилка', async () => {
  // enum-порушення ловить схема: повтор із точною помилкою
  createResponse
    .mockResolvedValueOnce(respond({ picks: [pick('ait-404')] }))
    .mockResolvedValueOnce(respond({ picks: [pick('ait-3')] }));
  const out = await suggestAiTools({ state, refs, catalog });
  expect(createResponse).toHaveBeenCalledTimes(2);
  expect(createResponse.mock.calls[1][0].input[1].content).toContain('Previous response validation errors');
  expect(out[0].description).toContain('AI coach for case preparation (Example School C, high effort)');

  createResponse.mockReset();
  createResponse
    .mockResolvedValueOnce(respond({ picks: [pick('ait-1', { adaptation: 'Run it for 45 minutes with the "Harvard Risk Model".' })] }))
    .mockResolvedValueOnce(respond({ picks: [pick('ait-1'), pick('ait-1')] }));
  await expect(suggestAiTools({ state, refs, catalog })).rejects.toThrow(/each catalog entry may be picked once/);
  expect(createResponse.mock.calls[1][0].input[1].content).toMatch(/numbers, dates and names must not be invented/);

  createResponse.mockReset();
  createResponse.mockResolvedValue(respond({ picks: catalog.map((c) => pick(c.id)).slice(0, MAX_PICKS + 1) }));
  await expect(suggestAiTools({ state, refs, catalog })).rejects.toThrow(/pick between 1 and 3/);
});

test('suggest_ai_tools зареєстровано як strict function tool без аргументів', () => {
  expect(TOOL_NAMES).toContain('suggest_ai_tools');
  const tool = buildTools(state).find((t) => t.name === 'suggest_ai_tools');
  expect(tool).toMatchObject({ type: 'function', strict: true, parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } });
});
