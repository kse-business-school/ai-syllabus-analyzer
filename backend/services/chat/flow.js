// Потік розмови v5: створення з привітанням (трек 1 — питання, трек 2 — «Here's what I found…»),
// «наступний крок» після кожного рішення (картка або питання інтерв'юера), skip, лічильник збоїв AI.

const { sectionTitle, sectionQuestion, phrases } = require('../references/sectionText');
const Conversation = require('../../models/Conversation');
const Message = require('../../models/Message');
const Suggestion = require('../../models/Suggestion');
const { httpError } = require('../../utils/httpError');
const interviewer = require('../ai/prompts/interviewer');
const { loadContext, buildReadiness, refreshConversationReadiness, BLOCKING_SEVERITIES } = require('./state');
const { approvableSections } = require('./sections');
const { policyDecided, SLOTS } = require('../syllabusState/slots');
const { candidates, templateQuestion } = require('../ai/interviewPlan');
const { NARRATIVE_SLOTS } = require('../ai/slotDrafts');
const { createDraftSuggestions } = require('./draftSuggestions');
const { runChecks } = require('../checks');

const MAX_CONSECUTIVE_FAILURES = 3;
const TRANSCRIPT_LIMIT = 12;
const DONE_TEXT = 'That is everything I can ask about for now. Review the sections on the left, approve them, and download the .docx whenever you like.';

async function nextPending(syllabusId) {
  return Suggestion.findOne({ syllabusId, status: 'pending' }).sort({ order: 1, _id: 1 });
}

async function say(conversation, fields) {
  return Message.create({ conversationId: conversation._id, role: 'ai', kind: 'text', ...fields });
}

const postAiMessage = (conversation, content, suggestionId = null) => say(conversation, { content, relatedSuggestionId: suggestionId });

/** Репліка самого викладача (вільне повідомлення, відгук Reword, відповідь). */
const postUserMessage = (conversation, content, suggestionId = null) => Message.create({
  conversationId: conversation._id, role: 'user', origin: 'instructor', kind: 'text', content, relatedSuggestionId: suggestionId,
});

/**
 * Репліка, яку сервер пише від імені викладача після натискання кнопки («Confirmed: …», «Cancelled: …», «Back to: …», «Skip: …»).
 * origin: 'server' — її не бачать транскрипти для LLM: заголовок картки написала модель, це не слова викладача.
 */
const postServerMessage = (conversation, content, suggestionId = null) => Message.create({
  conversationId: conversation._id, role: 'user', origin: 'server', kind: 'text', content, relatedSuggestionId: suggestionId,
});

/** Повідомлення-картка для пропозиції (вміст будується на льоту з Suggestion). */
async function postSuggestionCard(conversation, suggestion) {
  await say(conversation, { kind: 'suggestion', content: suggestion.title, relatedSuggestionId: suggestion._id });
  await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSuggestionId: suggestion._id } });
}

const lastMessage = (conversation, kinds) => Message.findOne({ conversationId: conversation._id, ...(kinds ? { kind: { $in: kinds } } : {}) })
  .sort({ createdAt: -1, _id: -1 });

/**
 * Репліки розмови для промптів: transcript (останні) і лише слова викладача (для сканера фактів).
 * Серверні репліки від імені викладача (origin: 'server') виключено: вони не є ні фактами, ні вказівками.
 */
async function transcriptOf(conversation, limit = TRANSCRIPT_LIMIT) {
  const rows = (await Message.find({ conversationId: conversation._id, kind: { $in: ['text', 'question'] }, origin: { $ne: 'server' } })
    .sort({ createdAt: -1, _id: -1 }).limit(limit).lean()).reverse();
  return {
    transcript: rows.map((m) => `${m.role === 'user' ? 'Instructor' : 'Assistant'}: ${m.content}`),
    instructorLines: rows.filter((m) => m.role === 'user').map((m) => m.content),
  };
}

// ---------- Привітання ----------

function scratchGreeting(syllabus) {
  return `Hi! I'll help you build the syllabus for "${syllabus.title}" step by step. I'll ask one question at a time; you can skip any of them and come back later. You can download the .docx at any moment.`;
}

