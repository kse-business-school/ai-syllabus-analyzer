// Обробники інструментів оркестратора. Правила безпеки (docs/api-v5.md §8) виконуються тут, у коді, а не в промпті:
//  · locked → усі мутуючі інструменти повертають { error: 'LOCKED' };
//  · set_slot — лише free-слоти типу A/C, скаляр, значення буквально є в останній репліці викладача
//    (число — поруч із назвою поля, інакше AMBIGUOUS_VALUE);
//  · propose_draft — лише pending-картка; для політик потрібна instruction-цитата з ОСТАННЬОЇ репліки викладача
//    або розмова, переведена на цю політику кнопкою «Write my own»; факти додає серверний сканер;
//  · propose_items / propose_instructor — сутності списків (заняття, оцінювання, матеріали, профіль) будує сервер,
//    факти (числа, дати, назви, яких не казав викладач) — proposedValues окремих полів; запис лише через Confirm;
//  · apply_edit — лише поточна картка (currentSuggestionId), яку AI показав останньою перед реплікою викладача,
//    усі proposedValues підтверджені, остання репліка — явне підтвердження;
//  · серверні репліки від імені викладача (Message.origin: 'server') не є ні його словами, ні підтвердженням;
//  · будь-який запис стану — через deps.mutate(expectedRevision), на STATE_CONFLICT один повтор із перечитаним станом;
//  · текст документа в результатах — у маркерах <untrusted_document_text>.
const { getSlot } = require('../../syllabusState/slots');
const { getPath, setPath } = require('../../syllabusState/paths');
const { computeReadiness } = require('../../syllabusState/readiness');
const { DELIVERY_FORMATS } = require('../../syllabusState/schema');
const { untrusted } = require('../prompts/preamble');
const {
  DRAFTABLE, NUMERIC_PATHS, ITEM_SLOTS, draftTarget, currentText, referenceTexts, filled, itemsDraft, instructorDraft,
} = require('../slotDrafts');
const { slotKeysOf } = require('./definitions');

const MAX_DRAFT_CHARS = 4000;
const MAX_VALUE_CHARS = 200;
const MAX_CHECKS = 15;
const MIN_INSTRUCTION_CHARS = 6;

// ---------- нормалізація і розпізнавання ----------

/** Нижній регістр, єдині лапки/тире/пробіли — для порівняння «буквально є в репліці». */
const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase()
  .replace(/[“”„«»]/g, '"').replace(/[‘’`´]/g, "'").replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Значення стоїть у репліці окремим токеном (число 6 не збігається з 16 чи 6.5). */
function containsLiteral(utterance, value) {
  const v = norm(value);
  if (!v) return false;
  const numeric = /^\d+(?:[.,]\d+)?$/.test(v);
  const re = numeric
    ? new RegExp(`(?<![\\d]|\\d[.,])${escapeRe(v)}(?![.,]?\\d)`)
    : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(v)}(?![\\p{L}\\p{N}])`, 'u');
  return re.test(norm(utterance));
}

// Назви числових полів: число в репліці зараховується полю, лише якщо стоїть поруч із ними
const NUMBER_FIELD_WORDS = {
  'header.ects': /^(?:ects|credits?|кредит\p{L}*)$/u,
  'header.totalHours': /^(?:hours?|hrs?|h|годин\p{L}*)$/u,
};
const NUMBER_FIELD_DISTANCE = 3;
const MAX_BARE_ANSWER_TOKENS = 3;

/**
 * Число value стосується поля path: поруч (≤ 3 слова) є назва поля («6 ECTS», «ECTS will be 6», «120 hours»),
 * або коротка відповідь на питання саме про це поле («6», «It's 6») з єдиним числом.
 */
