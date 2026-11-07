// Подання для фронтенду (docs/api-v5.md §6): GET-view розмови, SuggestionView v5, права панель документа.

const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const Suggestion = require('../../models/Suggestion');
const { renderState } = require('../syllabusState/render');
const { diffRendered } = require('../syllabusState/diff');
const { getPath } = require('../syllabusState/paths');
const { computeReadiness } = require('../syllabusState/readiness');
const { runChecks } = require('../checks');
const references = require('../references');
const { outputList } = require('../outputFormats');
const { hashValue } = require('./draftSuggestions');
const { policyKeyOf, libraryOption } = require('./slotWrite');
const { loadSyllabus, loadContext, isV4, requiresReason } = require('./state');

const MESSAGE_LIMIT = 200;
const REBUILD_HINT = 'Rebuild in the new format';
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Значення слота у вигляді для картки: блок політики → текст, об'єкт із `text` → рядок. */
function displayOf(path, raw) {
  if (raw === undefined) return null;
  if (policyKeyOf(path)) return raw?.text ?? null;
  if (isObject(raw) && 'text' in raw && !('id' in raw)) return raw.text ?? null;
  return raw;
}

function optionView(s, o, refs) {
  const key = policyKeyOf(s.target.path);
  const fixtureText = key && o.optionKey ? libraryOption(refs, key, o.optionKey)?.text ?? null : null;
  return {
    id: o.id,
    label: o.label,
    optionKey: o.optionKey || null,
    writeBack: o.writeBack !== false,
    value: o.value ?? null,
    after: o.value !== undefined && o.value !== null ? o.value : fixtureText,
    rationale: o.rationale || null,
  };
}

/**
 * SuggestionView v5. before = поточне значення слота,
 * after = значення чернетки.
 * @param {object} s       Suggestion
 * @param {{ state, refs }} ctx
 */
function buildSuggestionView(s, { state, refs }) {
  const path = s.target.path;
  const current = displayOf(path, getPath(state, path));
  const draft = s.draft ? {
    value: s.draft.value ?? null,
    source: s.draft.source || 'ai_draft',
    template: s.draft.template ?? null,
    proposedValues: (s.draft.proposedValues || []).map((v) => ({
      id: v.id, label: v.label, value: v.value, path: v.path ?? null, confirmed: Boolean(v.confirmed),
    })),
    basisHash: s.draft.basisHash ?? null,
  } : null;
  let stale = Boolean(s.stale);
  if (s.status === 'pending' && draft?.basisHash) stale ||= hashValue(getPath(state, path)) !== draft.basisHash;
  return {
    id: String(s._id),
    _id: String(s._id),
    syllabusId: String(s.syllabusId),
    origin: s.origin || null,
    checkId: s.checkId || null,
    criterionId: s.criterionId || null,
    section: s.section || s.target.section || null,
    severity: s.severity,
    kind: s.kind,
    title: s.title,
    description: s.description,
    rationale: s.rationale || null,
    target: { section: s.target.section || s.section || null, path, entityId: s.target.entityId || null },
    before: current,
    after: draft ? draft.value : null,
    draft,
    unconfirmedCount: (draft?.proposedValues || []).filter((v) => !v.confirmed).length,
    options: (s.options || []).map((o) => optionView(s, o, refs)),
    question: s.kind === 'question' ? (s.question || '') : null,
    answer: s.answer || null,
    applicable: s.applicable !== false,
    stale,
    status: s.status,
    selectedOptionId: s.selectedOptionId || null,
    decisionReason: s.decisionReason || null,
    rejectTag: s.rejectTag || null,
    requiresReason: requiresReason(s),
    versionsCount: (s.versions || []).length,
    sources: (s.sources || []).map(({ title, publisher, year, url, verified }) => ({
      title, publisher: publisher ?? null, year: year ?? null, url: url ?? null, verified: Boolean(verified),
    })),
    order: s.order,
  };
}

