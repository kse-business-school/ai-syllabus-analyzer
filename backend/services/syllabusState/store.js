// Єдиний запис Syllabus.state (docs/api-v5.md §1). Кожна зміна — атомарний findOneAndUpdate з умовою на stateRevision;
// розбіжність ревізії → 409 STATE_CONFLICT { revision }. Журнал змін — SlotChange (по запису на змінений шлях).
//
// Запис стану й журналу — дві операції: якщо процес впаде між ними, стан збережено без запису в журналі
// (reopen такої зміни тоді неможливий, але стан лишається узгодженим).
const Syllabus = require('../../models/Syllabus');
const SlotChange = require('../../models/SlotChange');
const { httpError } = require('../../utils/httpError');
const { SECTION_KEYS, validateState } = require('./schema');
const { sectionGaps } = require('./slots');
const { recompute } = require('./computed');
const { changedPaths, getPath, setPath, deepEqual } = require('./paths');

// Документи, створені до v5, можуть не мати поля stateRevision
const revisionFilter = (id, revision) => (revision === 0
  ? { _id: id, $or: [{ stateRevision: 0 }, { stateRevision: { $exists: false } }] }
  : { _id: id, stateRevision: revision });

const stateConflict = (revision) => httpError(409, 'The syllabus was changed in the meantime. Reload and try again.', {
  code: 'STATE_CONFLICT', details: { revision },
});

function assertSectionKey(key) {
  if (!SECTION_KEYS.includes(key)) throw httpError(400, `Unknown section: ${key}`, { code: 'UNKNOWN_SECTION' });
}

function assertValid(state) {
  const errors = validateState(state);
  if (errors.length) throw httpError(422, 'The change produces an invalid syllabus state', { code: 'INVALID_STATE', details: { errors: errors.slice(0, 20) } });
}

/** Поточний стан і ревізія. 404 — немає силабусу, 409 NO_STATE — стан ще не створено. */
async function getState(syllabusId) {
  const doc = await Syllabus.findById(syllabusId).select('state stateRevision').lean();
  if (!doc) throw httpError(404, 'Syllabus not found', { code: 'NOT_FOUND' });
  if (!doc.state) throw httpError(409, 'The syllabus has no structured state yet', { code: 'NO_STATE' });
  return { state: doc.state, revision: doc.stateRevision || 0 };
}

async function loadAt(syllabusId, expectedRevision) {
  const current = await getState(syllabusId);
  if (expectedRevision !== undefined && expectedRevision !== current.revision) throw stateConflict(current.revision);
  return current;
}

/** Атомарний запис нового стану з умовою на ревізію + записи SlotChange. */
async function commit(syllabusId, revision, state, changes, { by = null, source = null, suggestionId = null } = {}) {
  const updated = await Syllabus.findOneAndUpdate(
    revisionFilter(syllabusId, revision),
    { $set: { state }, $inc: { stateRevision: 1 } },
    { new: true, projection: { stateRevision: 1 } },
  ).lean();
  if (!updated) {
    const doc = await Syllabus.findById(syllabusId).select('stateRevision').lean();
    if (!doc) throw httpError(404, 'Syllabus not found', { code: 'NOT_FOUND' });
    throw stateConflict(doc.stateRevision || 0);
  }
  const at = new Date();
  if (changes.length) {
    await SlotChange.insertMany(changes.map((c) => ({
      syllabusId, revision: updated.stateRevision, path: c.path, section: c.section ?? null,
      before: c.before ?? null, after: c.after ?? null, source, suggestionId, by, at,
    })));
  }
  return { state, revision: updated.stateRevision, changes };
}

/**
 * Зміна стану: fn(глибока копія) → новий стан (або мутує копію й нічого не повертає).
 * Далі: перерахунок E-полів (courseKind — лише з ctx.refs), validateState (422 INVALID_STATE),
 * зняття approved з розділів, яких торкнулась зміна, атомарний запис і SlotChange на кожен змінений шлях.
 * fn не може змінити state.sections: затвердження — лише approveSection/approveAll.
 * Без змін — нічого не пише й повертає поточну ревізію.
 * @param {{ by?, source?, suggestionId?, refs? }} ctx
 * @returns {Promise<{ state, revision, changes: { path, section, before, after }[] }>}
 */
