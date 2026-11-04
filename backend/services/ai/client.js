// Єдина обгортка над LLM-провайдером. Провайдер обирає LLM_PROVIDER (openai | anthropic);
// без нього: anthropic, якщо є лише ANTHROPIC_API_KEY, інакше openai.
// Решта коду бачить один контракт — createResponse(params) у стилі Responses API (див. anthropicAdapter.js).
const { createAnthropicResponse } = require('./anthropicAdapter');

const aiRequestTimeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS || 130000);
const reasoningEffort = (process.env.LLM_REASONING_EFFORT || 'medium').trim();
const maxOutputTokens = Number(process.env.LLM_MAX_OUTPUT_TOKENS || 0);

function resolveProvider(env = process.env) {
  const explicit = String(env.LLM_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'openai' || explicit === 'anthropic') return explicit;
  const hasAnthropic = Boolean(String(env.ANTHROPIC_API_KEY || '').trim());
  const hasOpenAi = Boolean(String(env.OPENAI_API_KEY || '').trim());
  return hasAnthropic && !hasOpenAi ? 'anthropic' : 'openai';
}

const provider = resolveProvider();
const DEFAULT_MODELS = { openai: 'gpt-5.4-mini', anthropic: 'claude-opus-5-5' };
const envModel = (process.env.LLM_MODEL || '').trim();
const modelPrefix = provider === 'anthropic' ? 'claude-' : 'gpt-';
const llmModel = envModel && envModel.startsWith(modelPrefix) ? envModel : DEFAULT_MODELS[provider];
/** Змінна середовища з ключем активного провайдера (для fail-fast у server.js). */
const apiKeyName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';

// Клієнти створюються ліниво: модуль можна підключати без ключа (тести, міграції).
let openaiClient;
let anthropicClient;
function getOpenAI() {
  if (!openaiClient) {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}
function getAnthropic() {
  if (!anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    // maxRetries: повтори 408/429/5xx робить сам SDK; зверху їх додатково робить requestJSON
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

function supportsReasoning(model) {
  const value = String(model || '');
  return value.startsWith('gpt-5') || /^o\d/.test(value);
}

async function createResponse(params) {
  if (provider === 'anthropic') {
    const request = { ...params };
    if (!request.max_output_tokens && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
      request.max_output_tokens = maxOutputTokens;
    }
    if (!request.reasoning) request.reasoning = { effort: reasoningEffort };
    return createAnthropicResponse(request, {
      client: getAnthropic(),
      model: llmModel,
      timeoutMs: aiRequestTimeoutMs,
      // Серверний fallback за відмови класифікаторів безпеки; вимкнути: ANTHROPIC_REFUSAL_FALLBACK=0
      refusalFallback: process.env.ANTHROPIC_REFUSAL_FALLBACK !== '0',
    });
  }
  const request = { ...params };
  if (!request.reasoning && supportsReasoning(request.model || llmModel)) {
    request.reasoning = { effort: reasoningEffort };
  }
  if (!request.max_output_tokens && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
    request.max_output_tokens = maxOutputTokens;
  }
  return getOpenAI().responses.create(request, { timeout: aiRequestTimeoutMs });
}

function safeParseJSON(text) {
  if (!text || typeof text !== 'string') return null;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function clipText(value, maxChars) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  const clipped = text.slice(0, maxChars);
  const sentenceEnd = Math.max(
    clipped.lastIndexOf('. '),
    clipped.lastIndexOf('! '),
    clipped.lastIndexOf('? '),
    clipped.lastIndexOf('\n')
  );
  if (sentenceEnd > Math.floor(maxChars * 0.55)) {
    return clipped.slice(0, sentenceEnd + 1).trim();
  }
  return clipped.trim();
}

module.exports = {
  get openai() { return getOpenAI(); },
  createResponse,
  safeParseJSON,
  clipText,
  supportsReasoning,
  resolveProvider,
  provider,
  apiKeyName,
  llmModel,
  reasoningEffort,
  maxOutputTokens,
  aiRequestTimeoutMs,
};
