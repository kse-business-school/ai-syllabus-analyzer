// extractSlots: LLM замокано; перевіряються strict-схема, валідація blockIds/ПРН/ваг, повтор і пост-обробка.
jest.mock('../../services/ai/client', () => ({ createResponse: jest.fn(), llmModel: 'gpt-test' }));
const { createResponse } = require('../../services/ai/client');
const client = require('../../services/ai/client');
const { extractSlots, buildSchema, sanitize } = require('../../services/ai/parse/extractSlots');
const { loadBlocks, refs, slots, reply } = require('./fixtures');

let blocks;
beforeAll(async () => { blocks = await loadBlocks(); });
beforeEach(() => { createResponse.mockReset(); client.provider = 'openai'; });

// Усі об'єкти strict-схеми мають required = усі властивості й additionalProperties:false
function assertStrict(schema, at = '$') {
  if (schema.type === 'object' || schema.properties) {
    expect([at, schema.additionalProperties]).toEqual([at, false]);
    expect([at, [...schema.required].sort()]).toEqual([at, Object.keys(schema.properties).sort()]);
    for (const [k, v] of Object.entries(schema.properties)) assertStrict(v, `${at}.${k}`);
  }
  if (schema.items) assertStrict(schema.items, `${at}[]`);
}

test('схема strict, ploCodes — enum кодів своєї програми', () => {
  const r27 = refs('MBA27');
  const schema = buildSchema(r27.outcomes.map((o) => o.code));
  assertStrict(schema);
  expect(schema.properties.outcomes.items.properties.ploCodes.items.enum).toHaveLength(20);
  expect(schema.properties.header.properties.deliveryFormat.enum).toEqual(['offline', 'online', 'hybrid', null]);
});

test('успішний витяг: запит strict json_schema, блоки з id і позицією в таблиці', async () => {
  createResponse.mockResolvedValue(reply(slots()));
  const { slots: out, warnings } = await extractSlots({ blocks, meta: { title: 'Negotiation' }, refs: refs() });
  expect(warnings).toEqual([]);
  expect(out.assessments).toHaveLength(3);
  expect(out.sessions[0].hours).toBe(4);

  const [[req]] = createResponse.mock.calls;
  expect(req.text.format).toMatchObject({ type: 'json_schema', strict: true, name: 'parse_extract_slots' });
  expect(req.input[0].content).toMatch(/VERBATIM/);
  expect(req.input[0].content).toMatch(/ПРН1:/); // перелік ПРН програми
  expect(req.input[1].content).toContain('[b0003] Course Title: Negotiation and Influence');
  expect(req.input[1].content).toContain('[b0044] (T1 R1 C1) 20');
  // m13: текст документа — недовірені дані в маркерах
  expect(req.input[1].content.startsWith('<untrusted_document_text>')).toBe(true);
  expect(req.input[1].content.endsWith('</untrusted_document_text>')).toBe(true);
});

test('Anthropic extraction stays within union limits and preserves assessment to CLO links', async () => {
  client.provider = 'anthropic';
  const unionCount = (schema) => {
    if (!schema || typeof schema !== 'object') return 0;
    return (Array.isArray(schema.type) || schema.anyOf ? 1 : 0)
      + Object.values(schema).reduce((total, value) => total + (Array.isArray(value)
        ? value.reduce((n, item) => n + unionCount(item), 0) : unionCount(value)), 0);
  };
  const good = slots();
  let retry = false;
  createResponse.mockImplementation(async (request) => {
    const schema = request.text.format.schema;
    assertStrict(schema);
    expect(unionCount(schema)).toBeLessThanOrEqual(16);
    const partial = Object.fromEntries(Object.keys(schema.properties).map(key => [key, structuredClone(good[key])]));
    if (partial.assessments) {
      expect(request.input[0].content).toContain(JSON.stringify(good.outcomes));
      if (!retry) { partial.assessments[0].outcomeIds = ['unknown-clo']; retry = true; }
    }
    return reply(partial);
  });
  const stats = { llmCalls: 0 };
  const { slots: extracted, warnings } = await extractSlots({ blocks, refs: refs() }, { stats });
  expect(extracted).toEqual(good);
  expect(warnings).toEqual([]);
  expect(createResponse).toHaveBeenCalledTimes(4);
  expect(stats.llmCalls).toBe(4);
  const names = createResponse.mock.calls.map(([request]) => request.text.format.name);
  expect(names).toEqual(['parse_extract_slots_1', 'parse_extract_slots_2', 'parse_extract_slots_3', 'parse_extract_slots_3']);
  expect(createResponse.mock.calls[3][0].input[1].content).toContain('unknown outcome link unknown-clo');
});

