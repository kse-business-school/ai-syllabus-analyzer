// Адаптер Anthropic Messages API під «Responses-подібний» контракт services/ai/client.createResponse.
// Виклики (parse, checks, tools/runner, review) лишаються без змін: вони шлють { model, input, tools, text.format, … }
// і читають { output_text, output[], status }. Тут запит перекладається в Messages API, а відповідь — назад.
//
// Відповідність:
//   input role=system            → system
//   function_call(_output)       → tool_use / tool_result
//   text.format json_schema      → output_config.format (strict structured outputs)
//   tools[type=function,strict]  → tools[{ name, input_schema, strict }]
//   tools[web_search_preview]    → серверний web_search (джерела → annotations url_citation)
//   reasoning.effort             → output_config.effort (thinking лишаємо моделі: adaptive / завжди увімкнений)
//   status 'incomplete'          ← stop_reason max_tokens
// Блоки thinking і серверні tool-блоки повертаються в output як службові елементи й відновлюються при наступному
// запиті — без цього цикл tool use ламається (thinking треба передавати назад без змін).

const WEB_SEARCH_MAX_USES = 5;
const MAX_PAUSE_TURNS = 5;
const DEFAULT_MAX_TOKENS = 16000;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Моделі, для яких доступні динамічні фільтри web_search / web_fetch (_20260209). */
function supportsNewWebSearch(model) {
  return /^claude-(opus-(5|4-[678])|sonnet-(5|4-6)|fable-|mythos-|haiku-5)/.test(String(model || ''));
}

/** effort підтримують усі поточні моделі, крім Haiku 4.5 і Sonnet 4.5 (там помилка 400). */
function supportsEffort(model) {
  return !/^claude-(haiku-4|sonnet-4-5|opus-4-5|sonnet-3|haiku-3)/.test(String(model || ''));
}

/** server-side fallbacks за відмови класифікаторів безпеки (лише Claude API, лише ці моделі). */
function supportsFallback(model) {
  return /^claude-(fable-|mythos-|opus-5|sonnet-5-5)/.test(String(model || ''));
}

/**
 * Схема для structured outputs / strict tools: прибирає ключові слова, яких Anthropic не приймає.
 * Валідація значень лишається за utils/jsonSchema (на оригінальній схемі), тож нічого не втрачається.
 */
function sanitizeSchema(schema) {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
      'minLength', 'maxLength', 'maxItems', 'pattern'].includes(key)) continue;
    if (key === 'minItems') { if (value === 0 || value === 1) out[key] = value; continue; }
    // properties — словник імен: ключі зберігаємо, схеми значень чистимо
    if (key === 'properties' && value && typeof value === 'object') {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, sanitizeSchema(sub)]));
    } else out[key] = sanitizeSchema(value);
  }
  return out;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

/** Responses-input → { system, messages } у форматі Messages API. */
function toMessages(input) {
  const system = [];
  const messages = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: [...blocks] });
  };
  for (const item of input || []) {
    if (!item) continue;
    if (item.type === 'function_call') {
      push('assistant', [{ type: 'tool_use', id: item.call_id, name: item.name, input: parseArgs(item.arguments) }]);
    } else if (item.type === 'function_call_output') {
      push('user', [{ type: 'tool_result', tool_use_id: item.call_id, content: String(item.output ?? '') }]);
    } else if (item.type === 'reasoning' || item.type === 'server_tool') {
      if (item._anthropic) push('assistant', [item._anthropic]);
    } else if (item.type === 'message') {
      const text = textOf(item.content);
      if (text) push('assistant', [{ type: 'text', text }]);
    } else if (item.role === 'system' || item.role === 'developer') {
      const text = textOf(item.content);
      if (text) system.push(text);
    } else if (item.role === 'assistant') {
      const text = textOf(item.content);
      if (text) push('assistant', [{ type: 'text', text }]);
    } else if (item.role === 'user') {
      const text = textOf(item.content);
      if (text) push('user', [{ type: 'text', text }]);
    }
  }
  return { system: system.join('\n\n'), messages };
}

function toTools(tools, model) {
  if (!tools?.length) return undefined;
  return tools.map((tool) => {
    if (tool.type === 'web_search_preview' || tool.type === 'web_search') {
      return {
        type: supportsNewWebSearch(model) ? 'web_search_20260209' : 'web_search_20250305',
        name: 'web_search',
        max_uses: WEB_SEARCH_MAX_USES,
      };
    }
    return {
      name: tool.name,
      description: tool.description,
      input_schema: sanitizeSchema(tool.parameters || { type: 'object', properties: {} }),
      ...(tool.strict ? { strict: true } : {}),
    };
  });
}

