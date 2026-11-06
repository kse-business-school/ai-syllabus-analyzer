// План інтерв'ю: одна розповідь покриває кілька D-слотів, похідні поради й політики не стають питаннями.
// Дозволені лише C/D-слоти з editability free: A (автопідстановка), B (довідник) і E (обчислюється) не питаються ніколи.
const { sectionTitle, sectionQuestion, phrases } = require('../references/sectionText');
const { SLOTS } = require('../syllabusState/slots');
const { getPath } = require('../syllabusState/paths');
const { NARRATIVE_SLOTS } = require('./slotDrafts');

// Порядок = потік розмови: про курс → результати → сесії → оцінювання → матеріали (політики — картки policy-choice)
const QUESTION_SLOTS = [
  ...NARRATIVE_SLOTS, 'schedule.sessions', 'schedule.individual_work', 'assessment.criteria', 'materials.required',
];

function hasContent(value) {
  if (Array.isArray(value)) return value.some(hasContent);
  if (value && typeof value === 'object') return hasContent(value.text ?? value.citation ?? value.topic ?? value.title);
  return value !== null && value !== undefined && String(value).trim() !== '';
}

/**
 * Детермінований пре-фільтр: порожні, не пропущені C/D-слоти у порядку потоку.
 * Якщо викладач попросив розділ (preferredSection) і в ньому є що питати — лише цей розділ.
 */
function candidates({ state, refs, skipped = [], preferredSection } = {}) {
  const open = QUESTION_SLOTS.map((key) => SLOTS.find((s) => s.key === key))
    .filter((s) => s && ['C', 'D'].includes(s.type) && s.editability === 'free'
      && !skipped.includes(s.key) && !skipped.includes(s.section)
      && (refs?.template || []).some((t) => t.key === s.section)
      && !hasContent(getPath(state, s.path)));
  const preferred = preferredSection ? open.filter((s) => s.section === preferredSection) : [];
  return preferred.length ? preferred : open;
}

/** Шаблонне питання за слотом — мовою документа (language = state.language, B-1.3). */
function templateQuestion(slot, refs, language = 'en') {
  const section = refs.template.find((t) => t.key === slot.section);
  const narrative = refs.template.find((t) => t.key === 'short_description');
  const title = sectionTitle(section, language);
  const say = phrases(language);
  return {
    slotKey: slot.key,
    question: sectionQuestion(section, language) || (NARRATIVE_SLOTS.includes(slot.key) && sectionQuestion(narrative, language))
      || say.include(title),
    why: NARRATIVE_SLOTS.includes(slot.key) ? say.narrative : say.needsInput(title),
  };
}

module.exports = { candidates, templateQuestion, hasContent, QUESTION_SLOTS };