function uploadGreeting(ctx, readiness, checks) {
  const sections = ctx.refs.template.filter((t) => readiness.sections[t.key]);
  const empty = sections.filter((t) => readiness.sections[t.key].status === 'empty');
  const lines = [
    `Here's what I found in your file: ${sections.length - empty.length} of ${sections.length} sections have content`
      + (empty.length ? `, and ${empty.length} ${empty.length > 1 ? 'are' : 'is'} still empty (${empty.map((t) => t.title).join(', ')}).` : '.'),
  ];
  const main = checks.filter((c) => c.passed === false && BLOCKING_SEVERITIES.includes(c.severity)).slice(0, 3);
  if (main.length) lines.push(`Main issues: ${main.map((c) => c.message).join(' ')}`);
  else lines.push('I found no critical issues.');
  return lines.join(' ');
}

// ---------- Питання інтерв'юера ----------

/** Політики — не питання інтерв'юера, а картки policy-choice: перший невирішений library-блок. */
function policyQuestion(ctx, skipped) {
  if (skipped.includes('policies')) return null;
  const p = (ctx.state.policies || []).find((x) => x.mode === 'library' && !policyDecided(x) && !skipped.includes(x.key));
  if (!p) return null;
  const title = (ctx.refs.policyLibrary?.blocks || []).find((b) => b.key === p.key)?.title || p.key;
  return { slotKey: p.key, policyKey: p.key, question: `Which option fits your course for "${title}"?`, why: `The policy "${title}" has no decision yet.` };
}

/** Запасне питання треку 2 (інтерв'юер лише для треку 1): TemplateSection першого порожнього, потім неповного розділу. */
function fallbackQuestion(ctx, readiness, skipped) {
  const status = (t) => readiness.sections[t.key]?.status;
  const language = ctx.state?.language;
  const say = phrases(language);
  const ask = (t) => {
    if (t.key === 'policies') return policyQuestion(ctx, skipped);
    const title = sectionTitle(t, language);
    return {
      slotKey: t.key,
      question: sectionQuestion(t, language),
      why: status(t) === 'empty' ? say.empty(title) : say.incomplete(title),
    };
  };
  const open = (t) => (t.question || t.key === 'policies') && !skipped.includes(t.key) && !readiness.sections[t.key]?.approved;
  const candidates = [
    ...ctx.refs.template.filter((t) => open(t) && status(t) === 'empty'),
    ...ctx.refs.template.filter((t) => open(t) && status(t) !== 'empty' && !readiness.sections[t.key]?.complete),
  ];
  for (const t of candidates) {
    const q = ask(t);
    if (q) return q;
  }
  return null;
}

const GLANCE_BLOCK = 'glance.block';

/** «Next: <розділ>» мовою документа для питання за слотом. */
function sectionLabelOf(ctx, slotKey) {
  const slot = SLOTS.find((x) => x.key === slotKey);
  const key = slot?.section || (slotKey === GLANCE_BLOCK ? 'at_a_glance' : slotKey.startsWith('policy.') ? 'policies' : null);
  const section = key && (ctx.refs?.template || []).find((t) => t.key === key);
  if (!section) return null;
  const uk = ctx.state?.language === 'uk';
  return `${uk ? 'Далі' : 'Next'}: ${sectionTitle(section, ctx.state?.language)}`;
}

/** Питання блоку At a Glance — лише поки його не відповіли й не пропустили і бракує формату чи кредитів. */
function glanceQuestion(ctx, done) {
  if (done.includes(GLANCE_BLOCK) || done.includes('at_a_glance')) return null;
  if (!(ctx.refs?.template || []).some((t) => t.key === 'at_a_glance')) return null;
  const h = ctx.state?.header || {};
  if (h.deliveryFormat && h.ects != null) return null;
  const uk = ctx.state?.language === 'uk';
  const blocks = (ctx.refs?.programBlocks || []).length;
  return {
    slotKey: GLANCE_BLOCK,
    question: uk
      ? `Почнімо з основного: коли триває курс, формат (офлайн чи онлайн), кількість кредитів і годин, мова викладання${blocks ? ' і до якого блоку програми належить курс' : ''}?`
      : 'Let\'s start with the basics: when does the course run, is it offline or online, how many credits and hours does it have, and in which language is it taught?',
    why: uk ? 'Ці дані потрапляють у таблицю «Дані про курс». Можна відповісти одним повідомленням або пропустити.' : 'These go into the At a Glance table. Answer in one message, or skip for now.',
  };
}

/**
 * Наступне питання. Трек 1: інтерв'юер (LLM обирає серед слотів, відібраних кодом; збій → шаблонне питання).
 * Трек 2: інтерв'юера немає — детерміновані питання TemplateSection (поведінка не змінена).
 */
