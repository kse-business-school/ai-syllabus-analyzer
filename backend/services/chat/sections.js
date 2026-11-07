// Затвердження розділів: окремо, гуртово і зняття. Пише лише syllabusState/store (approveSection/unapproveSection/approveAll).

const store = require('../syllabusState/store');
const { httpError } = require('../../utils/httpError');
const { invalidateOutputs } = require('../outputs');
const { sectionGaps } = require('../syllabusState/slots');
const { runChecks } = require('../checks');
const { BLOCKING_SEVERITIES, loadContext, pendingCountsBySection, refreshConversationReadiness } = require('./state');

/**
 * Блокери гуртового затвердження: відкриті картки розділу або непройдені перевірки severity ≥ warning.
 * @returns {Promise<(key: string) => string|null>} причина (англійською) або null
 */
async function blockersBuilder(ctx) {
  const checks = runChecks(ctx.state, ctx.refs).filter((c) => c.passed === false && BLOCKING_SEVERITIES.includes(c.severity));
  const pending = await pendingCountsBySection(ctx.syllabus._id);
  return (key) => {
    const open = pending.bySection.get(key);
    if (open) return `${open} open suggestion${open > 1 ? 's' : ''}`;
    const failed = checks.filter((c) => c.section === key);
    if (failed.length) return `Open checks: ${failed.map((c) => c.id).join(', ')}`;
    return null;
  };
}

/** Розділи, які можна затвердити одним натисканням: пороги пройдені, відкритих карток і перевірок немає. */
async function approvableSections(ctx) {
  const blockerOf = await blockersBuilder(ctx);
  // Тексти рівня програми (nature: locked, «Педагогічний підхід») не затверджуються викладачем
  return (ctx.refs.template || [])
    .filter((t) => t.nature !== 'locked' && !ctx.state.sections?.[t.key]?.approved && !sectionGaps(t.key, ctx.state).length && !blockerOf(t.key))
    .map((t) => t.key);
}

async function approveSection(syllabusId, key, { userId, expectedRevision } = {}) {
  await loadContext(syllabusId);
  await store.approveSection(syllabusId, key, { by: userId, expectedRevision });
  invalidateOutputs(syllabusId);
  await refreshConversationReadiness(syllabusId);
}

async function unapproveSection(syllabusId, key, { userId, expectedRevision } = {}) {
  await loadContext(syllabusId);
  await store.unapproveSection(syllabusId, key, { by: userId, expectedRevision });
  invalidateOutputs(syllabusId);
  await refreshConversationReadiness(syllabusId);
}

/**
 * keys — розділи з картки approve-all (без них — усі). Блокери рахуються з того самого стану, який затверджується:
 * без expectedRevision від клієнта — ревізія, прочитана тут (інакше зміна між читанням і записом → 409 STATE_CONFLICT).
 * @returns {Promise<{ approved: string[], skipped: { key, reason }[] }>}
 */
async function approveAll(syllabusId, { userId, expectedRevision, keys } = {}) {
  const ctx = await loadContext(syllabusId);
  const blockersFor = await blockersBuilder(ctx);
  if (expectedRevision !== undefined && expectedRevision !== ctx.revision) {
    throw httpError(409, 'The syllabus was changed in the meantime. Reload and try again.', { code: 'STATE_CONFLICT', details: { revision: ctx.revision } });
  }
  // Без переліку — розділи профілю набору (B-6.1), крім текстів рівня програми (nature: locked)
  const profileKeys = (ctx.refs.template || []).filter((t) => t.nature !== 'locked').map((t) => t.key);
  const { approved, skipped } = await store.approveAll(syllabusId, {
    blockersFor, by: userId, expectedRevision: ctx.revision, keys: keys && keys.length ? keys : profileKeys,
  });
  invalidateOutputs(syllabusId);
  await refreshConversationReadiness(syllabusId);
  return { approved, skipped };
}

/**
 * Мова документа (B-1.2): окрема дія власника. Уже написаний текст не перекладається — змінюється лише
 * state.language, від якої залежать нові чернетки, питання, перевірки й тексти довідника політик.
 */
async function setDocumentLanguage(syllabusId, language, { userId, expectedRevision } = {}) {
  if (!['en', 'uk'].includes(language)) throw httpError(400, 'language must be "en" or "uk"', { code: 'VALIDATION_ERROR' });
  const ctx = await loadContext(syllabusId);
  await store.mutate(syllabusId, expectedRevision ?? ctx.revision, (st) => { st.language = language; }, {
    by: userId, source: 'instructor_directed', refs: ctx.refs,
  });
  invalidateOutputs(syllabusId);
}

/** Корпус і блок програми (B-8.6): лише значення із закритого списку програми; null — очистити. */
async function setProgramBlock(syllabusId, value, { userId, expectedRevision } = {}) {
  const ctx = await loadContext(syllabusId);
  const blocks = ctx.refs.programBlocks || [];
  const label = value == null || value === '' ? null : blocks.find((b) => b.label === value || b.code === value)?.label;
  if (label === undefined) throw httpError(400, blocks.length ? 'Choose a programme block from the list' : 'This programme has no blocks', { code: 'VALIDATION_ERROR' });
  await store.mutate(syllabusId, expectedRevision ?? ctx.revision, (st) => { st.header = { ...st.header, programBlock: label }; }, {
    by: userId, source: 'instructor_directed', refs: ctx.refs,
  });
  invalidateOutputs(syllabusId);
}

module.exports = { blockersBuilder, approvableSections, approveSection, unapproveSection, approveAll, setDocumentLanguage, setProgramBlock };
