// Адаптер Anthropic: переклад запиту/відповіді Responses ↔ Messages API на фейковому клієнті, без мережі.
const {
  createAnthropicResponse, toAnthropicRequest, fromAnthropicMessage, sanitizeSchema,
} = require('../../services/ai/anthropicAdapter');
const { buildTools } = require('../../services/ai/tools/definitions');
const { riskManagementState } = require('../fixtures/state/riskManagement');
const { validateSchema } = require('../../utils/jsonSchema');

const cfg = (client, extra = {}) => ({ client, model: 'claude-opus-5-5', timeoutMs: 1000, refusalFallback: false, ...extra });
const fakeClient = (...messages) => {
  const create = jest.fn();
  messages.forEach((m) => create.mockResolvedValueOnce(m));
  return { messages: { create }, beta: { messages: { create: jest.fn(async () => messages[0]) } }, create };
};
const msg = (content, stop_reason = 'end_turn') => ({ id: 'm1', model: 'claude-opus-5-5', content, stop_reason, usage: {} });

describe('toAnthropicRequest', () => {
  test('system-повідомлення зливаються в system, історія і поточна репліка — у messages', () => {
    const req = toAnthropicRequest({
      model: 'gpt-5.4-mini',
      input: [
        { role: 'system', content: 'A' }, { role: 'system', content: 'B' },
        { role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'go' },
      ],
    }, cfg());
    expect(req.model).toBe('claude-opus-5-5'); // чужу (gpt-*) модель замінено
    expect(req.system).toBe('A\n\nB');
    expect(req.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(req.max_tokens).toBe(16000);
    expect(req.temperature).toBeUndefined();
    expect(req.thinking).toBeUndefined();
  });

  test('json_schema → output_config.format без непідтримуваних ключових слів; effort → output_config.effort', () => {
    const schema = {
      type: 'object', additionalProperties: false, required: ['n', 'items'],
      properties: {
        n: { type: 'integer', minimum: 0, maximum: 10 },
        items: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 9, pattern: '^a' } },
      },
    };
    const req = toAnthropicRequest({
      input: [{ role: 'user', content: 'x' }], reasoning: { effort: 'high' }, max_output_tokens: 777,
      text: { format: { type: 'json_schema', name: 's', strict: true, schema } },
    }, cfg());
    expect(req.output_config.effort).toBe('high');
    expect(req.max_tokens).toBe(777);
    expect(req.output_config.format).toEqual({
      type: 'json_schema',
      schema: {
        type: 'object', additionalProperties: false, required: ['n', 'items'],
        properties: { n: { type: 'integer' }, items: { type: 'array', items: { type: 'string' } } },
      },
    });
    expect(schema.properties.n.minimum).toBe(0); // оригінал не змінено
  });

  test('sanitizeSchema не чіпає назви властивостей, що збігаються з ключовими словами', () => {
    const out = sanitizeSchema({ type: 'object', properties: { pattern: { type: 'string', pattern: 'x' }, minimum: { type: 'number', minimum: 1 } } });
    expect(Object.keys(out.properties)).toEqual(['pattern', 'minimum']);
    expect(out.properties.pattern).toEqual({ type: 'string' });
  });

  test('nullable enums use typed anyOf variants without changing accepted values', () => {
    const schema = { type: ['string', 'null'], enum: ['offline', 'online', 'hybrid', null] };
    const converted = sanitizeSchema(schema);
    expect(converted).toEqual({ anyOf: [
      { type: 'string', enum: ['offline', 'online', 'hybrid'] },
      { type: 'null', enum: [null] },
    ] });
    for (const value of ['offline', 'online', 'hybrid', null, 'other', 0, false]) {
      expect(validateSchema(converted, value).length === 0).toBe(validateSchema(schema, value).length === 0);
    }
    expect(schema.type).toEqual(['string', 'null']);
    expect(sanitizeSchema({ type: ['string', 'null'], enum: ['x'] })).toEqual({
      anyOf: [{ type: 'string', enum: ['x'] }],
    });
  });

  test('Haiku 4.5 не отримує effort', () => {
    const req = toAnthropicRequest({ model: 'claude-haiku-4-5', input: [{ role: 'user', content: 'x' }], reasoning: { effort: 'medium' } }, cfg());
    expect(req.output_config).toBeUndefined();
  });

  test('strict function tools → input_schema + strict; tool_choice none; parallel_tool_calls:false', () => {
    const tools = buildTools(riskManagementState());
    const req = toAnthropicRequest({ input: [{ role: 'user', content: 'x' }], tools, parallel_tool_calls: false }, cfg());
    expect(req.tools).toHaveLength(tools.length);
    expect(req.tools[0]).toMatchObject({ name: tools[0].name, strict: true, input_schema: { type: 'object', additionalProperties: false } });
    expect(req.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    const last = toAnthropicRequest({ input: [{ role: 'user', content: 'x' }], tools, parallel_tool_calls: false, tool_choice: 'none' }, cfg());
    expect(last.tool_choice).toEqual({ type: 'none' });
    expect(JSON.stringify(req.tools)).not.toMatch(/"minimum"|"maxLength"/);
  });

  test('web_search_preview → web_search_20260209 для нових моделей, _20250305 для старих', () => {
    const input = [{ role: 'user', content: 'x' }];
    const tools = [{ type: 'web_search_preview' }];
    expect(toAnthropicRequest({ input, tools }, cfg()).tools[0]).toMatchObject({ type: 'web_search_20260209', name: 'web_search' });
    expect(toAnthropicRequest({ model: 'claude-haiku-4-5', input, tools }, cfg()).tools[0].type).toBe('web_search_20250305');
  });

  test('цикл tool use: function_call і function_call_output → tool_use/tool_result, thinking повертається без змін', () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig' };
    const req = toAnthropicRequest({
      input: [
        { role: 'user', content: 'set title' },
        { type: 'reasoning', _anthropic: thinking },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
        { type: 'function_call', call_id: 'tu1', name: 'get_slot', arguments: '{"key":"a"}' },
        { type: 'function_call_output', call_id: 'tu1', output: '{"v":1}' },
      ],
    }, cfg());
    expect(req.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'set title' }] },
      { role: 'assistant', content: [thinking, { type: 'text', text: 'ok' }, { type: 'tool_use', id: 'tu1', name: 'get_slot', input: { key: 'a' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '{"v":1}' }] },
    ]);
  });
});

