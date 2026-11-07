// Рішення викладача над картками v5 (docs/api-v5.md §5–§6): Confirm (accept), Change the value (values),
// Cancel (reject), Reword (refine), answer, reopen. Кожна зміна статусу — атомарний findOneAndUpdate з умовою
// на статус; стан силабусу змінює лише syllabusState/store.mutate (accept) і revertChange (reopen).
// Після рішення: прапорці stale, readiness-знімок у Conversation, наступна картка або питання.

const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const User = require('../../models/User');
const Syllabus = require('../../models/Syllabus');
const { claimOfferingForCode, courseCodeLockKey, reconcileCourseCode } = require('../offerings');
const locks = require('../locks');
const Suggestion = require('../../models/Suggestion');
const SlotChange = require('../../models/SlotChange');
const store = require('../syllabusState/store');
const { invalidateOutputs } = require('../outputs');
const { slotOfPath, getPath } = require('../syllabusState/paths');
const { httpError } = require('../../utils/httpError');
const { renderTemplate, toTemplate } = require('../ai/facts');
const formulator = require('../ai/prompts/formulator');
const { applyFieldValues, hasFieldPaths, NARRATIVE_SLOTS, ITEM_SLOTS } = require('../ai/slotDrafts');
const runner = require('../ai/tools/runner');
const { buildDraftSuggestion, hashValue, SOURCE_NOT_CONFIRMED } = require('./draftSuggestions');
const {
  loadContext, requiresReason, REJECT_TAGS, refreshConversationReadiness, refreshStale, markStale,
} = require('./state');
const { knownFor } = require('./known');
const { writeBackAccepted } = require('../lecturers/profile');
const { policyKeyOf, assertWritable, writeSlot, policyPatch, setPolicy, filled } = require('./slotWrite');
const {
  getOrCreateConversation, postNextStep, postUserMessage, postServerMessage, postAiMessage, postSuggestionCard, transcriptOf, withAiFailureTracking,
} = require('./flow');

async function loadSuggestion(syllabusId, suggestionId) {
  const s = await Suggestion.findOne({ _id: suggestionId, syllabusId });
  if (!s) throw httpError(404, 'Suggestion not found');
  return s;
}

const notPending = () => httpError(409, 'This suggestion has changed or has already been handled. Refresh the page.', { code: 'NOT_PENDING' });
const pendingFilter = (s) => ({ _id: s._id, syllabusId: s.syllabusId, status: 'pending', __v: s.__v });

async function context(syllabusId, suggestionId, userId) {
  const ctx = await loadContext(syllabusId);
  const suggestion = await loadSuggestion(syllabusId, suggestionId);
  const conversation = await getOrCreateConversation(syllabusId, userId);
  return { ...ctx, suggestion, conversation };
}

async function afterDecision(conversation, { card = null, nextStep = true } = {}) {
  invalidateOutputs(conversation.syllabusId);
  const { state } = await loadContext(conversation.syllabusId, { editable: false });
  await refreshStale(conversation.syllabusId, state);
  await Conversation.updateOne({ _id: conversation._id }, { $set: { lastDecisionAt: new Date() } });
  await refreshConversationReadiness(conversation.syllabusId);
  if (card) await postSuggestionCard(conversation, card);
  else if (nextStep) await postNextStep(conversation);
}

/** Знімок попереднього варіанта картки (versions) перед Reword / answer / values. */
function snapshot(s, extra = {}) {
  const plain = s.toObject ? s.toObject() : s;
  return {
    kind: plain.kind, title: plain.title, description: plain.description, question: plain.question, answer: plain.answer,
    applicable: plain.applicable, draft: plain.draft, ...extra, at: new Date(),
  };
}

// ---------- accept (Confirm) ----------