const COURSE_KIND_SECTIONS = ['at_a_glance', 'learning_outcomes'];

async function mutate(syllabusId, expectedRevision, fn, ctx = {}) {
  if (!Number.isInteger(expectedRevision)) throw httpError(400, 'expectedRevision is required', { code: 'REVISION_REQUIRED' });
  const { state: before } = await loadAt(syllabusId, expectedRevision);
  const draft = structuredClone(before);
  const result = await fn(draft);
  let next = recompute(structuredClone(result === undefined ? draft : result), ctx.refs);

  const changes = changedPaths(before, next);
  const touched = new Set(changes.map((c) => c.section).filter(Boolean));
  // E-поле courseKind (зміна призначення чи нормативних курсів) у SlotChange не потрапляє, але від нього залежать
  // At a Glance (Course type) і Learning Outcomes (перевірка покриття ПРН): затвердження знімається в тому ж записі (C07)
  if ((before.header?.courseKind ?? null) !== (next.header?.courseKind ?? null)) COURSE_KIND_SECTIONS.forEach((k) => touched.add(k));
  const sections = { ...(before.sections || {}) };
  for (const key of touched) delete sections[key];
  next = { ...next, sections };
  assertValid(next);

  if (deepEqual(before, next)) return { state: before, revision: expectedRevision, changes: [] };
  return commit(syllabusId, expectedRevision, next, changes, ctx);
}

/**
 * Початковий стан (трек 1 — createEmptyState, трек 2 — результат парсера). Ревізія збільшується,
 * тож відкриті вкладки отримають STATE_CONFLICT. setBaseline — зберегти знімок для diff у правій панелі.
 * filter — додаткова умова запису (наприклад, ownedAnalysis(id, leaseToken): запис лише власником lease аналізу);
 * якщо умова не виконується, кидає 409 STATE_CONFLICT (або 404, якщо силабусу немає).
 * @param {{ setBaseline?: boolean, refs?, expectedRevision?: number, filter?: object }} opts
 */
async function initState(syllabusId, state, { setBaseline = true, refs, expectedRevision, filter: extraFilter } = {}) {
  const next = structuredClone(refs ? recompute(state, refs) : state);
  assertValid(next);
  const $set = { state: next };
  if (setBaseline) $set.baselineState = next;
  const base = expectedRevision === undefined ? { _id: syllabusId } : revisionFilter(syllabusId, expectedRevision);
  const filter = extraFilter ? { $and: [base, extraFilter] } : base;
  const updated = await Syllabus.findOneAndUpdate(filter, { $set, $inc: { stateRevision: 1 } }, { new: true, projection: { stateRevision: 1 } }).lean();
  if (!updated) {
    const doc = await Syllabus.findById(syllabusId).select('stateRevision').lean();
    if (!doc) throw httpError(404, 'Syllabus not found', { code: 'NOT_FOUND' });
    throw stateConflict(doc.stateRevision || 0);
  }
  return { state: next, revision: updated.stateRevision };
}

const approvedMeta = (revision) => ({ approved: true, approvedAt: new Date().toISOString(), approvedRevision: revision + 1 });

/** Новий стан із заданими sections + записи журналу для кожного зміненого розділу. */
function withSections(state, sections) {
  const changes = SECTION_KEYS
    .filter((k) => !deepEqual(state.sections?.[k], sections[k]))
    .map((k) => ({ path: `sections.${k}`, section: k, before: state.sections?.[k] ?? null, after: sections[k] ?? null }));
  return { next: { ...state, sections }, changes };
}

/**
 * Затвердити розділ. Пороги slots.sectionGaps не пройдені → 409 SECTION_INCOMPLETE { gaps }.
 * Уже затверджений — без запису.
 */
async function approveSection(syllabusId, key, { by = null, expectedRevision } = {}) {
  assertSectionKey(key);
  const { state, revision } = await loadAt(syllabusId, expectedRevision);
  const gaps = sectionGaps(key, state);
  if (gaps.length) throw httpError(409, 'This section is not complete yet', { code: 'SECTION_INCOMPLETE', details: { gaps } });
  if (state.sections?.[key]?.approved) return { state, revision, changes: [] };
  const { next, changes } = withSections(state, { ...state.sections, [key]: approvedMeta(revision) });
  return commit(syllabusId, revision, next, changes, { by, source: 'approve' });
}

