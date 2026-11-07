// Промпт «Формулювальник» (ТЗ §7): з розповіді викладача пише Description, Objectives, LO, Capstone, Criteria.
// Модель повертає лише текст і proposedValues; серверний сканер фактів (chat/draftSuggestions) доповнює proposedValues,
// а сама чернетка стає pending-карткою — стан змінює тільки Confirm (store.mutate).
const { httpError } = require('../../../utils/httpError');
const { slotOfPath } = require('../../syllabusState/paths');
const { getSlot } = require('../../syllabusState/slots');
const { renderText, renderState } = require('../../syllabusState/render');
const { requestJSON } = require('../review/common');
const { buildPreamble, untrusted } = require('./preamble');
const { NARRATIVE_SLOTS, DRAFTABLE, splitLines, draftTarget, listEntities, currentText } = require('../slotDrafts');

const PROMPT_VERSION = 'formulator-v1';

const str = { type: 'string' };
const proposedValuesSchema = {
  type: 'array',
  items: { type: 'object', properties: { label: str, value: str }, required: ['label', 'value'], additionalProperties: false },
};

const SLOT_RULES = {
  'course.description': 'Short Course Description: marketing tone that invites the student, address the reader as "you" (in Ukrainian: «ви»), 3 to 5 sentences, one paragraph. Say what the course is about and what happens in class. Use only what the instructor told you.',
  'course.objectives': 'Course Objectives: what the course sets out to achieve, 3 to 5 items, one per line, no bullets or numbering, each a full sentence-like statement.',
  'course.outcomes': 'Learning Outcomes (LO): 3 to 6 measurable outcomes, one per line, no bullets or numbering. EVERY outcome starts with an action verb in the base form (Analyze, Design, Evaluate, Apply, Build …; in Ukrainian an infinitive: Аналізувати, Розробити, Оцінити …). Do not prefix them with "Students will be able to".',
  'course.capstone': 'Connection to Capstone: 2 to 4 sentences on how this course prepares students for the Capstone project. Name the Capstone criteria the course prepares for, using their exact names from the list, and put their keys into criteriaKeys.',
  'assessment.criteria': 'Assessment criteria: what a strong submission looks like for this component, in one short paragraph. Use only what the instructor told you.',
};

const FACTS_RULE = 'Facts rule: do not invent numbers, percentages, durations, dates, names of people, companies, cases or readings. Use them only if the instructor stated them. If a draft cannot avoid one that the instructor did not state, include it in proposedValues exactly as written in the text (label + value), so the instructor confirms it.';