/** Що саме запишемо в стан: функція над копією стану + походження для SlotChange. Усі перевірки — до захоплення картки. */
function buildPlan(s, optionId, ctx) {
  const path = s.target.path;
  const { state, refs } = ctx;
  assertWritable(state, path);
  const policyKey = policyKeyOf(path);

  let option = null;
  if (s.kind === 'choice') {
    if (!optionId) throw httpError(400, 'optionId is required for this suggestion', { code: 'OPTION_REQUIRED' });
    option = (s.options || []).find((o) => o.id === optionId);
    if (!option) throw httpError(400, 'Unknown option', { code: 'UNKNOWN_OPTION' });
  } else if (!s.draft) {
    throw httpError(409, 'This suggestion has no draft to apply.', { code: 'NOT_APPLICABLE' });
  }

  const hasBasis = Boolean(s.draft?.basisHash);
  if (s.stale || (hasBasis && hashValue(getPath(state, path)) !== s.draft.basisHash)) {
    throw httpError(409, 'The text this draft was based on has changed. Reword the draft or cancel it.', { code: 'STALE_DRAFT' });
  }
  const unconfirmed = (s.draft?.proposedValues || []).filter((v) => !v.confirmed);
  if (unconfirmed.length) {
    throw httpError(409, 'Confirm the highlighted values before applying this draft.', {
      code: 'UNCONFIRMED_VALUES', details: { unconfirmed: unconfirmed.map((v) => v.id) },
    });
  }

  // Update не є порожнім профілем: лише відкриваємо розмову про поточні дані.
  if (path === 'instructors[]' && option?.value === null && option.writeBack === false) {
    return { source: 'instructor_directed', fn: (st) => st, focusInstructor: true, writeBack: false };
  }

  let source;
  let fn;
  if (policyKey) {
    const blockOf = (st) => (st.policies || []).find((p) => p.key === policyKey);
    let args;
    if (option?.optionKey) {
      args = { optionKey: option.optionKey };
    } else {
      const text = option ? (option.value ?? blockOf(state).text) : s.draft.value;
      if (typeof text !== 'string') throw httpError(409, 'There is no text to apply.', { code: 'NOT_APPLICABLE' });
      args = { text };
    }
    source = policyPatch(blockOf(state), args, refs).source;
    fn = (st) => setPolicy(st, policyKey, policyPatch(blockOf(st), args, refs));
  } else {
    if (option && option.value === undefined) throw httpError(409, 'This option has no value to apply.', { code: 'NOT_APPLICABLE' });
    const value = option ? option.value : s.draft.value;
    source = option ? 'instructor_directed' : (s.draft.source || 'ai_draft');
    fn = (st) => writeSlot(st, path, value, { source });
  }
  return {
    source,
    writeBack: option?.writeBack !== false,
    fn: (st) => {
      // Перевіряємо також копію, яку прочитав mutate: ревізія з іншої вкладки не обходить basisHash.
      assertWritable(st, path);
      if (hasBasis && hashValue(getPath(st, path)) !== s.draft.basisHash) {
        throw httpError(409, 'The value this draft was based on has changed.', { code: 'STALE_DRAFT' });
      }
      return fn(st);
    },
  };
}

/** Картки коду курсу (Confirm, Reopen) — під тим самим блокуванням, що й PUT /api/syllabus/:id (N05, N06). */
async function underCourseCodeLock(syllabusId, suggestionId, fn) {
  const s = await Suggestion.findOne({ _id: suggestionId, syllabusId }).select('target.path').lean();
  if (s?.target?.path !== 'header.courseCode') return fn(null);
  return locks.withLock(courseCodeLockKey(syllabusId), fn);
}

async function acceptSuggestion(syllabusId, suggestionId, opts = {}, userId) {
  return underCourseCodeLock(syllabusId, suggestionId, (lock) => acceptUnderLock(syllabusId, suggestionId, opts, userId, lock));
}

