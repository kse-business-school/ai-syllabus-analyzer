// Strict function tools оркестратора чату (Responses API: { type: 'function', name, description, parameters, strict: true }).
// Опис для моделі лише пояснює, що робить інструмент; обмеження (locked, лише free A/C, підтвердження) примусово
// виконує handlers.js, а не промпт (docs/api-v5.md §8).
const { SLOTS } = require('../../syllabusState/slots');
const { SESSION_TYPES, DELIVERY_FORMATS } = require('../../syllabusState/schema');
const { ITEM_SLOTS, COMPENSATION_GROUPS } = require('../slotDrafts');

const nullable = (type) => ({ type: [type, 'null'] });

/** Ключі слотів, відомі стану: реєстр без шаблону policy.* плюс блоки політик зі state.policies. */
function slotKeysOf(state) {
  const policyKeys = (state?.policies || []).map((p) => p.key);
  return [...SLOTS.map((s) => s.key).filter((k) => k !== 'policy.*'), ...policyKeys];
}

const fn = (name, description, properties) => ({
  type: 'function',
  name,
  description,
  strict: true,
  parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
});

/**
 * @param {object} state Syllabus.state (для enum ключів політик)
 * @returns {object[]} tools для createResponse
 */
function buildTools(state) {
  const key = { type: 'string', enum: slotKeysOf(state), description: 'Slot key from the syllabus slot registry' };
  return [
    fn('get_slot', 'Read the current value of a syllabus slot. The value is returned as untrusted document data.', { key }),
    fn('set_slot',
      'Write the instructor\'s answer into a simple single-value slot (title, ECTS, total hours, department, language, study mode, delivery mode). '
      + 'Only works when the value appears literally in the instructor\'s last message; otherwise use propose_draft.',
      { key, value: { type: ['string', 'number'], description: 'The value exactly as the instructor said it' } }),
    fn('propose_draft',
      'Create a draft card for the instructor to Confirm. Use it for wording (description, objectives, learning outcomes, capstone, prerequisites, criteria of an existing assessment), '
      + 'for values the instructor did not state literally, and for policy text. For a policy, instruction must quote the instructor\'s own request. '
      + 'List every number, date, duration, name or title that the instructor did not state in proposed_values.',
      {
        key,
        text: { type: 'string', description: 'The draft text; for list slots (objectives, outcomes) one item per line' },
        instruction: { ...nullable('string'), description: 'Policy slots only: a verbatim quote from the instructor\'s message asking for this policy text; otherwise null' },
        entity_id: { ...nullable('string'), description: 'Id of the assessment or session for per-item slots (assessment.criteria, schedule.additional); otherwise null' },
        proposed_values: {
          type: 'array',
          description: 'Facts in the text that the instructor has not stated',
          items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string', description: 'Exactly as written in text' } }, required: ['label', 'value'], additionalProperties: false },
        },
      }),
    fn('propose_items',
      'Create a draft card that adds, changes or replaces items of a list section: sessions (schedule.sessions), individual work (schedule.individual_work), '
      + 'assessment components with weight, deadline and criteria (assessment.components), compensation and retake rules (assessment.compensation), '
      + 'required or recommended readings (materials.required, materials.recommended). Use the instructor\'s own words; leave a field null when they did not say it. '
      + 'Numbers, dates and titles the instructor did not state are flagged on the card for confirmation automatically.',
      {
        key: { type: 'string', enum: Object.keys(ITEM_SLOTS), description: 'List slot key' },
        mode: { type: 'string', enum: ['append', 'replace'], description: 'append: add new items and change the items given by id; replace: the list becomes exactly these items' },
        items: {
          type: 'array',
          description: 'One entry per item',
          items: {
            type: 'object',
            properties: {
              id: { ...nullable('string'), description: 'Id of an existing item to change (from get_slot); null for a new item' },
              label: { type: 'string', description: 'Session topic, task title, component name, rule text or reading citation; empty string keeps the current one for an existing item' },
              hours: { ...nullable('number'), description: 'Academic hours (sessions, individual work)' },
              weight: { ...nullable('number'), description: 'Assessment weight in percent' },
              type: { type: ['string', 'null'], enum: [...SESSION_TYPES, null], description: 'Session type' },
              format: { type: ['string', 'null'], enum: [...DELIVERY_FORMATS, null], description: 'Session delivery format' },
              date: { ...nullable('string'), description: 'Session date as the instructor said it' },
              time: { ...nullable('string'), description: 'Session time as the instructor said it' },
              deadline: { ...nullable('string'), description: 'Assessment deadline as the instructor said it' },
              criteria: { ...nullable('string'), description: 'Assessment criteria' },
              guest: { ...nullable('string'), description: 'Guest speaker of a session' },
              url: { ...nullable('string'), description: 'Link to a reading, only if the instructor gave it' },
              group: { type: ['string', 'null'], enum: [...COMPENSATION_GROUPS, null], description: 'Compensation rules only: comp, proof (proof of absence), retake, improve' },
            },
            required: ['id', 'label', 'hours', 'weight', 'type', 'format', 'date', 'time', 'deadline', 'criteria', 'guest', 'url', 'group'],
            additionalProperties: false,
          },
        },
      }),
    fn('propose_instructor',
      'Create a draft card that fills in or updates the instructor profile (name, position, email, office hours, assistants, expertise, education, experience). '
      + 'Use null for every field the instructor did not mention; it keeps the current value.',
      {
        name: nullable('string'),
        position: nullable('string'),
        email: nullable('string'),
        office_hours: nullable('string'),
        assistants: nullable('string'),
        expertise: { type: ['array', 'null'], items: { type: 'string' } },
        education: { type: ['array', 'null'], items: { type: 'string' } },
        experience: { type: ['array', 'null'], items: { type: 'string' } },
      }),
    fn('apply_edit',
      'Apply a pending draft that was created earlier. Works only after the instructor explicitly confirmed in their last message and every proposed value is confirmed; '
      + 'otherwise ask the instructor to press Confirm on the card.',
      { draft_id: { type: 'string' } }),
    fn('run_checks', 'Run the syllabus checks and return the open issues and per-section readiness.', {}),
    fn('suggest_plo',
      'Suggest which programme learning outcomes (PLO) each course learning outcome (CLO) supports. Creates cards the instructor confirms.',
      { outcome_ids: { type: 'array', items: { type: 'string' }, description: 'CLO ids; empty array for all CLOs' } }),
    fn('suggest_readings',
      'Search the web for readings or cases on a topic. Only sources whose link was verified are proposed, as a card the instructor confirms.',
      { query: { type: 'string' } }),
    fn('suggest_ai_tools',
      'Suggest concrete AI-based assignment formats for this course, chosen only from the "AI in Your Course" catalog together with the school that already runs each format. Creates a question card for the instructor; does nothing while the catalog is empty.',
      {}),
  ];
}

const TOOL_NAMES = ['get_slot', 'set_slot', 'propose_draft', 'propose_items', 'propose_instructor', 'apply_edit', 'run_checks', 'suggest_plo', 'suggest_readings', 'suggest_ai_tools'];

module.exports = { buildTools, slotKeysOf, TOOL_NAMES };