describe('fromAnthropicMessage', () => {
  test('text + tool_use + thinking → output у формі Responses', () => {
    const res = fromAnthropicMessage(msg([
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', id: 'tu1', name: 'run_checks', input: {} },
    ], 'tool_use'));
    expect(res.output_text).toBe('Hello');
    expect(res.status).toBe('completed');
    expect(res.output.map((o) => o.type)).toEqual(['reasoning', 'message', 'function_call']);
    expect(res.output[2]).toEqual({ type: 'function_call', call_id: 'tu1', name: 'run_checks', arguments: '{}' });
  });

  test('max_tokens → status incomplete; refusal → порожній output_text', () => {
    expect(fromAnthropicMessage(msg([{ type: 'text', text: '{' }], 'max_tokens')).status).toBe('incomplete');
    const refused = fromAnthropicMessage({ ...msg([], 'refusal'), stop_details: { type: 'refusal', category: 'cyber' } });
    expect(refused.output_text).toBe('');
    expect(refused.stop_reason).toBe('refusal');
  });

  test('цитати web_search → annotations url_citation (їх читає caseSources.citationsOf)', () => {
    const res = fromAnthropicMessage(msg([
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
      { type: 'text', text: 'Case A', citations: [{ type: 'web_search_result_location', url: 'https://x.test/a', title: 'A', cited_text: '…' }] },
    ]));
    const annotations = res.output.filter((o) => o.type === 'message').flatMap((o) => o.content).flatMap((p) => p.annotations);
    expect(annotations).toEqual([{ type: 'url_citation', url: 'https://x.test/a', title: 'A' }]);
    expect(res.output.filter((o) => o.type === 'server_tool')).toHaveLength(2);
  });
});

describe('createAnthropicResponse', () => {
  const input = [{ role: 'user', content: 'x' }];

  test('передає timeout і звичайний messages.create без fallback', async () => {
    const client = fakeClient(msg([{ type: 'text', text: '{"a":1}' }]));
    const res = await createAnthropicResponse({ input }, cfg(client));
    expect(res.output_text).toBe('{"a":1}');
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-opus-5-5' }), { timeout: 1000 });
    expect(client.beta.messages.create).not.toHaveBeenCalled();
  });

  test('refusalFallback: beta-ендпоінт із betas і fallbacks:"default" (лише для підтримуваних моделей)', async () => {
    const client = fakeClient(msg([{ type: 'text', text: 'ok' }]));
    await createAnthropicResponse({ input }, cfg(client, { refusalFallback: true }));
    expect(client.beta.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }), { timeout: 1000 });
    const haiku = fakeClient(msg([{ type: 'text', text: 'ok' }]));
    await createAnthropicResponse({ model: 'claude-haiku-4-5', input }, cfg(haiku, { refusalFallback: true }));
    expect(haiku.create).toHaveBeenCalled();
    expect(haiku.beta.messages.create).not.toHaveBeenCalled();
  });

  test('pause_turn продовжується: блоки першої ітерації йдуть асистентом у другий запит, відповідь одна', async () => {
    const search = { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } };
    const client = fakeClient(msg([search], 'pause_turn'), msg([{ type: 'text', text: 'done' }]));
    const res = await createAnthropicResponse({ input, tools: [{ type: 'web_search_preview' }] }, cfg(client));
    expect(client.create).toHaveBeenCalledTimes(2);
    expect(client.create.mock.calls[1][0].messages[1]).toEqual({ role: 'assistant', content: [search] });
    expect(res.output_text).toBe('done');
    expect(res.output.map((o) => o.type)).toEqual(['server_tool', 'message']);
  });

  test('помилки SDK (status) проходять без змін — requestJSON бачить їх як і раніше', async () => {
    const client = { messages: { create: jest.fn().mockRejectedValue(Object.assign(new Error('overloaded'), { status: 529 })) } };
    await expect(createAnthropicResponse({ input }, cfg(client))).rejects.toMatchObject({ status: 529 });
  });
});

describe('client.js: вибір провайдера', () => {
  const { resolveProvider } = require('../../services/ai/client');
  test('LLM_PROVIDER має пріоритет; без нього — за наявними ключами', () => {
    expect(resolveProvider({ LLM_PROVIDER: 'anthropic', OPENAI_API_KEY: 'k' })).toBe('anthropic');
    expect(resolveProvider({ LLM_PROVIDER: 'openai' })).toBe('openai');
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'k' })).toBe('anthropic');
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k' })).toBe('openai');
    expect(resolveProvider({})).toBe('openai');
  });
});