async function acceptUnderLock(syllabusId, suggestionId, { optionId = null, expectedRevision } = {}, userId, lock) {
  if (lock) await reconcileCourseCode(syllabusId); // R04: довершити незавершене узгодження перед новою прив'язкою
  const ctx = await context(syllabusId, suggestionId, userId);
  const { suggestion: s, conversation } = ctx;
  if (s.status !== 'pending') throw notPending();
  if (s.kind === 'question') throw httpError(409, 'Answer the question first.', { code: 'ANSWER_REQUIRED' });

  let plan = s.applicable === false ? null : buildPlan(s, optionId, ctx);
  if (plan) plan.fn(structuredClone(ctx.state)); // пробний прогін: некоректні шляхи/значення — до захоплення картки
  // Код курсу визначає призначення курс × набір: ті самі правила, що й у PUT /api/syllabus/:id (C01, C16)
  let claim = null;
  if (plan && s.target.path === 'header.courseCode') {
    const option = (s.options || []).find((o) => o.id === optionId);
    const value = option ? option.value : s.draft?.value;
    if (value != null && String(value).trim() !== String(ctx.state.header?.courseCode ?? '')) {
      const user = await User.findById(userId).select('role').lean();
      claim = await claimOfferingForCode(ctx.syllabus, value, { userId: String(userId), role: user?.role });
      const code = claim.courseCode;
      const writeCode = plan.fn;
      plan = { ...plan, fn: (st) => { const next = writeCode(st) || st; return { ...next, header: { ...next.header, courseCode: code } }; } };
    }
  }

  const claimed = await Suggestion.findOneAndUpdate(
    pendingFilter(s),
    { $set: { status: 'accepted', acceptedAt: new Date(), acceptedRevision: null, selectedOptionId: optionId || null, stale: false }, $inc: { __v: 1 } },
    { new: true },
  );
  const releaseClaim = async () => {
    if (claim && (!lock || await locks.isHeld(lock))) await claim.release();
  };
  if (!claimed) {
    await releaseClaim();
    throw notPending();
  }

  let acceptedState;
  try {
    if (plan) {
      const result = await store.mutate(syllabusId, expectedRevision ?? ctx.revision, plan.fn, {
        by: userId, source: plan.source, suggestionId: s._id, refs: ctx.refs,
      });
      acceptedState = result.state;
      await Suggestion.updateOne({ _id: s._id, status: 'accepted', __v: claimed.__v }, {
        $set: { acceptedRevision: result.changes.length ? result.revision : null },
      });
      await markStale(syllabusId, [s.target.path, ...result.changes.map((c) => c.path)], s._id);
    }
  } catch (err) {
    await Suggestion.updateOne({ _id: s._id, status: 'accepted', __v: claimed.__v }, {
      $set: { status: 'pending', selectedOptionId: s.selectedOptionId || null }, $unset: { acceptedAt: '' },
    });
    await releaseClaim();
    throw err;
  }
  if (claim && !claim.offering && s.target.path === 'header.courseCode') {
    // Без призначення код курсу силабуса оновлюється й у метаданих (як у PUT)
    await Syllabus.updateOne({ _id: syllabusId, offeringId: null }, { $set: { 'course.code': claim.courseCode } });
  }
  // Стан уже записаний: помилка зовнішньої системи не має повертати картку у pending.
  if (acceptedState && plan.writeBack) {
    try {
      await writeBackAccepted(ctx.syllabus.instructor, ctx.state.instructors?.[0], acceptedState.instructors?.[0]);
    } catch (err) {
      console.warn(`lecturer profile write-back failed for ${String(syllabusId)}: ${err.message}`);
    }
  }
  await Suggestion.updateOne({ _id: s._id }, { $push: { decisionHistory: { action: 'accepted', by: userId, optionId: optionId || undefined } } });
  await postServerMessage(conversation, `Confirmed: ${s.title}`, s._id);
  if (plan?.focusInstructor) {
    await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSlotKey: 'instructor.profile', currentSuggestionId: null } });
    await postAiMessage(conversation, 'What would you like to update in your instructor profile? Share your changes and I will prepare them for confirmation.');
    await afterDecision(conversation, { nextStep: false });
  } else {
    await afterDecision(conversation);
  }
  return claimed;
}

// ---------- values (Change the value) ----------