function numberIsAbout(utterance, value, path, askedAboutThisSlot) {
  const words = NUMBER_FIELD_WORDS[path];
  const tokens = norm(utterance).match(/\d+(?:[.,]\d+)?|\p{L}+/gu) || [];
  const v = norm(value).replace(',', '.');
  const isNumber = (t) => /^\d/.test(t);
  const hits = tokens.map((t, i) => (isNumber(t) && t.replace(',', '.') === v ? i : -1)).filter((i) => i >= 0);
  if (words && hits.some((i) => tokens.some((t, j) => Math.abs(i - j) <= NUMBER_FIELD_DISTANCE && words.test(t)))) return true;
  return askedAboutThisSlot && tokens.length <= MAX_BARE_ANSWER_TOKENS && tokens.filter(isNumber).length === 1 && hits.length === 1;
}

// Явне підтвердження: коротка репліка, що цілком складається з дозволених фраз (детермінований список)
const CONFIRM_PHRASES = [
  'confirm', 'confirmed', 'i confirm', 'yes', 'yep', 'yeah', 'ok', 'okay', 'sure', 'apply', 'apply it', 'apply this', 'apply the draft',
  'apply the edit', 'apply that', 'confirm it', 'confirm this', 'go ahead', 'do it', 'looks good', 'sounds good', 'approve', 'approved', 'accept', 'save it', 'так', 'підтверджую',
  'застосуй', 'застосовуй', 'добре', 'гаразд',
];
const CONFIRM_FILLERS = new Set(['please', 'now', 'thanks', 'thank', 'you', 'and', 'then', 'дякую', 'будь', 'ласка']);

function isExplicitConfirm(text) {
  const words = norm(text).replace(/[.,!?;:]+/g, ' ').split(' ').filter(Boolean);
  if (!words.length || words.length > 6) return false;
  const core = words.filter((w) => !CONFIRM_FILLERS.has(w)).join(' ');
  if (CONFIRM_PHRASES.includes(core)) return true;
  // «yes, apply», «ok go ahead»: усі частини — підтверджувальні фрази
  const parts = [];
  let rest = core;
  while (rest) {
    const hit = [...CONFIRM_PHRASES].sort((a, b) => b.length - a.length).find((p) => rest === p || rest.startsWith(`${p} `));
    if (!hit) return false;
    parts.push(hit);
    rest = rest.slice(hit.length).trim();
  }
  return parts.length > 0;
}

// ---------- контекст ходу ----------

/**
 * Залежності, яких не передав виклик, беруться зі справжніх модулів (завантажуються ліниво: чисті тести їх не потребують).
 * acceptSuggestion дефолту не має — його реалізує сервіс рішень чату.
 */
function withDefaultDeps(deps = {}, { draftOnly = false } = {}) {
  const out = { ...deps };
  if (!out.mutate) out.mutate = (...a) => require('../../syllabusState/store').mutate(...a);
  // Хід Reword лише будує чернетку (N08): будь-який запис стану — помилка, навіть якщо інструмент його спробує
  if (draftOnly) out.mutate = async () => { throw Object.assign(new Error('This turn only drafts; the syllabus cannot be changed'), { code: 'DRAFT_ONLY' }); };
  if (!out.getState) out.getState = (...a) => require('../../syllabusState/store').getState(...a);
  if (!out.createDraftSuggestions) out.createDraftSuggestions = (...a) => require('../../chat/draftSuggestions').createDraftSuggestions(...a);
  if (!out.runChecks) out.runChecks = (...a) => require('../../checks').runChecks(...a);
  if (!out.findSuggestion) out.findSuggestion = (id) => require('../../../models/Suggestion').findById(id).lean();
  return out;
}

/** Репліка самого викладача: серверні «Confirmed: …», «Skip: …» (origin: 'server') — ні. */
const isInstructorMessage = (m) => m?.role === 'user' && m.origin !== 'server';

/**
 * Змінний контекст одного ходу оркестратора.
 * @param {{ syllabus, state, revision, refs, userText, userId, messages?, conversation?, currentSlotKey?, deps }} ctx
 *   messages — у хронологічному порядку; conversation — { currentSuggestionId, currentSlotKey, writeOwnPolicyKey }
 */