async function pickQuestion(conversation, ctx) {
  const skipped = conversation.skippedSlots || [];
  if (ctx.syllabus.track !== 'scratch') {
    const { readiness } = await buildReadiness(ctx);
    return fallbackQuestion(ctx, readiness, skipped);
  }
  // B-3.6: інтерв'ю починається з короткого блоку At a Glance (кілька полів одним питанням); пропуск дозволено
  const glance = glanceQuestion(ctx, [...skipped, ...(conversation.answeredSlots || [])]);
  if (glance) return glance;
  // Відповідь на розповідь про курс закриває всі її слоти: Cancel/Reject чернетки не запускає те саме інтерв'ю знову
  const input = { state: ctx.state, refs: ctx.refs, skipped: [...skipped, ...(conversation.answeredSlots || [])], preferredSection: conversation.preferredSection };
  const allowed = candidates(input);
  if (!allowed.length) return null;
  let q;
  try {
    const { transcript } = await transcriptOf(conversation);
    q = await interviewer.nextQuestion({ ...input, transcript });
  } catch (err) {
    console.error('interviewer failed, using the template question:', err.message);
  }
  // Слот обирає лише з дозволених кодом; усе інше (збій, чужий слот) — детермінований наступний слот
  if (!q || !q.question || !allowed.some((s) => s.key === q.slotKey)) return templateQuestion(allowed[0], ctx.refs, ctx.state?.language);
  return q;
}

/** Похідні поради треку 1: лише картки, жодного додаткового питання чи запису стану. */
async function scratchSuggestions(conversation, ctx) {
  const loMapping = require('../ai/prompts/loMapping');
  const readings = require('../ai/prompts/readings');
  const existing = await Suggestion.find({ syllabusId: conversation.syllabusId }).select('target.path').lean();
  const missing = (path) => !existing.some((s) => s.target?.path === path);
  const skipped = [...conversation.skippedSlots, ...conversation.answeredSlots];
  let inputs = [];
  if (!skipped.includes('course.outcomes_plo') && !skipped.includes('learning_outcomes')) {
    const outcomeIds = (ctx.state.outcomes || []).filter((o) => o.text && !o.plo?.length && missing(`outcomes[${o.id}].plo`)).map((o) => o.id);
    if (outcomeIds.length) inputs = await loMapping.suggestPlo({ state: ctx.state, refs: ctx.refs, outcomeIds });
  }
  if (!inputs.length && ctx.state.materials?.required?.length && missing('materials.recommended[]')
      && !skipped.includes('materials.recommended') && !skipped.includes('materials')) {
    inputs = await readings.suggestReadings({ state: ctx.state, refs: ctx.refs,
      query: `${ctx.state.header.courseTitle}: ${ctx.state.summary.shortDescription.text || ''}` });
    await Conversation.updateOne({ _id: conversation._id }, { $addToSet: { answeredSlots: 'materials.recommended' } });
  }
  const { instructorLines } = await transcriptOf(conversation);
  return createDraftSuggestions(inputs.map((i) => ({ ...i, origin: 'interviewer' })), {
    syllabusId: conversation.syllabusId, state: ctx.state, refs: ctx.refs, known: instructorLines,
  });
}

/**
 * Наступний крок розмови: найвища pending-картка (за order), інакше питання інтерв'юера, інакше підсумок.
 * Не дублює картку/питання, які вже є останніми в чаті.
 * @returns {Promise<{ suggestion?: object, question?: object }|null>}
 */