async function updateValues(syllabusId, suggestionId, { values }, userId) {
  const { suggestion: s, conversation } = await context(syllabusId, suggestionId, userId);
  if (s.status !== 'pending') throw notPending();
  if (s.kind !== 'edit' || !s.draft) throw httpError(409, 'This suggestion has no values to change.', { code: 'NOT_APPLICABLE' });

  const proposed = s.draft.proposedValues.map((v) => ({ id: v.id, label: v.label, value: v.value, path: v.path, confirmed: v.confirmed }));
  for (const patch of values) {
    const target = proposed.find((v) => v.id === patch.id);
    if (!target) throw httpError(400, `Unknown value: ${patch.id}`, { code: 'UNKNOWN_VALUE' });
    if (patch.value !== undefined) {
      if (!filled(patch.value)) throw httpError(400, 'A value cannot be empty', { code: 'EMPTY_VALUE' });
      target.value = String(patch.value).trim();
    }
    if (patch.confirmed !== undefined) target.confirmed = Boolean(patch.confirmed);
  }
  // Зберігаємо форму значення: списки сутностей і числа не повинні перетворюватися на рядок.
  const $set = { 'draft.proposedValues': proposed };
  const renderValue = (value) => {
    if (typeof value === 'string') return renderTemplate(toTemplate(value, s.draft.proposedValues), proposed);
    if (typeof value === 'number') {
      const rendered = Number(renderValue(String(value)));
      if (!Number.isFinite(rendered)) throw httpError(400, 'A numeric value must remain a number.', { code: 'INVALID_VALUE' });
      return rendered;
    }
    if (Array.isArray(value)) return value.map(renderValue);
    if (value && typeof value === 'object') {
      // Факти змінюємо лише в тексті, не в ідентифікаторах, посиланнях чи провенансі.
      return Object.fromEntries(Object.entries(value).map(([key, val]) => [key,
        ['text', 'citation', 'criteria', 'additional'].includes(key) ? renderValue(val) : val]));
    }
    return value;
  };
  if (hasFieldPaths(s.draft.proposedValues)) {
    // Чернетка списку сутностей: значення змінюється в полі сутності, шаблон картки лишається
    const applied = applyFieldValues(s.draft.value, s.draft.proposedValues, proposed);
    if (applied.error) throw httpError(400, applied.error, { code: 'INVALID_VALUE' });
    $set['draft.value'] = applied.value;
  } else {
    $set['draft.value'] = typeof s.draft.value === 'string' && s.draft.template
      ? renderTemplate(s.draft.template, proposed) : renderValue(s.draft.value);
  }

  const updated = await Suggestion.findOneAndUpdate(
    pendingFilter(s),
    { $set, $inc: { __v: 1 }, $push: { versions: snapshot(s, { action: 'values' }), decisionHistory: { action: 'values', by: userId } } },
    { new: true },
  );
  if (!updated) throw notPending();
  await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSuggestionId: s._id } });
  await afterDecision(conversation, { nextStep: false });
  return updated;
}

// ---------- reject (Cancel) ----------

async function rejectSuggestion(syllabusId, suggestionId, { reason, rejectTag } = {}, userId) {
  const { suggestion: s, conversation } = await context(syllabusId, suggestionId, userId);
  if (s.status !== 'pending') throw notPending();
  const text = (reason || '').trim();
  if (requiresReason(s) && !text) {
    throw httpError(400, 'A reason is required to cancel a critical or high-severity suggestion.', { code: 'REASON_REQUIRED' });
  }
  if (rejectTag && !REJECT_TAGS.includes(rejectTag)) throw httpError(400, 'Unknown reason category');

  const updated = await Suggestion.findOneAndUpdate(
    pendingFilter(s),
    {
      $inc: { __v: 1 },
      $set: { status: 'rejected', decisionReason: text || null, rejectTag: rejectTag || (text ? 'other' : null) },
      $push: { decisionHistory: { action: 'rejected', by: userId, reason: text || undefined, rejectTag: rejectTag || undefined } },
    },
    { new: true },
  );
  if (!updated) throw notPending();
  await postServerMessage(conversation, `Cancelled: ${s.title}${text ? ` — ${text}` : ''}`, s._id);
  await afterDecision(conversation);
  return updated;
}

// ---------- refine (Reword) ----------

/**
 * Чернетка з відповіді моделі (Reword / answer) + опис картки: вигадані URL вирізає buildDraftSuggestion,
 * а позначка «Source not confirmed» додається до опису (без повторів після кількох Reword).
 */