/** Зняти затвердження розділу (запис розділу видаляється). Не затверджений — без запису. */
async function unapproveSection(syllabusId, key, { by = null, expectedRevision } = {}) {
  assertSectionKey(key);
  const { state, revision } = await loadAt(syllabusId, expectedRevision);
  if (!state.sections?.[key]) return { state, revision, changes: [] };
  const sections = { ...state.sections };
  delete sections[key];
  const { next, changes } = withSections(state, sections);
  return commit(syllabusId, revision, next, changes, { by, source: 'unapprove' });
}

/**
 * Гуртове затвердження: лише заповнені розділи без блокерів, одним записом.
 * blockersFor(key) → причина (рядок, англійською) або null; може бути async (відкриті Check/Suggestion — W2).
 * keys — лише ці розділи (картка approve-all); без keys — усі. Невідомий ключ → 400 UNKNOWN_SECTION.
 * Уже затверджені розділи пропускаються мовчки.
 * @returns {Promise<{ approved: string[], skipped: { key, reason }[], state, revision }>}
 */
async function approveAll(syllabusId, { blockersFor, by = null, expectedRevision, keys } = {}) {
  if (keys) keys.forEach(assertSectionKey);
  const { state, revision } = await loadAt(syllabusId, expectedRevision);
  const sections = { ...(state.sections || {}) };
  const approved = [];
  const skipped = [];
  for (const key of SECTION_KEYS.filter((k) => !keys || keys.includes(k))) {
    if (sections[key]?.approved) continue;
    const gaps = sectionGaps(key, state);
    if (gaps.length) {
      skipped.push({ key, reason: `Incomplete: ${gaps.join('; ')}` });
      continue;
    }
    const blocker = blockersFor ? await blockersFor(key) : null;
    if (blocker) {
      skipped.push({ key, reason: blocker });
      continue;
    }
    sections[key] = approvedMeta(revision);
    approved.push(key);
  }
  if (!approved.length) return { approved, skipped, state, revision };
  const { next, changes } = withSections(state, sections);
  const result = await commit(syllabusId, revision, next, changes, { by, source: 'approve' });
  return { approved, skipped, state: result.state, revision: result.revision };
}

/**
 * Відкат змін (reopen): одна SlotChange або кілька (усі записи однієї пропозиції) — одним mutate.
 * Якщо поточне значення хоч одного шляху вже не дорівнює after → 409 REOPEN_CONFLICT { paths }.
 * Записи затвердження (sections.*) не відкочуються.
 * @param {{ by?, source?, suggestionId?, refs? }} ctx  (source за замовчуванням 'reopen')
 */
async function revertChange(syllabusId, slotChange, ctx = {}) {
  const list = (Array.isArray(slotChange) ? slotChange : [slotChange])
    .filter((c) => c && !String(c.path).startsWith('sections.'));
  if (!list.length) throw httpError(400, 'Nothing to revert', { code: 'NOTHING_TO_REVERT' });
  if (list.some((c) => String(c.syllabusId) !== String(syllabusId))) {
    throw httpError(400, 'The change belongs to another syllabus', { code: 'INVALID_SLOT_CHANGE' });
  }
  const { state, revision } = await getState(syllabusId);
  const conflicts = list.filter((c) => !deepEqual(getPath(state, c.path), c.after));
  if (conflicts.length) {
    throw httpError(409, 'This value has been changed since. Edit it directly instead.', {
      code: 'REOPEN_CONFLICT', details: { paths: conflicts.map((c) => c.path) },
    });
  }
  // Новіші зміни відкочуються першими
  const ordered = [...list].sort((a, b) => (b.revision || 0) - (a.revision || 0));
  return mutate(syllabusId, revision, (s) => ordered.reduce((acc, c) => setPath(acc, c.path, c.before), s), {
    ...ctx, source: ctx.source || 'reopen',
  });
}

module.exports = { COURSE_KIND_SECTIONS, getState, mutate, initState, approveSection, unapproveSection, approveAll, revertChange };