async function suggestionViews(syllabusId, suggestions, ctx) {
  return suggestions.filter((s) => s.target?.path).map((s) => buildSuggestionView(s, ctx));
}

function isOwner(syllabus, userId) {
  return Boolean(userId) && String(syllabus.instructor?._id || syllabus.instructor) === String(userId);
}

function syllabusSummary(syllabus, userId) {
  const v4 = isV4(syllabus);
  const waiting = syllabus.status === 'analyzing' || syllabus.status === 'error';
  const needsRebuild = Boolean(syllabus.needsRebuild || syllabus.legacy || (v4 && !waiting));
  return {
    id: String(syllabus._id),
    title: syllabus.title,
    status: syllabus.status,
    track: syllabus.track || 'upload',
    programCode: syllabus.programCode || null,
    canMutate: isOwner(syllabus, userId) && syllabus.status === 'in_progress' && !v4,
    needsRebuild,
    ...(needsRebuild ? { hint: REBUILD_HINT } : {}),
    analysisStage: syllabus.analysisStage || null,
    analysisError: syllabus.analysisError || null,
    outputs: v4 ? [] : outputList(syllabus),
  };
}

async function recentMessages(conversation, limit) {
  if (!conversation) return [];
  // Беремо ОСТАННІ `limit` повідомлень і повертаємо їх за зростанням часу
  const latest = await Message.find({ conversationId: conversation._id }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  return latest.reverse();
}

/**
 * GET /api/chat/:syllabusId.
 * До /start conversation = null. Силабус v4 (без стану) віддається лише для читання: state = null, без карток.
 */
async function getConversationView(syllabusId, { userId, limit = MESSAGE_LIMIT } = {}) {
  const syllabus = await loadSyllabus(syllabusId);
  const conversation = await Conversation.findOne({ syllabusId });
  const messages = await recentMessages(conversation, limit);
  const base = {
    syllabus: syllabusSummary(syllabus, userId),
    conversation: conversation ? conversation.toObject() : null,
    messages,
  };
  if (isV4(syllabus)) {
    return { ...base, state: null, revision: 0, sections: [], readiness: null, checks: [], suggestions: [] };
  }
  const refs = await references.getRefs(syllabus.programCode);
  const state = syllabus.state;
  const checks = runChecks(state, refs);
  const docs = await Suggestion.find({ syllabusId }).sort({ order: 1, _id: 1 });
  const suggestions = await suggestionViews(syllabusId, docs, { state, refs });
  const pending = suggestions.filter((s) => s.status === 'pending').length;
  return {
    ...base,
    state,
    revision: syllabus.stateRevision || 0,
    sections: refs.template,
    // Закритий список «Корпус і блок програми» (B-8.6); порожній — поля немає
    programBlocks: refs.programBlocks || [],
    readiness: computeReadiness(state, { refs, checks, pendingSuggestions: pending }),
    checks,
    suggestions,
  };
}

/** Один блок правої панелі: kind, text і (для diff) parts. */
const plain = (b) => ({ kind: b.kind, text: b.text });

/**
 * GET /document?diff=0|1 — права панель. diff=1 порівнює з baselineState (знімок після парсингу / створення).
 * @returns {{ revision, sections: { key, docNumber, title, blocks: { kind, text, parts? }[] }[] }}
 */
async function documentView(syllabusId, { diff = false } = {}) {
  const { syllabus, state, revision, refs } = await loadContext(syllabusId, { editable: false });
  const current = renderState(state, refs);
  if (diff && syllabus.baselineState) {
    return { revision, sections: diffRendered(renderState(syllabus.baselineState, refs), current).sections };
  }
  return { revision, sections: current.sections.map((s) => ({ ...s, blocks: s.blocks.map(plain) })) };
}

module.exports = {
  REBUILD_HINT,
  buildSuggestionView,
  suggestionViews,
  getConversationView,
  documentView,
  syllabusSummary,
  displayOf,
};
