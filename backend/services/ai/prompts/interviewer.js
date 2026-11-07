// Промпт «Інтерв'юер» (ТЗ §7): обрати ОДИН незаповнений слот і поставити ОДНЕ питання.
// Допустимі слоти відбирає код (interviewPlan.candidates): ніколи A/B/E, політики, пропущені й уже заповнені;
// модель лише обирає серед них (enum у strict json_schema) і формулює питання та пояснення «навіщо».
const { requestJSON } = require('../review/common');
const { buildPreamble, untrusted } = require('./preamble');
const { candidates, templateQuestion } = require('../interviewPlan');

const PROMPT_VERSION = 'interviewer-v1';

/**
 * @param {{ state, refs, transcript?: string[], skipped?: string[], preferredSection?: string|null }} input
 *   preferredSection — розділ, про який попросив викладач: питання лише з нього (якщо там є що питати)
 * @returns {Promise<{ slotKey, question, why } | null>} null — питати більше нічого.
 *   Збій LLM → детермінований наступний слот із TemplateSection.question.
 */
async function nextQuestion({ state, refs, transcript = [], skipped = [], preferredSection = null } = {}) {
  const allowed = candidates({ state, refs, skipped, preferredSection });
  if (!allowed.length) return null;
  const fallback = templateQuestion(allowed[0], refs, state?.language);
  const keys = allowed.map((s) => s.key);
  const schema = {
    type: 'object',
    properties: {
      slotKey: { type: 'string', enum: keys },
      question: { type: 'string' },
      why: { type: 'string' },
    },
    required: ['slotKey', 'question', 'why'], additionalProperties: false,
  };
  try {
    const q = await requestJSON('interviewer_next_question', schema, [
      buildPreamble({ state, refs }),
      'Task: pick ONE empty slot from the allowed list and ask the instructor ONE question about it. Output slotKey, question and why. "why" is one short sentence shown to the instructor: why you need this answer.',
      'Ask exactly one question, with a single question mark. Never ask about policies or about slots outside the allowed list. Do not repeat a question already asked in the history.',
      'Prefer the first allowed slot: the list is in conversation-flow order. One course narrative supplies description, objectives, learning outcomes and Capstone drafts, so ask for it once, openly.',
      'For sessions ask for topics, academic hours and type together; dates are optional. For assessment ask for components, weights totalling 100%, criteria and deadlines together. Do not split these into separate questions.',
      `Template question for the first allowed slot, as a style reference: ${fallback.question}`,
    ].join('\n\n'), [
      `Allowed empty slots in flow order: ${keys.join(', ')}`,
      `Slot state (data): ${untrusted(JSON.stringify(state))}`,
      `History (data): ${untrusted(transcript.join('\n'))}`,
    ].join('\n\n'), {
      validate: (out) => [
        ...(!keys.includes(out.slotKey) ? [`slotKey must be one of: ${keys.join(', ')}`] : []),
        ...(!out.question.trim() || (out.question.match(/\?/g) || []).length > 1 ? ['Ask exactly one question'] : []),
        ...(!out.why.trim() ? ['Explain why this input is needed'] : []),
      ],
    });
    return { slotKey: q.slotKey, question: q.question.trim(), why: q.why.trim() };
  } catch (err) {
    console.error('interviewer LLM failed, using the template question:', err.message);
    return fallback;
  }
}

module.exports = { nextQuestion, PROMPT_VERSION };