function draftFromModel(s, out, ctx, known) {
  const description = String(out.description || s.description || '').split(`\n\n${SOURCE_NOT_CONFIRMED}`).join('').split(SOURCE_NOT_CONFIRMED).join('').trim();
  const built = buildDraftSuggestion({
    origin: s.origin || 'orchestrator',
    severity: s.severity,
    kind: 'edit',
    description,
    target: { section: s.target.section, path: s.target.path, entityId: s.target.entityId },
    text: typeof out.text === 'string' ? out.text : undefined,
    value: out.value,
    proposedValues: out.proposedValues,
    sources: s.sources,
  }, { syllabusId: s.syllabusId, state: ctx.state, refs: ctx.refs, known });
  return { draft: built.draft, description: built.description };
}

const hasDraftText = (out) => out && (typeof out.text === 'string' || out.value !== undefined);

async function refineSuggestion(syllabusId, suggestionId, { feedback }, userId, { postFeedback = true } = {}) {
  const ctx = await context(syllabusId, suggestionId, userId);
  const { suggestion: s, conversation } = ctx;
  if (s.status !== 'pending') throw notPending();
  if (s.kind !== 'edit' || !s.draft) {
    throw httpError(409, s.kind === 'question' ? 'Answer the question instead.' : 'Only drafts can be reworded.', { code: 'NOT_APPLICABLE' });
  }
  assertWritable(ctx.state, s.target.path);
  const text = (feedback || '').trim();
  if (!text) throw httpError(400, 'Tell me what to change', { code: 'FEEDBACK_REQUIRED' });

  // C11: списки сутностей і профіль чернеткує не формулювальник, а ті самі інструменти propose_items / propose_instructor
  const slotKey = slotOfPath(s.target.path)?.key;
  if (ITEM_SLOTS[slotKey] || slotKey === 'instructor.profile') return refineViaOrchestrator(ctx, text, userId, slotKey, { postFeedback });

  const { transcript, instructorLines } = await transcriptOf(conversation);
  const out = await withAiFailureTracking(conversation, async () => {
    const res = await formulator.reword({
      suggestion: s.toObject(), feedback: text, state: ctx.state, refs: ctx.refs, transcript,
    });
    if (!hasDraftText(res)) throw new Error('Formulator returned no draft');
    return res;
  });

  const { draft, description } = draftFromModel(s, out, ctx, knownFor(s, ctx, instructorLines, [text]));
  const set = { draft, stale: false, description };
  if (out.rationale) set.rationale = out.rationale;
  if (out.title) set.title = out.title;
  const updated = await Suggestion.findOneAndUpdate(
    pendingFilter(s),
    { $set: set, $inc: { __v: 1 }, $push: { versions: snapshot(s, { action: 'refined', feedback: text }), decisionHistory: { action: 'refined', by: userId, feedback: text } } },
    { new: true },
  );
  if (!updated) throw notPending();
  if (postFeedback) await postUserMessage(conversation, text, s._id);
  await postAiMessage(conversation, 'Here is the reworded draft. Check it and confirm when it looks right.', s._id);
  await postSuggestionCard(conversation, updated);
  await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSlotKey: null } });
  await afterDecision(conversation, { nextStep: false });
  return updated;
}

/**
 * Reword чернетки списку чи профілю: хід оркестратора з поточною чернеткою й відгуком; нова чернетка
 * (з proposedValues полів, які перевіряє сервер) замінює чернетку цієї картки, окрема картка ходу видаляється.
 */
async function refineViaOrchestrator(ctx, text, userId, slotKey, { postFeedback }) {
  const { suggestion: s, conversation } = ctx;
  if (postFeedback) await postUserMessage(conversation, text, s._id);
  const { reply, created, draftCard } = await cardTurn(ctx, text, userId, slotKey, {
    mode: 'reword', feedback: text, draft: s.draft?.value ?? null,
  });
  if (!draftCard) {
    await postAiMessage(conversation, reply || 'I could not change the draft that way. Could you say what exactly to change?', s._id);
    for (const card of created) await postSuggestionCard(conversation, card);
    await afterDecision(conversation, { nextStep: false });
    return Suggestion.findById(s._id);
  }
  const d = draftCard.toObject();
  const updated = await Suggestion.findOneAndUpdate(
    pendingFilter(s),
    {
      $inc: { __v: 1 },
      $set: { draft: d.draft, target: d.target, section: d.section, stale: false, ...(d.description ? { description: d.description } : {}) },
      $push: { versions: snapshot(s, { action: 'refined', feedback: text }), decisionHistory: { action: 'refined', by: userId, feedback: text } },
    },
    { new: true },
  );
  if (!updated) throw notPending();
  await Suggestion.deleteOne({ _id: draftCard._id });
  await postAiMessage(conversation, reply || 'Here is the reworded draft. Check it and confirm when it looks right.', s._id);
  await postSuggestionCard(conversation, updated);
  await afterDecision(conversation, { nextStep: false });
  return updated;
}

