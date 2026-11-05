// Створення v5-карток (Suggestion з target + draft) — спільне для ревізора треку 2, перевірок і оркестратора чату.
// Пропозиція не змінює стан: стан змінюється лише при accept (Confirm) через syllabusState/store.mutate.
const crypto = require('crypto');
const Suggestion = require('../../models/Suggestion');
const { getPath, sectionOfPath } = require('../syllabusState/paths');
const { mergeProposedValues, scanFacts, toTemplate } = require('../ai/facts');
const { currentText } = require('../ai/slotDrafts');
const { stripUrls, urlsIn, normalizeUrl } = require('../ai/review/caseSources');

// Позначка в описі картки, з якої прибрано неперевірене посилання (англійською, як увесь UI v5)
const SOURCE_NOT_CONFIRMED = 'Source not confirmed: an unverified link was removed from this draft.';

// Порядок показу: critical перед improvement, всередині — за order розділу шаблону (ТЗ §6)
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'warning', 'low', 'info'];

function stableStringify(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

/** hash значення слота: basisHash у чернетці і перевірка STALE_DRAFT при accept. */
const hashValue = (value) => crypto.createHash('sha1').update(stableStringify(value ?? null)).digest('hex');

function orderFor({ severity, section }, refs) {
  const sectionOrder = (refs?.template || []).find((t) => t.key === section)?.order ?? 99;
  const rank = SEVERITY_ORDER.indexOf(severity);
  return (rank < 0 ? SEVERITY_ORDER.length : rank) * 100 + sectionOrder;
}

/** Рядки значення (будь-якої вкладеності) для пошуку URL. */
function stringsOf(value) {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

/** Прибирає неперевірені URL з усіх рядків значення; поле url, що стало порожнім, — null (і verified: false). */
function stripValueUrls(value, allowed, removed) {
  if (typeof value === 'string') return stripUrls(value, allowed, removed);
  if (Array.isArray(value)) return value.map((v) => stripValueUrls(v, allowed, removed));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripValueUrls(v, allowed, removed);
    if (typeof value.url === 'string' && value.url && !out.url) {
      out.url = null;
      if ('verified' in out) out.verified = false;
    }
    return out;
  }
  return value;
}

/**
 * Зовнішні URL у чернетці — лише ті, що назвав викладач або вже є в документі (known, поточне значення слота),
 * або перевірені сервером (sources з verified: true — їх заздалегідь перевіряє readings.js через caseSources.verifyUrl).
 * Решта вирізається синхронно, без мережі.
 * @returns {{ text, value, proposedValues, removed: string[] }}
 */
function sanitizeUrls({ text, value, proposedValues = [] }, { known = [], current, sources = [] }) {
  const allowed = new Set([
    ...known.flatMap(urlsIn),
    ...stringsOf(current).flatMap(urlsIn),
    ...sources.filter((src) => src?.verified && src.url).map((src) => normalizeUrl(src.url)),
  ]);
  const removed = [];
  return {
    text: typeof text === 'string' ? stripUrls(text, allowed, removed) : text,
    value: value === undefined ? value : stripValueUrls(value, allowed, removed),
    proposedValues: proposedValues
      .map((v) => (typeof v?.value === 'string' ? { ...v, value: stripUrls(v.value, allowed, removed) } : v))
      .filter((v) => v?.value !== ''),
    removed,
  };
}

/**
 * Готує документ Suggestion v5 з чернетки (без запису в БД).
 * @param {object} input { origin, checkId?, criterionId?, severity, kind, title, description, rationale,
 *   target: { path (конкретний: 'summary.shortDescription', 'assessments[as1].criteria', 'policies{policy.late}'), entityId? }, value?, text?, proposedValues?, options?, question?, applicable?, sources?, evidenceBlockIds? }
 * @param {object} ctx { syllabusId, state, refs, known: string[] } known — репліки викладача й тексти довідників для сканера фактів
 */
function buildDraftSuggestion(rawInput, { syllabusId, state, refs, known = [] }) {
  const section = rawInput.target.section || sectionOfPath(rawInput.target.path) || null;
  const current = getPath(state, rawInput.target.path);
  // Вигадані моделлю посилання (Reword, answer, Ревізор, formulator) не доходять до стану й .docx
  const clean = sanitizeUrls(rawInput, { known, current, sources: rawInput.sources || [] });
  const input = { ...rawInput, text: clean.text, value: clean.value, proposedValues: clean.proposedValues };
  if (clean.removed.length) input.description = [rawInput.description, SOURCE_NOT_CONFIRMED].filter(Boolean).join('\n\n');
  const text = typeof input.text === 'string' ? input.text : (input.value == null ? null : currentText(input.value));
  // factsScanned: чернетку списку сутностей зібрав сервер (slotDrafts.itemsDraft) — факти й шаблон уже пораховані
  // по полях, повторне сканування відображуваного тексту дало б дублікати без прив'язки до поля
  const proposedValues = input.factsScanned || text == null
    ? mergeProposedValues(input.proposedValues || [])
    : mergeProposedValues(input.proposedValues || [], scanFacts(text, { known }));
  return {
    syllabusId,
    origin: input.origin,
    checkId: input.checkId || null,
    criterionId: input.criterionId || null,
    section,
    severity: input.severity || 'medium',
    kind: input.kind || 'edit',
    title: input.title || '',
    description: input.description || '',
    rationale: input.rationale || '',
    evidenceBlockIds: input.evidenceBlockIds || [],
    target: { section, path: input.target.path, entityId: input.target.entityId || null },
    // Питання й вибір без значення — без чернетки (значення з'явиться після answer / вибору варіанта)
    draft: input.choiceBasis ? {
      value: null, source: 'instructor_directed', proposedValues: [], basisHash: hashValue(current),
    } : input.kind === 'question' || (input.kind === 'choice' && input.value === undefined) ? undefined : {
      value: input.value !== undefined ? input.value : text,
      source: input.source === 'instructor_directed' ? 'instructor_directed' : 'ai_draft',
      template: input.factsScanned ? (input.template ?? null) : text != null && proposedValues.length ? toTemplate(text, proposedValues) : null,
      proposedValues,
      basisHash: hashValue(current),
    },
    options: input.options || [],
    question: input.question || undefined,
    applicable: input.applicable !== false,
    sources: input.sources || [],
    order: orderFor({ severity: input.severity, section }, refs),
    promptVersion: input.promptVersion || null,
  };
}

/** Записує картки; повертає створені документи. */
async function createDraftSuggestions(inputs, ctx) {
  const docs = inputs.map((i) => buildDraftSuggestion(i, ctx));
  if (!docs.length) return [];
  return Suggestion.insertMany(docs);
}

module.exports = {
  buildDraftSuggestion, createDraftSuggestions, hashValue, stableStringify, orderFor, sanitizeUrls, SEVERITY_ORDER, SOURCE_NOT_CONFIRMED,
};