async function postNextStep(conversation, { preferQuestion = false } = {}) {
  const ctx = await loadContext(conversation.syllabusId);
  const scratch = ctx.syllabus.track === 'scratch';
  const next = preferQuestion && !scratch ? null : await nextPending(conversation.syllabusId);
  if (next) {
    const lastCard = await lastMessage(conversation, ['suggestion', 'question']);
    if (lastCard && lastCard.kind === 'suggestion' && String(lastCard.relatedSuggestionId) === String(next._id)) {
      await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSuggestionId: next._id } });
    } else {
      await postSuggestionCard(conversation, next);
    }
    return { suggestion: next };
  }

  await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSuggestionId: null } });
  const fresh = await Conversation.findById(conversation._id);
  // currentSlotKey знімається тільки відповіддю, Skip або явною зміною розділу, а не рішенням сторонньої картки.
  if (scratch && fresh.currentSlotKey) return null;
  if (scratch) {
    try {
      const cards = await scratchSuggestions(fresh, ctx);
      if (cards.length) {
        // Картки йдуть по одній, як у треку 2: решту покаже postNextStep після рішення
        await postSuggestionCard(conversation, cards[0]);
        return { suggestion: cards[0] };
      }
    } catch (err) {
      // Допоміжний збій після Confirm не скасовує вже збережене рішення викладача.
      console.error('Interview suggestions failed:', err.message);
    }
  }
  let q = scratch && fresh.preferredSection === 'policies' ? policyQuestion(ctx, fresh.skippedSlots) : await pickQuestion(fresh, ctx);
  if (!q && scratch) q = policyQuestion(ctx, fresh.skippedSlots);
  const last = await lastMessage(conversation);
  if (!q) {
    if (!(last && last.role === 'ai' && last.content.endsWith(DONE_TEXT))) {
      const checks = scratch ? runChecks(ctx.state, ctx.refs).filter((c) => c.passed === false) : [];
      const review = checks.length ? `Checks found ${checks.length} open items. ${checks.slice(0, 3).map((c) => c.message).join(' ')}\n\n` : '';
      await postAiMessage(conversation, `${review}${DONE_TEXT}`);
    }
    await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSlotKey: null } });
    return null;
  }
  // Двох питань поспіль не буває (код, а не лише промпт): попереднє питання без дії викладача лишається поточним
  const open = unansweredQuestion(last, fresh);
  if (open && open.payload.slotKey !== q.slotKey) {
    await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSlotKey: open.payload.slotKey, preferredSection: null, writeOwnPolicyKey: null } });
    return { question: open.payload };
  }
  const policyKey = q.policyKey || (q.slotKey.startsWith('policy.') ? q.slotKey : null);
  const kind = policyKey ? 'policy-choice' : 'question';
  const repeated = last && last.kind === kind && last.payload?.slotKey === q.slotKey;
  if (!repeated) {
    // B-4.3: перехід до іншого розділу асистент називає («Next: Schedule» / «Далі: Розклад»)
    const nextSection = sectionLabelOf(ctx, q.slotKey);
    await say(conversation, {
      kind, content: q.question,
      payload: { slotKey: q.slotKey, ...(policyKey ? { policyKey } : {}), question: q.question, why: q.why || '', ...(nextSection ? { nextSection } : {}) },
    });
  }
  // Питання-вибір політики не дозволяє моделі писати текст політики: це робить лише «Write my own» (writeOwnPolicyKey)
  await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSlotKey: q.slotKey, preferredSection: null, writeOwnPolicyKey: null } });
  return { question: q };
}

/**
 * Останнє повідомлення — питання AI, на яке викладач ще нічого не зробив: ні репліки, ні рішення (lastDecisionAt),
 * ні Skip цього слота, ні відповіді (answeredSlots). Тоді нове питання не ставиться.
 * @returns {object|null} повідомлення-питання
 */
function unansweredQuestion(last, conversation) {
  if (!last || last.role !== 'ai' || !['question', 'policy-choice'].includes(last.kind)) return null;
  const slotKey = last.payload?.slotKey;
  if (!slotKey) return null;
  if ((conversation.skippedSlots || []).includes(slotKey) || (conversation.answeredSlots || []).includes(slotKey)) return null;
  if (conversation.lastDecisionAt && new Date(conversation.lastDecisionAt) > new Date(last.createdAt)) return null;
  return last;
}

// ---------- Розмова ----------

/** @returns {Promise<{ conversation, created: boolean }>} */
async function ensureConversation(syllabusId, userId) {
  const existing = await Conversation.findOne({ syllabusId });
  if (existing) return { conversation: existing, created: false };
  try {
    return { conversation: await Conversation.create({ syllabusId, instructorId: userId }), created: true };
  } catch (err) {
    // Паралельний /start уже створив розмову
    if (err.code === 11000) return { conversation: await Conversation.findOne({ syllabusId }), created: false };
    throw err;
  }
}

const getOrCreateConversation = async (syllabusId, userId) => (await ensureConversation(syllabusId, userId)).conversation;