// ---------- answer ----------

async function answerSuggestion(syllabusId, suggestionId, { answer }, userId) {
  const ctx = await context(syllabusId, suggestionId, userId);
  const { suggestion: s, conversation } = ctx;
  if (s.status !== 'pending') throw notPending();
  if (s.kind !== 'question') throw httpError(409, 'This suggestion is not a question.', { code: 'NOT_A_QUESTION' });
  assertWritable(ctx.state, s.target.path);
  const text = (answer || '').trim();
  if (!text) throw httpError(400, 'Answer cannot be empty', { code: 'ANSWER_EMPTY' });

  // Маршрут за типом цілі (аудит A03): політика → вибір; наративні D-слоти → формулювальник;
  // решта (скаляри, поля й списки сутностей, профіль) → хід оркестратора з тими самими інструментами й правилами
  if (policyKeyOf(s.target.path)) return answerPolicyQuestion(ctx, text, userId);
  const slotKey = slotOfPath(s.target.path)?.key || s.target.section;
  if (!NARRATIVE_SLOTS.includes(slotKey)) return answerViaOrchestrator(ctx, text, userId, slotKey);

  const { transcript, instructorLines } = await transcriptOf(conversation);
  const drafts = await withAiFailureTracking(conversation, () => formulator.draftFromNarrative({
    state: ctx.state, refs: ctx.refs, narrative: text, slotKeys: [slotKey], transcript,
  }));
  const pick = (drafts || []).find((d) => d.target?.path === s.target.path) || (drafts || []).find((d) => d.slotKey === slotKey) || (drafts || [])[0];

  await postUserMessage(conversation, text, s._id);
  if (!hasDraftText(pick)) {
    // Модель не склала чернетку: картка лишається питанням, відповідь зберігаємо для контексту
    const updated = await Suggestion.findOneAndUpdate(pendingFilter(s), {
      $set: { answer: text }, $inc: { __v: 1 }, $push: { versions: snapshot(s, { action: 'answered' }), decisionHistory: { action: 'answered', by: userId } },
    });
    if (!updated) throw notPending();
    await postAiMessage(conversation, 'I could not turn that into a draft yet. Could you add a few more details?', s._id);
    await afterDecision(conversation, { nextStep: false });
    return Suggestion.findById(s._id);
  }
  const { draft, description } = draftFromModel(s, { ...pick, description: undefined }, ctx, knownFor(s, ctx, instructorLines, [text]));
  const updated = await Suggestion.findOneAndUpdate(
    { ...pendingFilter(s), kind: 'question' },
    {
      $inc: { __v: 1 },
      $set: { kind: 'edit', draft, description, answer: text, stale: false, ...(pick.rationale ? { rationale: pick.rationale } : {}) },
      $push: { versions: snapshot(s, { action: 'answered' }), decisionHistory: { action: 'answered', by: userId } },
    },
    { new: true },
  );
  if (!updated) throw notPending();
  await postAiMessage(conversation, 'Thanks! Here is a draft based on your answer. Check it and confirm when it looks right.', s._id);
  await postSuggestionCard(conversation, updated);
  await afterDecision(conversation, { nextStep: false });
  return updated;
}

/**
 * Відповідь на питання про політику: AI текст політики не пише. Картка стає вибором — дослівна відповідь викладача
 * (instructor_directed) або варіант довідника; дефолту немає.
 */
