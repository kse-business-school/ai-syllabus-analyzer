// Трек 2: розбір вхідного файлу по слотах (blocks → Syllabus.state), docs/V5_PLAN.md «Трек 2 — парсинг».
// extractSlots (LLM) → policyMatch (LLM-класифікація + детермінована схожість) → toState (детерміновано).
const { extractSlots } = require('./extractSlots');
const { matchPolicies } = require('./policyMatch');
const { toState } = require('./toState');
const references = require('../../references');

/**
 * @param {{ blocks: Block[], meta?, programCode, refs, course?: { title, code, fromOffering } }} input
 *   course — що відомо про курс поза файлом: назва — лише підказка courseKind; код — з призначення (має пріоритет
 *   над файлом) або з форми upload (якщо у файлі коду немає)
 * @param {{ extractSlots?, matchPolicies?, courseKind?, stats? }} deps  підміна залежностей (тести)
 * @returns {Promise<{ state, policyMatches: Array<{ key, candidateOptionKey, match, similarity }>, lockedNotes: Array<{ key, fileText, similarity, match, evidenceBlockIds }>,
 *   courseHint: { code, title, matchedBy: 'title' } | null, warnings: string[] }>}
 *   state валідний за syllabusState/schema.validateState, source 'parsed', evidenceBlockIds заповнені
 */
const filledCode = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

/** Код курсу: призначення курс × набір → файл → форма upload. */
function courseCodeOf(fileCode, course = {}) {
  if (course.fromOffering && filledCode(course.code)) return filledCode(course.code);
  return filledCode(fileCode) || filledCode(course.code);
}

async function parseToState({ blocks, meta = {}, programCode, refs, course = {} }, deps = {}) {
  const warnings = [];
  const extracted = await (deps.extractSlots || extractSlots)({ blocks, meta, refs }, { stats: deps.stats });
  warnings.push(...extracted.warnings);
  const { slots } = extracted;

  const policyResult = await (deps.matchPolicies || matchPolicies)({ segments: slots.policySegments, refs }, { stats: deps.stats });
  const courseCode = courseCodeOf(slots.header.code, course);
  const match = await (deps.courseKind || references.courseKind)(programCode, {
    courseCode, courseTitle: slots.header.title || course.title,
  });
  const state = toState({ slots, policies: policyResult.policies, programCode, refs,
    courseMatch: match, courseCode });
  // Збіг назви — лише підказка; E-поле лишається elective до підтвердження коду.
  const courseHint = match.matchedBy === 'title' && !state.header.courseCode
    ? { code: match.course.code, title: match.course.en || match.course.uk, matchedBy: 'title' }
    : null;

  return {
    state, policyMatches: policyResult.matches, lockedNotes: policyResult.lockedNotes, courseHint, warnings,
    // MMM, розділ 1 (B-8.8): ПРН, які курс підсилює за файлом, — без прив'язки до CLO; стають карткою-питанням
    programmeOutcomes: slots.programmeOutcomes || [],
  };
}

module.exports = { parseToState, courseCodeOf };