/** POST /start (ідемпотентно): привітання один раз, далі перший крок. */
async function startConversation(syllabusId, userId) {
  const ctx = await loadContext(syllabusId);
  const { conversation, created } = await ensureConversation(syllabusId, userId);
  if (created) {
    if (ctx.syllabus.track === 'scratch') {
      await postAiMessage(conversation, scratchGreeting(ctx.syllabus));
      const h = ctx.state.header;
      await say(conversation, { content: `Course: ${h.courseTitle || ctx.syllabus.title}\nProgramme: ${ctx.state.programCode}\nCredits / ECTS: ${h.ects ?? 'Not supplied'}\nDelivery mode: ${h.deliveryFormat || 'Not supplied'}`,
        payload: { courseCard: true, header: h, instructors: ctx.state.instructors } });
      await postNextStep(conversation, { preferQuestion: true });
    } else {
      const { readiness, checks } = await buildReadiness(ctx);
      await postAiMessage(conversation, uploadGreeting(ctx, readiness, checks));
      const sections = await approvableSections(ctx);
      if (sections.length) {
        await say(conversation, {
          kind: 'approve-all',
          content: `${sections.length} section${sections.length > 1 ? 's need' : ' needs'} no changes. Approve ${sections.length > 1 ? 'them all' : 'it'}?`,
          payload: { sections },
        });
      }
    }
  }
  if (!created || ctx.syllabus.track !== 'scratch' || await nextPending(syllabusId)) await postNextStep(conversation);
  await refreshConversationReadiness(syllabusId);
  return conversation;
}

/** Назва слота або розділу для повідомлень: слот → розділ шаблону, політика → блок довідника, інакше ключ. */
function slotTitle(refs, slotKey) {
  const slot = SLOTS.find((x) => x.key === slotKey);
  const section = (refs.template || []).find((t) => t.key === (slot?.section || (slotKey === GLANCE_BLOCK ? 'at_a_glance' : slotKey)));
  if (section) return section.title;
  return (refs.policyLibrary?.blocks || []).find((b) => b.key === slotKey)?.title || slotKey;
}

/**
 * POST /skip: слот лишається порожнім (видно ліворуч), інтерв'юер його більше не питає.
 * Трек 1: skip — це відповідь на питання, тож у чаті з'являється репліка викладача (між питаннями завжди є його дія);
 * пропуск розповіді про курс закриває всі її слоти.
 */
async function skipSlot(syllabusId, slotKey, userId) {
  const ctx = await loadContext(syllabusId);
  const conversation = await getOrCreateConversation(syllabusId, userId);
  await Conversation.updateOne({ _id: conversation._id }, { $addToSet: { skippedSlots: slotKey } });
  if (ctx.syllabus.track === 'scratch') {
    await postServerMessage(conversation, `Skip: ${slotTitle(ctx.refs, slotKey)}.`);
    if (NARRATIVE_SLOTS.includes(slotKey)) {
      await Conversation.updateOne({ _id: conversation._id }, { $addToSet: { answeredSlots: { $each: NARRATIVE_SLOTS } } });
    }
  }
  const fresh = await Conversation.findById(conversation._id);
  if (fresh.currentSlotKey === slotKey) await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSlotKey: null } });
  await postNextStep(fresh, { preferQuestion: true });
  return fresh;
}

/** Обгортка для LLM-викликів чату: лічильник збоїв поспіль, 503 retryable для користувача. */
async function withAiFailureTracking(conversation, fn, message) {
  try {
    const result = await fn();
    if (conversation.consecutiveAiFailures || conversation.status === 'error') {
      await Conversation.updateOne({ _id: conversation._id }, { $set: { consecutiveAiFailures: 0, status: 'active' } });
    }
    return result;
  } catch (err) {
    if (err.statusCode && err.statusCode < 500) throw err;
    console.error('chat AI call failed:', err.message);
    const failures = (conversation.consecutiveAiFailures || 0) + 1;
    const update = { consecutiveAiFailures: failures };
    if (failures >= MAX_CONSECUTIVE_FAILURES) update.status = 'error';
    await Conversation.updateOne({ _id: conversation._id }, { $set: update });
    throw httpError(503, message || 'The AI could not respond. Please try again.', { retryable: true });
  }
}

module.exports = {
  MAX_CONSECUTIVE_FAILURES,
  getOrCreateConversation,
  ensureConversation,
  startConversation,
  skipSlot,
  nextPending,
  postSuggestionCard,
  postNextStep,
  postUserMessage,
  postServerMessage,
  postAiMessage,
  transcriptOf,
  withAiFailureTracking,
};
