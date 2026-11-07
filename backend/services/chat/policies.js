// Вибір політики (docs/api-v5.md §6): варіант довідника, «keep my text» або «write my own».
// «Write my own» не відкриває поле: розмова переходить на слот, текст викладача формулює оркестратор.

const Conversation = require('../../models/Conversation');
const store = require('../syllabusState/store');
const { httpError } = require('../../utils/httpError');
const { loadContext, markStale, refreshConversationReadiness } = require('./state');
const { assertWritable, policyPatch, setPolicy } = require('./slotWrite');
const { getOrCreateConversation, postAiMessage, postNextStep } = require('./flow');
const { afterDecision } = require('./decisions');

const WRITE_OWN_PROMPT = 'Tell me in your own words how this policy should work.';

/** 'attendance' і 'policy.attendance' — той самий блок. */
const normalizeKey = (key) => (String(key).startsWith('policy.') ? String(key) : `policy.${key}`);

async function choosePolicy(syllabusId, rawKey, { optionKey, writeOwn, keepText, expectedRevision } = {}, userId) {
  const ctx = await loadContext(syllabusId);
  const key = normalizeKey(rawKey);
  assertWritable(ctx.state, `policies{${key}}`); // 404 UNKNOWN_POLICY, 409 LOCKED
  const conversation = await getOrCreateConversation(syllabusId, userId);

  if (writeOwn) {
    await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSlotKey: key, writeOwnPolicyKey: key } });
    await postAiMessage(conversation, WRITE_OWN_PROMPT);
    return;
  }

  const blockOf = (st) => st.policies.find((p) => p.key === key);
  const args = keepText ? { text: blockOf(ctx.state).text } : { optionKey };
  const patch = policyPatch(blockOf(ctx.state), args, ctx.refs, ctx.state.language);
  const result = await store.mutate(syllabusId, expectedRevision ?? ctx.revision,
    (st) => setPolicy(st, key, policyPatch(blockOf(st), args, ctx.refs, st.language)),
    { by: userId, source: patch.source, refs: ctx.refs });
  await markStale(syllabusId, [`policies{${key}}`, ...result.changes.map((c) => c.path)]);
  if (conversation.currentSlotKey === key) await Conversation.updateOne({ _id: conversation._id }, { $set: { currentSlotKey: null, writeOwnPolicyKey: null } });
  await afterDecision(conversation, { nextStep: false });
  await postNextStep(conversation);
  await refreshConversationReadiness(syllabusId);
}

module.exports = { choosePolicy, normalizeKey, WRITE_OWN_PROMPT };