async function answerPolicyQuestion(ctx, text, userId) {
  const { suggestion: s, conversation } = ctx;
  const key = policyKeyOf(s.target.path);
  const block = (ctx.refs?.policyLibrary?.blocks || []).find((b) => b.key === key);
  const options = [
    { id: 'answer', label: 'Use my answer as the policy text', value: text },
    ...(block?.options || []).map((o) => ({ id: `opt_${o.key}`, label: o.label, optionKey: o.key })),
  ];
  await postUserMessage(conversation, text, s._id);
  const updated = await Suggestion.findOneAndUpdate(
    { ...pendingFilter(s), kind: 'question' },
    {
      $inc: { __v: 1 },
      $set: { kind: 'choice', options, answer: text, stale: false },
      $push: { versions: snapshot(s, { action: 'answered' }), decisionHistory: { action: 'answered', by: userId } },
    },
    { new: true },
  );
  if (!updated) throw notPending();
  await postAiMessage(conversation, 'Choose whether to use your answer as the policy text or a standard option.', s._id);
  await postSuggestionCard(conversation, updated);
  await afterDecision(conversation, { nextStep: false });
  return updated;
}

/**
 * Відповідь на питання про скаляр, поле чи список сутностей, профіль: хід оркестратора з контекстом картки.
 * Чернетка, яку створив хід, переноситься в саму картку-питання (question → edit), окремий дубль видаляється;
 * якщо значення записано напряму (set_slot) — питання закрите як accepted; інакше лишається питанням з відповіддю.
 */
/**
 * Хід оркестратора в контексті картки (відповідь на питання або Reword структурованої чернетки).
 * apply_edit тут не потрібен: deps.acceptSuggestion не передаємо (NOT_CONFIGURED).
 * @returns {{ reply, created: Suggestion[], draftCard: Suggestion|null, stateChanged: boolean }}
 */
async function cardTurn(ctx, text, userId, slotKey, cardContext) {
  const { suggestion: s, conversation } = ctx;
  const messages = await Message.find({ conversationId: conversation._id, origin: { $ne: 'server' } })
    .sort({ createdAt: -1, _id: -1 }).limit(12).lean();
  const result = await withAiFailureTracking(conversation, async () => {
    const res = await runner.runOrchestratorTurn({
      syllabus: ctx.syllabus, state: ctx.state, revision: ctx.revision, refs: ctx.refs,
      conversation: { ...conversation.toObject(), currentSuggestionId: null, writeOwnPolicyKey: null, currentSlotKey: slotKey },
      messages: messages.reverse(), userText: text, userId, currentSlotKey: slotKey,
      cardContext: { slotKey, path: s.target.path, entityId: s.target.entityId || null, current: getPath(ctx.state, s.target.path), ...cardContext },
      deps: {},
    });
    if (!res || typeof res.reply !== 'string') throw httpError(502, 'The orchestrator returned no reply');
    return res;
  });
  const created = await Suggestion.find({ _id: { $in: (result.createdSuggestionIds || []).map(String) }, syllabusId: s.syllabusId, status: 'pending' })
    .sort({ order: 1, _id: 1 });
  const drafts = created.filter((c) => c.kind === 'edit' && c.draft);
  return {
    reply: result.reply.trim(), created, stateChanged: Boolean(result.stateChanged),
    draftCard: drafts.find((c) => c.section === s.section) || drafts[0] || null,
  };
}

async function answerViaOrchestrator(ctx, text, userId, slotKey) {
  const { suggestion: s, conversation } = ctx;
  await postUserMessage(conversation, text, s._id);
  const { reply, created, draftCard, stateChanged } = await cardTurn(ctx, text, userId, slotKey, { question: s.question || s.description });
  const result = { stateChanged };
  const history = { versions: snapshot(s, { action: 'answered' }), decisionHistory: { action: 'answered', by: userId } };

  if (draftCard) {
    const d = draftCard.toObject();
    const updated = await Suggestion.findOneAndUpdate(
      { ...pendingFilter(s), kind: 'question' },
      {
        $inc: { __v: 1 },
        $set: {
          kind: 'edit', draft: d.draft, target: d.target, section: d.section, description: d.description || s.description,
          answer: text, stale: false, ...(d.rationale ? { rationale: d.rationale } : {}),
        },
        $push: history,
      },
      { new: true },
    );
    if (!updated) throw notPending();
    await Suggestion.deleteOne({ _id: draftCard._id });
    if (reply) await postAiMessage(conversation, reply, s._id);
    await postSuggestionCard(conversation, updated);
    await afterDecision(conversation, { nextStep: false });
    return updated;
  }

  if (result.stateChanged) {
    const updated = await Suggestion.findOneAndUpdate(pendingFilter(s), {
      $inc: { __v: 1 }, $set: { status: 'accepted', acceptedAt: new Date(), answer: text, stale: false }, $push: history,
    }, { new: true });
    if (!updated) throw notPending();
    if (reply) await postAiMessage(conversation, reply, s._id);
    await afterDecision(conversation);
    return updated;
  }

  const updated = await Suggestion.findOneAndUpdate(pendingFilter(s), { $set: { answer: text }, $inc: { __v: 1 }, $push: history }, { new: true });
  if (!updated) throw notPending();
  await postAiMessage(conversation, reply || 'I could not turn that into a draft yet. Could you add a few more details?', s._id);
  for (const card of created) await postSuggestionCard(conversation, card);
  await afterDecision(conversation, { nextStep: false });
  return updated;
}