/**
 * @param {object} params параметри в стилі Responses API (model, input, tools, text.format, reasoning, …)
 * @param {{ model: string, defaultMaxTokens?: number, refusalFallback?: boolean }} cfg
 * @returns {object} тіло запиту до Messages API (без betas)
 */
function toAnthropicRequest(params, cfg) {
  const model = String(params.model || '').startsWith('claude-') ? params.model : cfg.model;
  const { system, messages } = toMessages(params.input);
  const request = { model, max_tokens: params.max_output_tokens || cfg.defaultMaxTokens || DEFAULT_MAX_TOKENS, messages };
  if (system) request.system = system;

  const tools = toTools(params.tools, model);
  if (tools) request.tools = tools;
  if (tools && params.tool_choice === 'none') request.tool_choice = { type: 'none' };
  else if (tools && params.parallel_tool_calls === false) request.tool_choice = { type: 'auto', disable_parallel_tool_use: true };

  const outputConfig = {};
  const format = params.text?.format;
  if (format?.type === 'json_schema') outputConfig.format = { type: 'json_schema', schema: sanitizeSchema(format.schema) };
  const effort = params.reasoning?.effort === 'minimal' ? 'low' : params.reasoning?.effort;
  if (EFFORTS.has(effort) && supportsEffort(model)) outputConfig.effort = effort;
  if (Object.keys(outputConfig).length) request.output_config = outputConfig;
  return request;
}

/** Відповідь Messages API → { output, output_text, status, … } у формі Responses API. */
function fromAnthropicMessage(message) {
  const output = [];
  const texts = [];
  for (const block of message?.content || []) {
    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      output.push({ type: 'reasoning', _anthropic: block });
    } else if (block.type === 'text') {
      texts.push(block.text);
      const annotations = (block.citations || [])
        .filter((c) => c?.url)
        .map((c) => ({ type: 'url_citation', url: c.url, title: c.title || '' }));
      output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: block.text, annotations }] });
    } else if (block.type === 'tool_use') {
      output.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
    } else if (block.type === 'server_tool_use' || /_tool_result$/.test(block.type)) {
      output.push({ type: 'server_tool', _anthropic: block });
    }
  }
  return {
    id: message?.id,
    model: message?.model,
    status: message?.stop_reason === 'max_tokens' ? 'incomplete' : 'completed',
    stop_reason: message?.stop_reason,
    stop_details: message?.stop_details ?? null,
    output,
    output_text: texts.join(''),
    usage: message?.usage,
  };
}

/**
 * Один «Responses-подібний» виклик через Anthropic. pause_turn (довгий серверний пошук) продовжується тут же:
 * блоки попередніх ітерацій накопичуються й віддаються як одна відповідь.
 * @param {object} params
 * @param {{ client: object, model: string, timeoutMs?: number, defaultMaxTokens?: number, refusalFallback?: boolean }} cfg
 */
async function createAnthropicResponse(params, cfg) {
  const request = toAnthropicRequest(params, cfg);
  const useFallback = Boolean(cfg.refusalFallback) && supportsFallback(request.model);
  const send = (body) => (useFallback
    ? cfg.client.beta.messages.create({ ...body, betas: [FALLBACK_BETA], fallbacks: 'default' }, { timeout: cfg.timeoutMs })
    : cfg.client.messages.create(body, { timeout: cfg.timeoutMs }));

  const accumulated = [];
  let message;
  for (let turn = 0; turn <= MAX_PAUSE_TURNS; turn += 1) {
    const messages = accumulated.length
      ? [...request.messages, { role: 'assistant', content: [...accumulated] }]
      : request.messages;
    message = await send({ ...request, messages });
    accumulated.push(...(message.content || []));
    if (message.stop_reason !== 'pause_turn') break;
  }
  return fromAnthropicMessage({ ...message, content: accumulated });
}

module.exports = {
  createAnthropicResponse,
  toAnthropicRequest,
  fromAnthropicMessage,
  sanitizeSchema,
  supportsNewWebSearch,
  supportsEffort,
  supportsFallback,
};