const sentenceCount = (text) => (String(text).match(/[^.!?…]+[.!?…]+/g) || []).length;
const BAD_VERB_START = /^(the|a|an|to|students?|ability|knowledge|understanding|understand|how|this|in|upon)\b/i;
// Українська (B-1.3): звертання на «ви», результат починається з інфінітива дії («Аналізувати», «Розробити»), не «Розуміти»
const YOU_UK = /(^|[^\p{L}])(ви|вас|вам|вами|ваш\p{L}*)(?![\p{L}])/iu;
const VERB_UK = /^[А-ЯІЇЄҐ][\p{L}'ʼ’-]*(ти|тися|тись)(?![\p{L}])/u;
const BAD_VERB_UK = /^(розуміти|знати|ознайомитися|ознайомитись|мати уявлення)/iu;

/** Детерміновані вимоги ТЗ до формулювань; повертає список помилок для коригувального повтору. */
function validateDraft(slotKey, item, language = 'en') {
  const uk = language === 'uk';
  const errors = [];
  const text = String(item.text || '').trim();
  if (!text) return [`${slotKey}: empty text`];
  if (slotKey === 'course.description') {
    const n = sentenceCount(text);
    if (n < 3 || n > 5) errors.push(`${slotKey}: must be 3 to 5 sentences, got ${n}`);
    if (uk ? !YOU_UK.test(text) : !/\byou(r|rs|rself)?\b/i.test(text)) errors.push(`${slotKey}: must address the reader as "${uk ? 'ви' : 'you'}"`);
  }
  if (slotKey === 'course.outcomes') {
    const lines = splitLines(text);
    const bad = lines.filter((l) => (uk ? BAD_VERB_UK.test(l) || !VERB_UK.test(l) : BAD_VERB_START.test(l) || !/^[A-Z][a-z]+/.test(l)));
    if (bad.length) errors.push(`${slotKey}: every outcome must start with an action verb; fix: ${bad.map((l) => `"${l.slice(0, 40)}"`).join(', ')}`);
  }
  if (slotKey === 'course.objectives' && !splitLines(text).length) errors.push(`${slotKey}: at least one objective`);
  return errors;
}

const sectionTitle = (refs, slotKey) => {
  const section = getSlot(slotKey)?.section;
  return (refs?.template || []).find((t) => t.key === section)?.title || slotKey;
};

function stateContext(state, refs) {
  return `Current syllabus (data):\n${untrusted(renderText(renderState(state, refs)).slice(0, 12000))}`;
}

const transcriptBlock = (transcript) => (transcript?.length
  ? `Conversation so far (instructor messages):\n${transcript.slice(-20).map((t) => `- ${t}`).join('\n')}`
  : '');

/**
 * Чернетки кількох слотів з однієї розповіді («одне питання → кілька чернеток»).
 * @param {{ state, refs, narrative: string, slotKeys: string[], transcript: string[] }} input
 * @returns {Promise<Array<{ slotKey, kind: 'edit', target: { path, entityId }, text, value, proposedValues: [{label,value}],
 *   rationale, title, description, promptVersion }>>} вхід для createDraftSuggestions (origin додає виклик)
 */
async function draftFromNarrative({ state, refs, narrative, slotKeys, transcript = [] } = {}) {
  const keys = [...new Set((slotKeys || []).filter((k) => NARRATIVE_SLOTS.includes(k)))];
  const criteria = refs?.capstone?.criteria || [];
  // Без критеріїв Capstone у довіднику програми слот capstone не чернеткується
  const wanted = keys.filter((k) => k !== 'course.capstone' || criteria.length);
  if (!wanted.length || !String(narrative || '').trim()) return [];

  const schema = {
    type: 'object',
    properties: {
      drafts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            slotKey: { type: 'string', enum: wanted },
            text: str,
            criteriaKeys: { type: 'array', items: criteria.length ? { type: 'string', enum: criteria.map((c) => c.key) } : str },
            proposedValues: proposedValuesSchema,
            rationale: str,
          },
          required: ['slotKey', 'text', 'criteriaKeys', 'proposedValues', 'rationale'],
          additionalProperties: false,
        },
      },
    },
    required: ['drafts'],
    additionalProperties: false,
  };
  const capstoneBlock = wanted.includes('course.capstone')
    ? `Capstone criteria of ${refs.programCode}:\n${criteria.map((c) => `- ${c.key}: ${c.name} — ${c.description}`).join('\n')}`
    : '';
  const system = [
    buildPreamble({ refs, state }),
    'Task: the instructor described the course in their own words. Draft the requested syllabus slots from that description. Return exactly one draft per requested slot.',
    wanted.map((k) => `- ${k}: ${SLOT_RULES[k]}`).join('\n'),
    FACTS_RULE,
    // B-4.1: короткий ввід — чернетка з того, що є, без вигаданих фактів; домисли — proposed_values
    'If the description is short, still draft from what you have: keep the wording general where details are missing, never invent facts, and put anything you had to guess into proposed values so it is highlighted for confirmation.',
    'text holds the draft (for list slots one item per line). criteriaKeys is only for course.capstone, otherwise []. rationale: one short sentence on which part of the instructor\'s description the draft is based on.',
    capstoneBlock,
  ].filter(Boolean).join('\n\n');
  const document = [
    stateContext(state, refs),
    transcriptBlock(transcript),
    `Requested slots: ${wanted.join(', ')}`,
    `Instructor's description of the course:\n${narrative}`,
  ].filter(Boolean).join('\n\n');

  const parsed = await requestJSON('formulator_narrative', schema, system, document, {
    validate: (out) => {
      const seen = out.drafts.map((d) => d.slotKey);
      return [
        ...wanted.filter((k) => !seen.includes(k)).map((k) => `${k}: missing draft`),
        ...(new Set(seen).size === seen.length ? [] : ['each slot must have exactly one draft']),
        ...out.drafts.flatMap((d) => [
          ...validateDraft(d.slotKey, d, state?.language),
          // Критерії Capstone — лише якщо вони є в довіднику набору (у MMM26 їх ще немає, B-8.10)
          ...(d.slotKey === 'course.capstone' && (refs?.capstone?.criteria || []).length && !d.criteriaKeys.length ? ['course.capstone: name at least one Capstone criterion'] : []),
        ]),
      ];
    },
  });

  return wanted.map((slotKey) => {
    const d = parsed.drafts.find((x) => x.slotKey === slotKey);
    const target = draftTarget(slotKey, { state, text: d.text });
    const named = d.criteriaKeys.map((k) => criteria.find((c) => c.key === k)?.name).filter(Boolean);
    // C13: ключі названих критеріїв Capstone ідуть у стан разом із текстом (Confirm пише { text, criteriaKeys }),
    // тож редактор довідників бачить, на які критерії посилається силабус
    const keys = d.criteriaKeys.filter((k) => criteria.some((c) => c.key === k));
    if (slotKey === 'course.capstone' && target) target.value = { text: target.value, criteriaKeys: [...new Set(keys)] };
    return {
      slotKey,
      kind: 'edit',
      ...target,
      proposedValues: d.proposedValues,
      rationale: d.rationale,
      title: `Draft: ${sectionTitle(refs, slotKey)}`,
      description: named.length ? `Prepares students for the Capstone criteria: ${named.join('; ')}.` : 'Drafted from your description of the course.',
      promptVersion: PROMPT_VERSION,
    };
  });
}

