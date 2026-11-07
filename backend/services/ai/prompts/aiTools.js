// Промпт «AI-інструменти курсу» (етап 10 ТЗ): конкретні формати завдань із AI для ЦІЄЇ дисципліни з прикладом школи,
// яка їх уже запровадила. Вибір лише з каталогу backend/fixtures/reference/ai-tools.json («AI in Your Course»):
// модель обирає id записів (enum у strict json_schema) і пише лише коротке «чому підходить» і «як адаптувати».
// Назви форматів, школи, рівень зусиль код бере з каталогу дослівно, тож вигаданих прикладів немає.
// Порожній каталог → [] без виклику LLM (промпт вимкнений, доки каталог не надано).
// Результат — не issue, а питання в чаті: kind 'question', origin 'orchestrator' додає виклик; у Readiness не враховується
// (Readiness = затверджені розділи).
const { requestJSON } = require('../review/common');
const { readFixture } = require('../../references/fixtureRefs');
const { scanFacts } = require('../facts');
const { renderText, renderState } = require('../../syllabusState/render');
const { buildPreamble, untrusted } = require('./preamble');

const PROMPT_VERSION = 'ai-tools-v1';
const MAX_PICKS = 3;
const EFFORTS = ['low', 'medium', 'high'];
// Куди потрапляє відповідь викладача: додаткова активність заняття (чернетка через formulator, entity — заняття)
const TARGET_PATH = 'sessions[].additional';
const CATALOG_FILE = 'ai-tools.json';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Каталог із фікстури: лише записи з обов'язковими id, title і school; id унікальні.
 * Форма запису — у `fixtures/reference/ai-tools.json` (поле `shape`).
 * @returns {Array<{ id, title, school, disciplines: string[], structure: string|null, effort: string|null, description: string }>}
 */
function normalizeCatalog(items) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const id = str(raw?.id);
    const title = str(raw?.title);
    const school = str(raw?.school);
    if (!id || !title || !school || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title,
      school,
      disciplines: (Array.isArray(raw.disciplines) ? raw.disciplines : []).map(str).filter(Boolean),
      structure: str(raw.structure) || null,
      effort: EFFORTS.includes(raw.effort) ? raw.effort : null,
      description: str(raw.description),
    });
  }
  return out;
}

function loadCatalog() {
  return normalizeCatalog(readFixture(CATALOG_FILE).items);
}

function picksSchema(ids, max) {
  return {
    type: 'object',
    properties: {
      picks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            itemId: { type: 'string', enum: ids },
            fit: { type: 'string' },
            adaptation: { type: 'string' },
          },
          required: ['itemId', 'fit', 'adaptation'],
          additionalProperties: false,
        },
      },
    },
    required: ['picks'],
    additionalProperties: false,
  };
}

const catalogLine = (i) => [
  `[${i.id}] ${i.title} (${i.school})`,
  i.disciplines.length && `disciplines: ${i.disciplines.join(', ')}`,
  i.structure && `structure: ${i.structure}`,
  i.effort && `effort: ${i.effort}`,
  i.description,
].filter(Boolean).join(' | ');

/**
 * @param {{ state: object, refs: object, catalog?: object[] }} input
 *   catalog — записи каталогу (для тестів); за замовчуванням fixtures/reference/ai-tools.json
 * @returns {Promise<Array<object>>} 0 або 1 вхід для createDraftSuggestions (kind 'question').
 *   [] — каталог порожній (LLM не викликається) або немає стану.
 */
async function suggestAiTools({ state, refs, catalog } = {}) {
  const items = catalog === undefined ? loadCatalog() : normalizeCatalog(catalog);
  if (!items.length) return [];
  if (!state) return [];
  const course = renderText(renderState(state, refs));

  const ids = items.map((i) => i.id);
  const max = Math.min(MAX_PICKS, items.length);
  const byId = new Map(items.map((i) => [i.id, i]));
  const system = [
    buildPreamble({ refs, state }),
    `Task: propose concrete AI-based assignment formats for THIS course. Pick 1 to ${max} entries from the catalog below, choosing the ones that fit the course content, its learning outcomes and its assessment best. Prefer a mix of effort levels when several fit.`,
    'You may only pick catalog entries by their id. Never invent an entry, a school or a result, and never describe what a school did beyond the catalog line.',
    'For each pick write two short sentences in the syllabus language. fit: why this format suits this course, in terms of its topics or learning outcomes. adaptation: how the instructor could run it in this course. Do not state numbers, dates, durations, grades, weights, names or titles: the instructor decides those.',
    'You only suggest. The instructor decides whether and where to use a format, so never claim a format is already part of the syllabus.',
  ].join('\n\n');
  const document = [
    `Course so far (data):\n${untrusted(course.slice(0, 8000))}`,
    `AI in Your Course catalog (data; pick by id):\n${items.map(catalogLine).join('\n')}`,
  ].join('\n\n');

  const known = [course, ...items.map(catalogLine)];
  const parsed = await requestJSON('ai_tools_picks', picksSchema(ids, max), system, document, {
    validate: (out) => {
      const seen = out.picks.map((p) => p.itemId);
      return [
        ...(seen.length >= 1 && seen.length <= max ? [] : [`pick between 1 and ${max} catalog entries`]),
        ...(new Set(seen).size === seen.length ? [] : ['each catalog entry may be picked once']),
        ...out.picks.flatMap((p) => {
          const facts = scanFacts(`${p.fit} ${p.adaptation}`, { known });
          return facts.length ? [`${p.itemId}: remove ${facts.map((f) => `"${f.value}"`).join(', ')} (numbers, dates and names must not be invented)`] : [];
        }),
      ];
    },
  });

  const picked = parsed.picks.map((p) => ({ ...p, item: byId.get(p.itemId) })).filter((p) => p.item);
  if (!picked.length) return [];
  const lines = picked.map(({ item, fit, adaptation }) => [
    `${item.title} (${item.school}${item.effort ? `, ${item.effort} effort` : ''})`,
    fit.trim(),
    `How to run it: ${adaptation.trim()}`,
  ].join('. ').replace(/\.{2,}/g, '.'));
  return [{
    kind: 'question',
    severity: 'info',
    title: 'AI-based assignment ideas for this course',
    description: lines.map((l) => `- ${l}`).join('\n'),
    rationale: `Selected from the "AI in Your Course" catalog (${picked.map((p) => p.itemId).join(', ')}); each format is already used by the school named next to it.`,
    question: 'Would you like to use one of these formats? Tell me which one and in which session or assessment, and I will draft it.',
    target: { path: TARGET_PATH, entityId: null },
    promptVersion: PROMPT_VERSION,
  }];
}

module.exports = { suggestAiTools, normalizeCatalog, loadCatalog, PROMPT_VERSION, MAX_PICKS };
