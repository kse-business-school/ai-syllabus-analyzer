// Читання і запис значення слота за target.path: єдине місце, де чернетка (draft.value) стає значенням стану.
// Сам запис у БД робить лише syllabusState/store.mutate; тут — чисті функції над копією стану.

const { optionText } = require('../references/policyText');
const { httpError } = require('../../utils/httpError');
const { getPath, setPath, slotOfPath } = require('../syllabusState/paths');

const POLICY_PATH = /^policies\{([^}]+)\}$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const filled = (v) => v !== null && v !== undefined && String(v).trim() !== '';

/** Ключ політики для шляху 'policies{policy.late}' або null. */
function policyKeyOf(path) {
  const m = POLICY_PATH.exec(String(path));
  return m ? m[1] : null;
}

const lockedError = () => httpError(409, 'This part of the syllabus is locked and cannot be edited.', { code: 'LOCKED' });

/** locked-слоти (A-програма, E-поля, locked-політики) змінювати не можна ні чату, ні інструментам. */
function assertWritable(state, path) {
  const key = policyKeyOf(path);
  if (key) {
    const block = (state.policies || []).find((p) => p.key === key);
    if (!block) throw httpError(404, `Unknown policy: ${key}`, { code: 'UNKNOWN_POLICY' });
    if (block.mode === 'locked') throw lockedError();
    return;
  }
  const slot = slotOfPath(path);
  if (slot && (slot.editability === 'locked' || slot.type === 'E')) throw lockedError();
}

// Нові сутності масиву: рядок → { id, text }, об'єкт зберігає свої поля; id і провенанс доповнюються
function toEntities(path, value, current, source) {
  const prefix = { 'summary.objectives[]': 'obj', 'outcomes[]': 'lo' }[path] || 'e';
  const list = Array.isArray(value) ? value : String(value ?? '').split(/\n+/).map((t) => t.trim()).filter(Boolean);
  const used = new Set(list.map((v) => (isObject(v) ? v.id : null)).filter(Boolean));
  let n = 0;
  const nextId = () => {
    do { n += 1; } while (used.has(`${prefix}${n}`));
    used.add(`${prefix}${n}`);
    return `${prefix}${n}`;
  };
  const extras = path === 'outcomes[]' ? { plo: [], assessmentIds: [] } : {};
  return list.map((item) => {
    const base = isObject(item) ? item : { text: String(item) };
    const prev = (current || []).find((c) => c.id && c.id === base.id);
    return { ...extras, ...prev, ...base, id: base.id || nextId(), source: base.source || source, evidenceBlockIds: base.evidenceBlockIds || [] };
  });
}

/**
 * Нове значення слота. Рядок для об'єкта з `text` пише поле text і провенанс;
 * масив сутностей (`outcomes[]`, `summary.objectives[]`) нормалізується; решта — пряма заміна.
 * Політики сюди не потрапляють — див. policyPatch.
 */
function writeSlot(state, path, value, { source }) {
  const current = getPath(state, path);
  if (/^outcomes\[[^\]]+\]\.plo$/.test(path) && Array.isArray(value)) {
    return setPath(state, path, value.map((mapping) => ({ ...mapping, confirmed: true })));
  }
  if (typeof value === 'string' && isObject(current) && 'text' in current) {
    return setPath(state, path, { ...current, text: value, source, evidenceBlockIds: [] });
  }
  // B08: текстовий слот-об'єкт, якого ще немає в старому стані (необов'язковий ключ схеми) — створюється як об'єкт
  if (typeof value === 'string' && current === undefined && textObjectPaths().has(path)) {
    return setPath(state, path, { text: value, source, evidenceBlockIds: [] });
  }
  // Текст із супутніми полями чернетки (Capstone: { text, criteriaKeys }): решта полів слота зберігається
  if (isObject(value) && typeof value.text === 'string' && isObject(current) && 'text' in current) {
    const known = Object.fromEntries(Object.entries(value).filter(([k]) => k in current && !['source', 'evidenceBlockIds'].includes(k)));
    return setPath(state, path, { ...current, ...known, source, evidenceBlockIds: [] });
  }
  if (path.endsWith('[]') && (Array.isArray(current) || current === undefined)) {
    return setPath(state, path, toEntities(path, value, current, source));
  }
  return setPath(state, path, value);
}

/** Шляхи текстових слотів-об'єктів { text, … } (реєстр чернеток DRAFTABLE, без полів сутностей). */
let textPaths = null;
function textObjectPaths() {
  if (!textPaths) {
    const { DRAFTABLE } = require('../ai/slotDrafts');
    textPaths = new Set(Object.values(DRAFTABLE).filter((d) => d.mode === 'text' && !d.entity).map((d) => d.path));
  }
  return textPaths;
}

/** Текст варіанта політики з довідника. */
function libraryOption(refs, policyKey, optionKey) {
  const block = (refs?.policyLibrary?.blocks || []).find((b) => b.key === policyKey);
  return (block?.options || []).find((o) => o.key === optionKey) || null;
}

/**
 * Зміна блоку політики за рішенням викладача (docs/api-v5.md §9):
 * - варіант довідника: optionKey + текст варіанта, source fixture, modified false;
 * - власний/змінений текст: source fixture_edited (якщо варіант уже було обрано) або instructor_directed, modified true.
 */
function policyPatch(block, { optionKey, text }, refs, language = 'en') {
  if (optionKey) {
    const option = libraryOption(refs, block.key, optionKey);
    if (!option) throw httpError(400, `Unknown option for ${block.key}: ${optionKey}`, { code: 'UNKNOWN_OPTION' });
    return {
      ...block, optionKey, text: optionText(option, language), modified: false, source: 'fixture',
      fixtureRef: { key: block.key, version: refs.policyLibrary.version ?? null }, evidenceBlockIds: [],
    };
  }
  if (!filled(text)) throw httpError(409, 'There is no text to apply.', { code: 'NOT_APPLICABLE' });
  return {
    ...block, text, modified: true, source: filled(block.optionKey) ? 'fixture_edited' : 'instructor_directed', evidenceBlockIds: [],
  };
}

function setPolicy(state, key, patch) {
  return { ...state, policies: (state.policies || []).map((p) => (p.key === key ? patch : p)) };
}

module.exports = { policyKeyOf, assertWritable, writeSlot, policyPatch, setPolicy, libraryOption, lockedError, filled };