function createToolContext(ctx) {
  const history = ctx.messages || [];
  const fromHistory = history.filter((m) => isInstructorMessage(m) && (m.kind || 'text') === 'text' && filled(m.content)).map((m) => m.content);
  const last = String(ctx.userText || '');
  // Поточну репліку можуть уже зберегти в messages: не дублюємо
  const utterances = norm(fromHistory[fromHistory.length - 1]) === norm(last) ? fromHistory : [...fromHistory, last];
  const conversation = ctx.conversation || {};
  const slotKey = ctx.currentSlotKey ?? conversation.currentSlotKey ?? null;
  return {
    syllabusId: ctx.syllabus._id || ctx.syllabus.id,
    state: ctx.state,
    revision: ctx.revision,
    refs: ctx.refs,
    userId: ctx.userId ?? null,
    lastUtterance: last,
    utterances,
    deps: withDefaultDeps(ctx.deps, { draftOnly: Boolean(ctx.draftOnly) }),
    // Reword картки (N07, N08): чернетка будується на значенні картки, а стан не змінюється
    draftOnly: Boolean(ctx.draftOnly),
    draftBase: ctx.draftBase || null,
    startedAt: Date.now(),
    createdIds: [],
    wrote: false,
    stateChanged: false,
    currentSlotKey: slotKey,
    // Слот розмови на початку ходу (get_slot/propose_draft змінюють лише currentSlotKey)
    conversationSlotKey: slotKey,
    writeOwnPolicyKey: conversation.writeOwnPolicyKey ?? null,
    // Картка, яку зараз показано, і останнє повідомлення AI перед реплікою викладача (для apply_edit)
    currentSuggestionId: conversation.currentSuggestionId ? String(conversation.currentSuggestionId) : null,
    lastAiMessage: [...history].reverse().find((m) => m.role === 'ai') || null,
  };
}

const fail = (error, message, extra = {}) => ({ error, message, ...extra });

const slotError = (key, state, refs) => {
  const slot = getSlot(key, state);
  if (!slot || !slotKeysOf(state, refs).includes(key)) return { error: fail('UNKNOWN_SLOT', `Unknown slot: ${key}`) };
  if (slot.editability === 'locked') return { error: fail('LOCKED', 'This slot is locked and cannot be changed in chat') };
  return { slot };
};

/** Запис стану через deps.mutate; на STATE_CONFLICT один повтор із перечитаним станом. */
async function writeState(tctx, fn, ctx = {}) {
  const meta = { by: tctx.userId, source: 'chat', refs: tctx.refs, ...ctx };
  let result;
  try {
    result = await tctx.deps.mutate(tctx.syllabusId, tctx.revision, fn, meta);
  } catch (err) {
    if (err?.code !== 'STATE_CONFLICT') throw err;
    const fresh = await tctx.deps.getState(tctx.syllabusId);
    tctx.state = fresh.state;
    tctx.revision = fresh.revision;
    result = await tctx.deps.mutate(tctx.syllabusId, tctx.revision, fn, meta);
  }
  tctx.state = result.state;
  tctx.revision = result.revision;
  if (result.changes?.length) tctx.stateChanged = true;
  return result;
}