test('неіснуючі blockIds → коригувальний повтор з текстом помилки, далі успіх', async () => {
  const bad = slots();
  bad.objectives[0].blockIds = ['b9999'];
  createResponse.mockResolvedValueOnce(reply(bad)).mockResolvedValueOnce(reply(slots()));
  const { slots: out } = await extractSlots({ blocks, refs: refs() });
  expect(out.objectives[0].blockIds).toEqual(['b0006']);
  expect(createResponse).toHaveBeenCalledTimes(2);
  expect(createResponse.mock.calls[1][0].input[1].content).toMatch(/objectives\[0\]: unknown blockIds \["b9999"\]/);
});

test('елемент без blockIds, дубль id, зв’язок на неіснуючий CLO, вага не відсоток → помилка валідації', async () => {
  const bad = slots();
  bad.outcomes[0].blockIds = [];
  bad.outcomes[1].id = 'clo1';
  bad.assessments[0].outcomeIds = ['clo7'];
  bad.assessments[1].weight = 130;
  createResponse.mockResolvedValue(reply(bad));
  await expect(extractSlots({ blocks, refs: refs() })).rejects.toThrow(/outcomes\[0\]: blockIds are required.*duplicate id clo1.*unknown outcome link clo7.*weight must be a percentage/);
  expect(createResponse).toHaveBeenCalledTimes(2); // перша спроба + один семантичний повтор
});

test('код ПРН поза програмою відхиляється схемою (enum), коректний проходить нормалізованим', async () => {
  const r27 = refs('MBA27');
  const good = slots();
  good.outcomes[0].ploCodes = [r27.outcomes[2].code];
  createResponse.mockResolvedValue(reply(good));
  const { slots: out } = await extractSlots({ blocks, refs: r27 });
  expect(out.outcomes[0].ploCodes).toEqual([r27.outcomes[2].code]);

  const bad = slots();
  bad.outcomes[0].ploCodes = ['ПРН99'];
  createResponse.mockReset();
  createResponse.mockResolvedValue(reply(bad));
  await expect(extractSlots({ blocks, refs: r27 })).rejects.toThrow(/invalid enum value/);
});

test('sanitize: коди ПРН нормалізуються (латинські P/H, пробіли), дублікати зливаються', () => {
  const x = slots();
  x.outcomes[0].ploCodes = ['PRN 3', 'ПРН3', 'ПPН4'];
  const { slots: out } = sanitize(x, blocks);
  expect(out.outcomes[0].ploCodes).toEqual(['ПРН3', 'ПРН4']);
});

test('sanitize: числа, яких немає в документі, обнуляються з попередженням; явні лишаються', () => {
  const x = slots();
  x.header.ects = 6;       // у файлі немає
  x.sessions[0].hours = 4; // «4 ac. hours» є
  x.assessments[2].weight = 55;
  const { slots: out, warnings } = sanitize(x, blocks);
  expect(out.header.ects).toBeNull();
  expect(out.assessments[2].weight).toBeNull();
  expect(out.sessions[0].hours).toBe(4);
  expect(warnings).toEqual(expect.arrayContaining([
    expect.stringContaining('header.ects: the number 6 is not written in the cited blocks'),
    expect.stringContaining('assessments[2].weight: the number 55 is not written in the cited blocks'),
  ]));
});

test('sanitize: текст, якого немає в цитованих блоках, дає попередження про дослівність', () => {
  const x = slots();
  x.shortDescription.text = 'A paraphrased description that is not in the document at all.';
  const { warnings, slots: out } = sanitize(x, blocks);
  expect(warnings).toEqual([expect.stringContaining('shortDescription: the text is not a verbatim fragment')]);
  expect(out.shortDescription.text).toBe(x.shortDescription.text); // текст не змінюється
});

test('дуже довгий документ відсікається з попередженням', async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, kind: 'paragraph', text: 'word '.repeat(2000) }));
  createResponse.mockResolvedValue(reply(slots({ header: { ...slots().header, blockIds: ['x0'] }, prerequisites: { text: null, blockIds: [] } })));
  const empty = slots({
    header: { ...slots().header, blockIds: ['x0'] }, shortDescription: { text: null, blockIds: [] }, prerequisites: { text: null, blockIds: [] }, capstone: { text: null, blockIds: [] },
    objectives: [], outcomes: [], instructors: [], sessions: [], individualWork: [], assessments: [], materials: { required: [], recommended: [] }, policySegments: [],
  });
  createResponse.mockReset();
  createResponse.mockResolvedValue(reply(empty));
  const { warnings } = await extractSlots({ blocks: many, refs: refs() });
  expect(warnings).toEqual([expect.stringMatching(/very long: the last \d+ blocks were not analysed/)]);
});

test('вигаданий текст політики не проходить семантичну валідацію', async () => {
  const x = slots();
  x.policySegments[0].text = 'Invented policy with a new attendance threshold.';
  createResponse.mockResolvedValue(reply(x));
  await expect(extractSlots({ blocks, refs: refs() })).rejects.toThrow(/text must be verbatim/);
  expect(createResponse).toHaveBeenCalledTimes(2);
});