/**
 * Reword: нова версія чернетки картки за відгуком викладача. Відгук — пряма вказівка викладача, тож для політик
 * текст переформульовується лише в її межах.
 * @param {{ suggestion, feedback: string, state, refs, transcript: string[] }} input
 * @returns {Promise<{ text, value, proposedValues: [{label,value}], rationale, title, description, promptVersion }>}
 */
async function reword({ suggestion, feedback, state, refs, transcript = [] } = {}) {
  const path = suggestion?.target?.path;
  const draftValue = suggestion?.draft?.value;
  if (!path || !String(feedback || '').trim()) throw httpError(400, 'Feedback is required to reword a draft', { code: 'FEEDBACK_REQUIRED' });
  const slot = slotOfPath(path);
  const def = slot && DRAFTABLE[slot.key];
  const isList = Array.isArray(draftValue) && def?.mode === 'list';
  // Текст із супутніми полями (Capstone: { text, criteriaKeys }) — переформульовується лише text
  const isTextObject = draftValue && typeof draftValue === 'object' && !Array.isArray(draftValue) && typeof draftValue.text === 'string';
  if (!(typeof draftValue === 'string' || isList || isTextObject)) {
    throw httpError(422, 'This draft cannot be reworded; change the value directly', { code: 'NOT_REWORDABLE' });
  }
  const slotKey = slot?.key || 'policy.*';
  const rule = SLOT_RULES[slotKey]
    || (path.startsWith('policies{') ? 'Policy text: reword only as the instructor asks. Do not add rules, numbers or exceptions the instructor did not ask for.' : 'Reword the text as the instructor asks and keep its purpose.');

  const schema = {
    type: 'object',
    properties: { text: str, proposedValues: proposedValuesSchema, rationale: str, title: str, description: str },
    required: ['text', 'proposedValues', 'rationale', 'title', 'description'],
    additionalProperties: false,
  };
  const system = [
    buildPreamble({ refs, state }),
    'Task: rewrite the current draft of one syllabus slot according to the instructor\'s feedback. Keep what the feedback does not criticise. Return the full new text (for list slots one item per line).',
    `Slot rules: ${rule}`,
    FACTS_RULE,
    'title: a short card title; description: one sentence on what changed; rationale: one short sentence.',
  ].join('\n\n');
  const document = [
    stateContext(state, refs),
    transcriptBlock(transcript),
    `Current draft:\n${untrusted(currentText(draftValue))}`,
    `Instructor's feedback:\n${feedback}`,
  ].filter(Boolean).join('\n\n');

  const parsed = await requestJSON('formulator_reword', schema, system, document, {
    validate: (out) => validateDraft(slotKey, out, state?.language),
  });
  const text = isList ? splitLines(parsed.text).join('\n') : parsed.text.trim();
  return {
    text,
    value: isList ? listEntities(def, splitLines(text), draftValue) : isTextObject ? { ...draftValue, text } : text,
    proposedValues: parsed.proposedValues,
    rationale: parsed.rationale,
    title: parsed.title,
    description: parsed.description,
    promptVersion: PROMPT_VERSION,
  };
}

module.exports = { draftFromNarrative, reword, validateDraft, PROMPT_VERSION };