const knownTexts = (tctx, slotKey, slotValue) => [...tctx.utterances, ...referenceTexts(tctx.refs, slotKey), currentText(slotValue)].filter(Boolean);
const sectionTitle = (tctx, slot) => (tctx.refs?.template || []).find((t) => t.key === slot.section)?.title || slot.key;
const isScalarPath = (p) => !/\[|\{/.test(p) && p !== 'header.term';

// ---------- інструменти ----------

async function get_slot(tctx, { key }) {
  const slot = getSlot(key, tctx.state);
  if (!slot || !slotKeysOf(tctx.state, tctx.refs).includes(key)) return fail('UNKNOWN_SLOT', `Unknown slot: ${key}`);
  let value;
  if (key.startsWith('policy.')) {
    const p = (tctx.state.policies || []).find((x) => x.key === key);
    value = p ? { mode: p.mode, optionKey: p.optionKey, text: p.text, modified: p.modified } : null;
  } else {
    value = getPath(tctx.state, slot.path);
  }
  tctx.currentSlotKey = key;
  return {
    key, type: slot.type, editability: slot.editability, required: slot.required,
    value: untrusted(JSON.stringify(value ?? null).slice(0, 6000)),
  };
}

const draftOnlyError = () => fail('DRAFT_ONLY', 'This turn only rewords the draft on the card; use propose_items or propose_instructor');

/** Значення чернетки картки для Reword, якщо інструмент пише в той самий шлях. */
const draftBaseFor = (tctx, path) => (tctx.draftBase && tctx.draftBase.path === path ? tctx.draftBase.value : null);

async function set_slot(tctx, { key, value }) {
  if (tctx.draftOnly) return draftOnlyError();
  const { slot, error } = slotError(key, tctx.state, tctx.refs);
  if (error) return error;
  if (key.startsWith('policy.') || slot.type === 'E' || slot.editability !== 'free') {
    return fail('SLOT_NOT_WRITABLE', 'This slot cannot be written directly; use propose_draft');
  }
  if (!['A', 'C'].includes(slot.type) && !['A', 'C'].includes(slot.fallbackType)) {
    return fail('SLOT_NOT_WRITABLE', 'Only simple answer slots can be written directly; use propose_draft');
  }
  if (!isScalarPath(slot.path)) return fail('NOT_SCALAR', 'Only single-value slots can be set directly; use propose_draft');
  if (tctx.wrote) return fail('ONE_WRITE_PER_TURN', 'Only one state change is allowed per turn');

  const raw = typeof value === 'string' ? value.trim() : value;
  if (!filled(raw) || String(raw).length > MAX_VALUE_CHARS) return fail('INVALID_VALUE', 'Invalid value');
  // Значення мусить прозвучати від викладача, а не від моделі
  if (!containsLiteral(tctx.lastUtterance, raw)) {
    return fail('USE_PROPOSE_DRAFT', 'The value is not literally in the instructor\'s last message; propose it as a draft for confirmation');
  }
  // «I run 6 sessions» — це не 6 ECTS: число має стояти поруч із назвою поля (або бути всією відповіддю на питання про це поле)
  if (NUMERIC_PATHS.has(slot.path) && !numberIsAbout(tctx.lastUtterance, raw, slot.path, tctx.conversationSlotKey === key)) {
    return fail('AMBIGUOUS_VALUE', 'The number is not clearly about this field; ask the instructor which value they mean before writing it');
  }
  let next = raw;
  if (NUMERIC_PATHS.has(slot.path)) {
    next = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(next) || next < 0) return fail('INVALID_VALUE', 'Expected a non-negative number');
  } else if (slot.path === 'header.programBlock') {
    // B-8.6: лише значення із закритого списку програми — за кодом блоку («2.2») або повною назвою
    const blocks = tctx.refs?.programBlocks || [];
    const block = blocks.find((b) => norm(b.code) === norm(raw) || norm(b.label) === norm(raw));
    if (!block) return fail('INVALID_VALUE', blocks.length ? `Programme block must be one of: ${blocks.map((b) => b.label).join('; ')}` : 'This programme has no blocks');
    next = block.label;
  } else if (slot.path === 'header.deliveryFormat') {
    next = norm(raw);
    if (!DELIVERY_FORMATS.includes(next)) return fail('USE_PROPOSE_DRAFT', `Delivery mode must be one of: ${DELIVERY_FORMATS.join(', ')}`);
  } else {
    next = String(raw);
  }
  tctx.wrote = true;
  const result = await writeState(tctx, (draft) => setPath(draft, slot.path, next));
  tctx.currentSlotKey = key;
  return { ok: true, key, value: next, changed: Boolean(result.changes?.length), revision: result.revision };
}

async function propose_draft(tctx, { key, text, instruction, entity_id: entityId, proposed_values: modelValues }) {
  const { slot, error } = slotError(key, tctx.state, tctx.refs);
  if (error) return error;
  const body = String(text ?? '').trim();
  if (!body || body.length > MAX_DRAFT_CHARS) return fail('INVALID_VALUE', 'The draft text is empty or too long');

  const isPolicy = key.startsWith('policy.');
  let quoted = false;
  if (isPolicy) {
    // AI не пише політику з власної ініціативи: цитата з ОСТАННЬОЇ репліки викладача (не з історії і не з серверних
    // «Confirmed: …») або розмова, яку викладач сам перевів на цю політику кнопкою «Write my own»
    const quote = norm(instruction);
    quoted = quote.length >= MIN_INSTRUCTION_CHARS && quote.includes(' ') && norm(tctx.lastUtterance).includes(quote);
    const writingOwn = tctx.writeOwnPolicyKey === key && tctx.conversationSlotKey === key;
    if (!quoted && !writingOwn) return fail('POLICY_NEEDS_INSTRUCTION', 'Policy text can only be drafted on the instructor\'s instruction; quote their last message verbatim in instruction, or let them choose a library option');
  }
  // Посилання лише ті, що назвав викладач (перевірені URL додає suggest_readings)
  const urls = body.match(/https?:\/\/\S+/gi) || [];
  if (urls.some((u) => !tctx.utterances.some((m) => norm(m).includes(norm(u))))) {
    return fail('UNVERIFIED_URL', 'Links cannot be added unless the instructor gave them; use suggest_readings');
  }

  let part;
  let current;
  let path;
  if (isPolicy) {
    path = `policies{${key}}`;
    part = { target: { path, entityId: null }, value: body, text: body };
    current = (tctx.state.policies || []).find((p) => p.key === key)?.text;
  } else if (DRAFTABLE[key]) {
    const def = DRAFTABLE[key];
    if (def.entity) {
      if (!entityId || !(getPath(tctx.state, `${def.entity}[]`) || []).some((e) => e.id === entityId)) {
        return fail('UNKNOWN_ENTITY', `entity_id must be the id of an existing item of ${def.entity}`);
      }
    }
    part = draftTarget(key, { state: tctx.state, text: body, entityId });
    if (!part) return fail('INVALID_VALUE', 'The draft text is empty');
    path = part.target.path;
    current = getPath(tctx.state, path);
  } else if (slot.editability === 'free' && isScalarPath(slot.path)) {
    let value = body;
    if (NUMERIC_PATHS.has(slot.path)) {
      value = Number(body.replace(',', '.'));
      if (!Number.isFinite(value) || value < 0) return fail('INVALID_VALUE', 'Expected a non-negative number');
    } else if (slot.path === 'header.deliveryFormat') {
      value = norm(body);
      if (!DELIVERY_FORMATS.includes(value)) return fail('INVALID_VALUE', `Delivery mode must be one of: ${DELIVERY_FORMATS.join(', ')}`);
    }
    path = slot.path;
    part = { target: { path, entityId: null }, value, text: body };
    current = getPath(tctx.state, path);
  } else {
    if (ITEM_SLOTS[key]) return fail('USE_PROPOSE_ITEMS', 'This slot is a list of items; use propose_items');
    if (key === 'instructor.profile') return fail('USE_PROPOSE_INSTRUCTOR', 'Use propose_instructor for the instructor profile');
    return fail('SLOT_NOT_DRAFTABLE', 'This slot cannot be drafted as text; it is filled from a catalog or by a dedicated tool');
  }

  // Назви факторів моделі лишаємо, лише якщо вони справді є в тексті; решту знайде серверний сканер
  const proposedValues = (modelValues || []).filter((v) => v?.value && norm(part.text).includes(norm(v.value)))
    .map((v) => ({ label: v.label || 'Value', value: v.value }));
  const input = {
    origin: 'orchestrator',
    kind: 'edit',
    severity: 'medium',
    title: `Draft: ${sectionTitle(tctx, slot)}`,
    description: isPolicy
      ? (quoted ? `Policy text drafted per your instruction: “${String(instruction).trim()}”` : 'Policy text drafted from your own description in chat.')
      : 'Drafted from your answers in chat.',
    rationale: isPolicy ? 'Written only as the instructor asked; no rules were added.' : 'Based on what you told me in this conversation.',
    ...part,
    proposedValues,
  };
  const [created] = await tctx.deps.createDraftSuggestions([input], {
    syllabusId: tctx.syllabusId, state: tctx.state, refs: tctx.refs, known: knownTexts(tctx, key, current),
  });
  const id = String(created._id);
  tctx.createdIds.push(id);
  tctx.currentSlotKey = key;
  const pv = created.draft?.proposedValues || [];
  return {
    ok: true, draft_id: id, status: 'pending',
    proposed_values: pv.map((v) => ({ id: v.id, label: v.label, value: v.value })),
    next_step: pv.length
      ? 'Tell the instructor the draft is on a card. The listed values were not stated by them and must be confirmed on the card; then they press Confirm.'
      : 'Tell the instructor the draft is on a card and they should press Confirm to save it.',
  };
}

/** Посилання в чернетці — лише ті, що назвав викладач (перевірені URL додає suggest_readings). */
const unverifiedUrl = (tctx, texts) => texts.flatMap((t) => String(t ?? '').match(/https?:\/\/\S+/gi) || [])
  .some((u) => !tctx.utterances.some((m) => norm(m).includes(norm(u))));

/** Спільне для propose_items / propose_instructor: картка з чернеткою, зібраною сервером. */
async function createStructuredDraft(tctx, key, slot, part, description) {
  const input = {
    origin: 'orchestrator',
    kind: 'edit',
    severity: 'medium',
    title: `Draft: ${sectionTitle(tctx, slot)}`,
    description,
    rationale: 'Based on what you told me in this conversation.',
    target: part.target,
    value: part.value,
    text: part.text,
    template: part.template,
    proposedValues: part.proposedValues,
    factsScanned: true,
  };
  const [created] = await tctx.deps.createDraftSuggestions([input], {
    syllabusId: tctx.syllabusId, state: tctx.state, refs: tctx.refs, known: knownTexts(tctx, key, getPath(tctx.state, part.target.path)),
  });
  const id = String(created._id);
  tctx.createdIds.push(id);
  tctx.currentSlotKey = key;
  const pv = created.draft?.proposedValues || [];
  return {
    ok: true, draft_id: id, status: 'pending',
    proposed_values: pv.map((v) => ({ id: v.id, label: v.label, value: v.value })),
    next_step: pv.length
      ? 'Tell the instructor the draft is on a card. The listed values were not stated by them and must be confirmed on the card; then they press Confirm.'
      : 'Tell the instructor the draft is on a card and they should press Confirm to save it.',
  };
}

async function propose_items(tctx, { key, mode, items }) {
  const { slot, error } = slotError(key, tctx.state, tctx.refs);
  if (error) return error;
  if (!ITEM_SLOTS[key]) return fail('SLOT_NOT_LIST', `propose_items works only for: ${Object.keys(ITEM_SLOTS).join(', ')}`);
  if (unverifiedUrl(tctx, (items || []).flatMap((i) => [i?.url, i?.label, i?.criteria]))) {
    return fail('UNVERIFIED_URL', 'Links cannot be added unless the instructor gave them; use suggest_readings');
  }
  const known = knownTexts(tctx, key, getPath(tctx.state, ITEM_SLOTS[key].path));
  const part = itemsDraft(key, { state: tctx.state, items, mode, known, base: draftBaseFor(tctx, ITEM_SLOTS[key].path) });
  if (part.error) return fail(part.error, part.message);
  return createStructuredDraft(tctx, key, slot, part, mode === 'replace' ? 'The list drafted from your answers in chat.' : 'Items drafted from your answers in chat.');
}

async function propose_instructor(tctx, values) {
  const key = 'instructor.profile';
  const { slot, error } = slotError(key, tctx.state, tctx.refs);
  if (error) return error;
  if (unverifiedUrl(tctx, Object.values(values || {}).flat())) return fail('UNVERIFIED_URL', 'Links cannot be added unless the instructor gave them');
  const part = instructorDraft({ state: tctx.state, values, known: knownTexts(tctx, key, tctx.state.instructors), base: draftBaseFor(tctx, 'instructors[]') });
  if (part.error) return fail(part.error, part.message);
  return createStructuredDraft(tctx, key, slot, part, 'Instructor details drafted from your answers in chat.');
}

async function apply_edit(tctx, { draft_id: draftId }) {
  if (tctx.draftOnly) return draftOnlyError();
  const suggestion = await tctx.deps.findSuggestion(draftId);
  if (!suggestion || String(suggestion.syllabusId) !== String(tctx.syllabusId)) return fail('NOT_FOUND', 'Draft not found');
  if (suggestion.status !== 'pending') return fail('NOT_PENDING', 'This draft has already been decided');
  if (suggestion.kind !== 'edit' || !suggestion.draft) return fail('NOT_APPLICABLE', 'This card is not an editable draft');
  const createdNow = tctx.createdIds.includes(String(suggestion._id))
    || (suggestion.createdAt && new Date(suggestion.createdAt).getTime() >= tctx.startedAt);
  const unconfirmed = (suggestion.draft.proposedValues || []).filter((v) => !v.confirmed);
  // «yes» підтверджує лише картку, яку зараз показано й яку AI показав останньою перед цією реплікою:
  // відповідь на «Shall I look for readings?» не застосовує іншу pending-картку
  const last = tctx.lastAiMessage;
  const shownCard = tctx.currentSuggestionId === String(suggestion._id)
    && last?.kind === 'suggestion' && String(last.relatedSuggestionId) === String(suggestion._id);
  if (createdNow || unconfirmed.length || !shownCard || !isExplicitConfirm(tctx.lastUtterance)) {
    return fail('NEEDS_CONFIRM', 'The instructor must press Confirm on the card', {
      reason: createdNow ? 'created_this_turn' : unconfirmed.length ? 'unconfirmed_values' : !shownCard ? 'not_current_card' : 'no_explicit_confirmation',
      unconfirmed: unconfirmed.map((v) => ({ id: v.id, label: v.label, value: v.value })),
    });
  }
  if (tctx.wrote) return fail('ONE_WRITE_PER_TURN', 'Only one state change is allowed per turn');
  if (!tctx.deps.acceptSuggestion) return fail('NOT_CONFIGURED', 'Applying drafts is not available');
  tctx.wrote = true;
  const result = await tctx.deps.acceptSuggestion(draftId, { expectedRevision: tctx.revision, userId: tctx.userId });
  const fresh = await tctx.deps.getState(tctx.syllabusId);
  tctx.state = fresh.state;
  tctx.revision = fresh.revision;
  tctx.stateChanged = true;
  const slotPath = suggestion.target?.path;
  return { ok: true, draft_id: String(draftId), revision: result?.revision ?? fresh.revision, path: slotPath };
}

async function run_checks(tctx) {
  const checks = await tctx.deps.runChecks(tctx.state, tctx.refs);
  const open = checks.filter((c) => c.passed === false);
  const readiness = computeReadiness(tctx.state, { refs: tctx.refs, checks });
  return {
    open_issues: open.slice(0, MAX_CHECKS).map((c) => ({ id: c.id, severity: c.severity, section: c.section, message: untrusted(c.message) })),
    open_issues_total: open.length,
    readiness: {
      score: readiness.score,
      approved: readiness.counts.approved,
      required: readiness.counts.required,
      sections: Object.fromEntries(Object.entries(readiness.sections).map(([k, s]) => [k, { status: s.status, gaps: s.gaps }])),
    },
  };
}

async function createCards(tctx, inputs, slotKey) {
  if (!inputs.length) return [];
  const known = knownTexts(tctx, slotKey);
  const created = await tctx.deps.createDraftSuggestions(
    inputs.map((i) => ({ ...i, origin: 'orchestrator' })),
    { syllabusId: tctx.syllabusId, state: tctx.state, refs: tctx.refs, known },
  );
  created.forEach((c) => tctx.createdIds.push(String(c._id)));
  tctx.currentSlotKey = slotKey;
  return created;
}

async function suggest_plo(tctx, { outcome_ids: outcomeIds }) {
  const { suggestPlo } = require('../prompts/loMapping');
  const known = new Set((tctx.state.outcomes || []).map((o) => o.id));
  const unknown = (outcomeIds || []).filter((id) => !known.has(id));
  if (unknown.length) return fail('UNKNOWN_ENTITY', `Unknown outcome ids: ${unknown.join(', ')}`);
  const inputs = await suggestPlo({ state: tctx.state, refs: tctx.refs, outcomeIds });
  const created = await createCards(tctx, inputs, 'course.outcomes_plo');
  if (!created.length) return { ok: true, created: 0, note: 'Nothing to map: there are no learning outcomes yet or no programme outcomes.' };
  return { ok: true, created: created.length, draft_ids: created.map((c) => String(c._id)), next_step: 'Tell the instructor the suggested mappings are on cards for them to confirm or change.' };
}

async function suggest_readings(tctx, { query }) {
  const { suggestReadings } = require('../prompts/readings');
  const inputs = await suggestReadings({ state: tctx.state, refs: tctx.refs, query });
  const created = await createCards(tctx, inputs, 'materials.recommended');
  if (!created.length) return { ok: true, created: 0, note: 'No sources with a verified link were found. Do not suggest titles from memory; ask the instructor for the reading.' };
  return {
    ok: true, created: created.length, draft_ids: created.map((c) => String(c._id)),
    proposed_values: (created[0].draft?.proposedValues || []).map((v) => ({ id: v.id, label: v.label, value: v.value })),
    next_step: 'Tell the instructor the readings are on a card; the titles must be confirmed on the card before they are added.',
  };
}

async function suggest_ai_tools(tctx) {
  const { suggestAiTools } = require('../prompts/aiTools');
  const created = await createCards(tctx, await suggestAiTools({ state: tctx.state, refs: tctx.refs }), 'schedule.additional');
  if (!created.length) return { ok: true, created: 0, note: 'The AI in Your Course catalog has no examples yet. Do not suggest AI assignment formats from memory.' };
  return { ok: true, created: created.length, draft_ids: created.map((c) => String(c._id)), next_step: 'Tell the instructor the ideas are on a card and ask which one they want and where to use it.' };
}

const HANDLERS = {
  get_slot, set_slot, propose_draft, propose_items, propose_instructor, apply_edit, run_checks, suggest_plo, suggest_readings, suggest_ai_tools,
};

/** Виконує інструмент; збої повертаються моделі як { error }, а не кидаються. */
async function runTool(tctx, name, args) {
  const handler = HANDLERS[name];
  if (!handler) return fail('UNKNOWN_TOOL', `Unknown tool: ${name}`);
  try {
    return await handler(tctx, args || {});
  } catch (err) {
    if (err?.statusCode || err?.code) return fail(err.code || 'ERROR', err.message, err.details ? { details: err.details } : {});
    console.error(`Tool ${name} failed:`, err);
    return fail('TOOL_FAILED', 'The tool failed unexpectedly');
  }
}

module.exports = { createToolContext, runTool, HANDLERS, isExplicitConfirm, containsLiteral, numberIsAbout, isInstructorMessage, norm };