// ---------- reopen ----------

/** Зміни стану останнього прийняття картки (усі шляхи однієї ревізії; reopen-записи пропускаються). */
async function lastAcceptChanges(syllabusId, suggestion) {
  if (suggestion.acceptedRevision == null) return [];
  return SlotChange.find({ syllabusId, suggestionId: suggestion._id, revision: suggestion.acceptedRevision, source: { $ne: 'reopen' } }).lean();
}

async function reopenSuggestion(syllabusId, suggestionId, userId) {
  return underCourseCodeLock(syllabusId, suggestionId, () => reopenUnderLock(syllabusId, suggestionId, userId));
}

async function reopenUnderLock(syllabusId, suggestionId, userId) {
  const ctx = await context(syllabusId, suggestionId, userId);
  const { suggestion: s, conversation } = ctx;
  if (s.status === 'pending') {
    // R04: повтор Reopen картки коду довершує узгодження метаданих, якщо минулого разу воно не вдалося
    if (s.target.path === 'header.courseCode' && await reconcileCourseCode(syllabusId)) return s;
    throw httpError(409, 'This suggestion is already open.', { code: 'NOT_DECIDED' });
  }

  const changes = s.status === 'accepted' ? await lastAcceptChanges(syllabusId, s) : [];
  const claimed = await Suggestion.findOneAndUpdate(
    { _id: s._id, syllabusId, status: s.status, __v: s.__v },
    {
      $inc: { __v: 1 },
      $set: { status: 'pending', selectedOptionId: null, decisionReason: null, rejectTag: null },
      $unset: { acceptedAt: '' },
      $push: { decisionHistory: { action: 'reopened', by: userId } },
    },
    { new: true },
  );
  if (!claimed) throw notPending();

  if (changes.length) {
    try {
      await store.revertChange(syllabusId, changes, { by: userId, suggestionId: s._id, refs: ctx.refs });
    } catch (err) {
      await Suggestion.updateOne({ _id: s._id, status: 'pending' }, {
        $set: { status: s.status, selectedOptionId: s.selectedOptionId, decisionReason: s.decisionReason, rejectTag: s.rejectTag, acceptedAt: s.acceptedAt },
        $pop: { decisionHistory: 1 },
      });
      throw err;
    }
    // N06: відкат коду курсу відкочує й прив'язку — метадані й offeringId узгоджуються з кодом у стані.
    // R04: збій узгодження — 503 retryable; повтор Reopen (або наступна дія з карткою коду) довершує його
    if (s.target.path === 'header.courseCode') {
      try {
        await reconcileCourseCode(syllabusId);
      } catch (err) {
        console.warn(`course code reconcile after reopen failed for ${String(syllabusId)}: ${err.message}`);
        throw httpError(503, 'The section was reopened, but the course assignment is not updated yet. Press Reopen again to finish.', { code: 'RECONCILE_INCOMPLETE', retryable: true });
      }
    }
  }
  await postServerMessage(conversation, `Back to: ${s.title}`, s._id);
  await afterDecision(conversation, { card: claimed });
  return claimed;
}

module.exports = {
  acceptSuggestion, updateValues, rejectSuggestion, refineSuggestion, answerSuggestion, reopenSuggestion, afterDecision,
};
