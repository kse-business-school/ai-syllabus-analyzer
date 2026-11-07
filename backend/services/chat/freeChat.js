// Вільне повідомлення: хід оркестратора з інструментами (services/ai/tools/runner). Усі записи стану йдуть через
// deps (store.mutate, accept з перевірками); сам чат нічого не пише в стан.

const Message = require('../../models/Message');
const Suggestion = require('../../models/Suggestion');
const Conversation = require('../../models/Conversation');
const { httpError } = require('../../utils/httpError');
const runner = require('../ai/tools/runner');
const formulator = require('../ai/prompts/formulator');
const { NARRATIVE_SLOTS, referenceTexts } = require('../ai/slotDrafts');
const { candidates } = require('../ai/interviewPlan');
const { createDraftSuggestions } = require('./draftSuggestions');
const { loadContext } = require('./state');
const { acceptSuggestion, afterDecision } = require('./decisions');
const {
  getOrCreateConversation, postUserMessage, postAiMessage, postSuggestionCard, postNextStep, transcriptOf, withAiFailureTracking,
} = require('./flow');

const JUMP_RE = /^(?:(?:let['’]?s|can we|could we|please)\s+)?(?:work on|talk about|discuss|do|move to|go to|switch to|start with|ask me about|help me with)\s+(?:the\s+)?(.+?)(?:\s+(?:section|part))?(?:\s+(?:now|first|next))?\s*[.!?]?$/i;

/** Явний стрибок у розділ («Let's work on Assessment», «ask me about materials»): ключ розділу шаблону або null. */
function requestedSection(text, refs) {
  const match = String(text).trim().match(JUMP_RE);
  if (!match) return null;
  const label = match[1].trim().toLowerCase();
  const sections = refs.template || [];
  const exact = sections.find((s) => [s.key, s.title].some((v) => v.toLowerCase() === label));
  if (exact) return exact.key;
  // Коротка назва: «assessment», «policies», «capstone», «materials»
  const words = label.split(/\s+/).filter((w) => w.length >= 4);
  const partial = words.length ? sections.filter((s) => {
    const own = `${s.title} ${s.key.replace(/_/g, ' ')}`.toLowerCase();
    return words.every((w) => own.includes(w));
  }) : [];
  return partial.length === 1 ? partial[0].key : null;
}

/** Решту залежностей runner підставляє сам; Confirm використовує ті самі перевірки, що й HTTP-кнопка. */
function buildDeps(ctx, userId) {
  return {
    acceptSuggestion: (id, { expectedRevision, optionId } = {}) => acceptSuggestion(
      ctx.syllabus._id, id, { expectedRevision, optionId }, userId,
    ),
  };
}

async function freeChatMessage(syllabusId, text, userId) {
  const ctx = await loadContext(syllabusId);
  const conversation = await getOrCreateConversation(syllabusId, userId);
  await postUserMessage(conversation, text);

  const scratch = ctx.syllabus.track === 'scratch';
  const section = scratch && requestedSection(text, ctx.refs);
  if (section) {
    const keys = candidates({ ...ctx, state: {}, refs: ctx.refs }).filter((s) => s.section === section).map((s) => s.key);
    await Conversation.updateOne({ _id: conversation._id }, {
      $set: { currentSlotKey: null, preferredSection: section },
      $pull: { skippedSlots: { $in: [section, ...keys] }, answeredSlots: { $in: keys } },
    });
    if (section === 'policies' || candidates({ ...ctx, preferredSection: section }).some((s) => s.section === section)) {
      await postNextStep(await Conversation.findById(conversation._id));
      return;
    }
    // Для заповнених та A/B/E-розділів оркестратор показує наявне й обробляє пряму вказівку викладача.
    conversation.currentSlotKey = keys[0] || section;
  }

  // Серверні репліки від імені викладача («Confirmed: …») — не його слова: не потрапляють в історію ходу
  const messages = await Message.find({ conversationId: conversation._id, origin: { $ne: 'server' } }).sort({ createdAt: -1, _id: -1 }).limit(12).lean();
  const deps = buildDeps(ctx, userId);

  const result = await withAiFailureTracking(conversation, async () => {
    if (scratch && !section && NARRATIVE_SLOTS.includes(conversation.currentSlotKey)) {
      const { instructorLines } = await transcriptOf(conversation);
      const slotKeys = candidates({ ...ctx, skipped: conversation.skippedSlots }).map((s) => s.key).filter((k) => NARRATIVE_SLOTS.includes(k));
      // Одна розповідь → кілька чернеток (Description, Objectives, LO, Capstone), кожна — картка з proposedValues
      const drafts = slotKeys.length
        ? await formulator.draftFromNarrative({ state: ctx.state, refs: ctx.refs, narrative: text, slotKeys, transcript: instructorLines })
        : [];
      if (drafts.length) {
        const cards = [];
        for (const draft of drafts) {
          cards.push(...await createDraftSuggestions([{ ...draft, origin: 'interviewer' }], {
            syllabusId, state: ctx.state, refs: ctx.refs, known: [...instructorLines, ...referenceTexts(ctx.refs, draft.slotKey)],
          }));
        }
        return { reply: 'I have drafted these sections from your answer. Review and confirm each card to continue.',
          createdSuggestionIds: cards.map((c) => String(c._id)), answeredSlots: [...new Set(drafts.map((d) => d.slotKey))], sequential: true };
      }
    }
    const res = await runner.runOrchestratorTurn({
      syllabus: ctx.syllabus, state: ctx.state, revision: ctx.revision, refs: ctx.refs,
      conversation: conversation.toObject(), messages: messages.reverse(), userText: text, userId,
      currentSlotKey: conversation.currentSlotKey || null,
      deps,
    });
    if (!res || typeof res.reply !== 'string') throw httpError(502, 'The orchestrator returned no reply');
    return res;
  });

  const created = (result.createdSuggestionIds || []).map(String);
  if (result.reply.trim()) await postAiMessage(conversation, result.reply.trim());
  if (created.length) {
    const cards = await Suggestion.find({ _id: { $in: created }, syllabusId, status: 'pending' }).sort({ order: 1, _id: 1 });
    // Чернетки з однієї розповіді показуються по одній (решту покаже postNextStep після рішення)
    for (const card of result.sequential ? cards.slice(0, 1) : cards) await postSuggestionCard(conversation, card);
  }
  const answered = scratch && !section && (created.length || result.stateChanged);
  if (answered) {
    await Conversation.updateOne({ _id: conversation._id }, {
      $set: { currentSlotKey: null },
      $addToSet: { answeredSlots: { $each: [...(result.answeredSlots || []), conversation.currentSlotKey].filter(Boolean) } },
    });
  } else if (result.currentSlotKey !== undefined) {
    await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSlotKey: result.currentSlotKey || null } });
  } else if (created.length || result.stateChanged) {
    await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSlotKey: null } });
  }
  if (result.stateChanged || created.length) {
    await afterDecision(await Conversation.findById(conversation._id), { nextStep: false });
    if (result.stateChanged && !created.length) await postNextStep(await Conversation.findById(conversation._id));
  }
}

module.exports = { freeChatMessage, buildDeps, requestedSection };
