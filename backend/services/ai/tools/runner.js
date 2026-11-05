// Оркестратор чату з function calling (ТЗ §6 «Чат мусить змінювати документ»).
// Цикл: createResponse(tools, strict) → function_call → handler → function_call_output → … → фінальна відповідь.
// Ліміти: ≤ 6 викликів моделі за хід (останній без інструментів), ≤ 1 запису стану за хід (handlers.wrote).
const { createResponse, llmModel } = require('../client');
const { renderText, renderState } = require('../../syllabusState/render');
const { buildOrchestratorInstructions } = require('../prompts/orchestrator');
const { untrusted } = require('../prompts/preamble');
const { buildTools } = require('./definitions');
const { createToolContext, runTool, isInstructorMessage, norm } = require('./handlers');

const MAX_STEPS = 6;
const HISTORY_MESSAGES = 12;
const FALLBACK_REPLY = 'I could not finish that in one go. Could you say it again in a simpler way?';

/** Текст відповіді з обох форматів Responses API: output_text або message-елементи в output. */
function replyText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();
  return (response?.output || [])
    .filter((item) => item?.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
}

function parseArguments(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}

function historyInput(messages, userText) {
  const items = (messages || [])
    // Серверні «Confirmed: …», «Skip: …» — не слова викладача: в історію моделі не йдуть
    .filter((m) => (m.kind || 'text') === 'text' && m.content && (m.role === 'ai' || isInstructorMessage(m)))
    .slice(-HISTORY_MESSAGES)
    .map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }));
  // Поточну репліку вже могли зберегти в messages: не дублюємо
  const last = items[items.length - 1];
  if (last?.role === 'user' && norm(last.content) === norm(userText)) items.pop();
  return items;
}

/**
 * Відповідь на картку-питання (decisions.answerSuggestion): що саме питали і поточне значення цілі.
 * Модель має перетворити відповідь на чернетку для цієї цілі тими самими інструментами (правила — у handlers).
 */
function cardContextMessage({ cardContext: c }) {
  if (c.mode === 'reword') {
    return [
      'The instructor asks to change the draft on their card. Create a new draft for the same target with the same tool',
      '(propose_items with mode "replace" and the complete list as it should be after the change, using ids of existing items',
      'from the current syllabus; or propose_instructor). Change only what the feedback asks for.',
      `Target slot: ${c.slotKey || 'unknown'}; path: ${c.path}`,
      `Current draft on the card (data): ${untrusted(JSON.stringify(c.draft ?? null).slice(0, 6000))}`,
      `Current value in the syllabus (data): ${untrusted(JSON.stringify(c.current ?? null).slice(0, 4000))}`,
    ].join('\n');
  }
  return [
    'The instructor is answering a question card. Turn the answer into a draft for this target with the right tool',
    '(set_slot for a single value the instructor stated literally, propose_items for list items such as sessions, assessment components or readings,',
    'propose_instructor for the instructor profile, propose_draft for wording). If the answer is not enough, ask one short question.',
    `Question (data): ${untrusted(c.question || '')}`,
    `Target slot: ${c.slotKey || 'unknown'}; path: ${c.path}${c.entityId ? `; item id: ${c.entityId}` : ''}`,
    `Current value of the target (data): ${untrusted(JSON.stringify(c.current ?? null).slice(0, 4000))}`,
  ].join('\n');
}

/**
 * Один хід: вільне повідомлення викладача → tool calls → відповідь англійською.
 * @param {{ syllabus, state, revision: number, refs, conversation?, messages?: Message[], userText: string, userId, cardContext?,
 *   deps: { mutate(syllabusId, expectedRevision, fn, ctx), getState(syllabusId), createDraftSuggestions(inputs, ctx),
 *           runChecks(state, refs), findSuggestion(id), acceptSuggestion(id, { expectedRevision, userId }) } }} ctx
 *   deps, яких немає, беруться зі справжніх модулів (крім acceptSuggestion: без нього apply_edit повертає NOT_CONFIGURED).
 * @returns {Promise<{ reply: string, createdSuggestionIds: string[], stateChanged: boolean, currentSlotKey: string|null, revision: number }>}
 */
async function runOrchestratorTurn(ctx) {
  const tctx = createToolContext(ctx);
  const tools = buildTools(ctx.state);
  const input = [
    { role: 'system', content: buildOrchestratorInstructions({ refs: ctx.refs, state: ctx.state }) },
    { role: 'system', content: `Current conversation slot (data): ${untrusted(ctx.currentSlotKey ?? ctx.conversation?.currentSlotKey ?? 'none')}. Interpret the instructor's answer in this context.` },
    { role: 'system', content: `Current syllabus (data, as of the start of this turn):\n${untrusted(renderText(renderState(ctx.state, ctx.refs)).slice(0, 12000))}` },
    ...(ctx.cardContext ? [{ role: 'system', content: cardContextMessage(ctx) }] : []),
    ...historyInput(ctx.messages, ctx.userText),
    { role: 'user', content: String(ctx.userText || '') },
  ];

  let reply = '';
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const last = step === MAX_STEPS;
    const response = await createResponse({
      model: llmModel,
      input,
      tools,
      parallel_tool_calls: false,
      // На останньому кроці інструменти вимкнено: потрібна лише відповідь
      ...(last ? { tool_choice: 'none' } : {}),
    });
    const calls = (response?.output || []).filter((item) => item?.type === 'function_call');
    if (!calls.length || last) {
      reply = calls.length ? '' : replyText(response);
      break;
    }
    // Повертаємо моделі її ж вихід (разом із reasoning-елементами), далі результати викликів
    input.push(...response.output);
    for (const call of calls) {
      const args = parseArguments(call.arguments);
      const result = args === null ? { error: 'INVALID_ARGUMENTS', message: 'Arguments are not valid JSON' } : await runTool(tctx, call.name, args);
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
    }
  }

  return {
    reply: reply || FALLBACK_REPLY,
    createdSuggestionIds: tctx.createdIds,
    stateChanged: tctx.stateChanged,
    currentSlotKey: tctx.currentSlotKey,
    revision: tctx.revision,
  };
}

module.exports = { runOrchestratorTurn, replyText, MAX_STEPS, FALLBACK_REPLY };
