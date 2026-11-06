// Редагування довідників набору в кабінеті (manager / director / admin): ПРН, нормативні курси, Capstone.
// Кожне збереження замінює весь перелік набору, ставить ReferenceOverride (сід більше не перезаписує цей довідник)
// і не дає видалити те, на що вже посилаються силабуси набору.
const ProgramOutcome = require('../../models/ProgramOutcome');
const ProgramCourse = require('../../models/ProgramCourse');
const CapstoneGuide = require('../../models/CapstoneGuide');
const ReferenceOverride = require('../../models/ReferenceOverride');
const Syllabus = require('../../models/Syllabus');
const { canonicalPloCode: normalizePloCode } = require('./ploCode');
const { httpError } = require('../../utils/httpError');
const references = require('./index');
const locks = require('../locks');


const MAX_ROWS = 200;
const MAX_TEXT = 2000;
const MAX_SHORT = 200;

const invalid = (message) => httpError(400, message, { code: 'VALIDATION_ERROR' });
const str = (v) => (v == null ? '' : String(v).trim());

function list(raw, name) {
  if (!Array.isArray(raw)) throw invalid(`${name} must be an array`);
  if (raw.length > MAX_ROWS) throw invalid(`At most ${MAX_ROWS} ${name} are allowed`);
  return raw;
}

function text(value, field, { required = false, max = MAX_TEXT } = {}) {
  const v = str(value);
  if (required && !v) throw invalid(`${field} is required`);
  if (v.length > max) throw invalid(`${field} is longer than ${max} characters`);
  return v;
}

/** Ключ критерію з назви: «Problem Definition & Relevance» → problem_definition_relevance. */
const slug = (s) => str(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'criterion';

const lockOpts = { message: 'Someone else is saving this reference right now. Refresh and try again.', code: 'REFERENCE_CONFLICT' };

/**
 * Заміна довідника набору під блокуванням з токеном (C04, N01): одночасне збереження того самого довідника → 409.
 * Позначка ReferenceOverride ставиться до запису (сід з фікстур не втрутиться посередині). Якщо fn впала, а блокування
 * досі наше, створена цим викликом позначка прибирається; рядки відновлює fn (replaceRows). Запит, що втратив
 * блокування (сплив lease), не відкочує нічого: довідником уже володіє інший запит. Кеш довідників скидається завжди.
 */
async function withReferenceLock(programCode, kind, userId, fn) {
  return locks.withLock(`ref:${programCode}:${kind}`, async (lock) => {
    const res = await ReferenceOverride.updateOne(
      { programCode, kind },
      { $set: { updatedBy: userId || null }, $setOnInsert: { programCode, kind } },
      { upsert: true },
    );
    const created = Boolean(res.upsertedId);
    try {
      return await fn(lock);
    } catch (err) {
      if (created && await locks.isHeld(lock)) await ReferenceOverride.deleteOne({ _id: res.upsertedId });
      throw err;
    } finally {
      references.invalidateCache();
    }
  }, lockOpts);
}

/**
 * Замінює рядки набору одним упорядкованим bulkWrite; за помилки повертає попередній перелік (знімок з тими самими _id),
 * тож частковий запис не лишається (C04). Запис і відновлення — лише поки блокування наше (N01).
 */
async function replaceRows(Model, programCode, snapshot, ops, lock) {
  await locks.assertHeld(lock);
  try {
    if (ops.length) await Model.bulkWrite(ops, { ordered: true });
  } catch (err) {
    if (await locks.isHeld(lock)) {
      await Model.deleteMany({ programCode });
      if (snapshot.length) await Model.insertMany(snapshot);
    }
    throw err;
  }
  await assertStillHeld(lock, programCode);
}

/**
 * R02: перевірка перед записом не є fencing — якщо блокування сплило посеред запису, інший запит міг уже
 * зберегти свій перелік. Такий запис не повідомляється як успішний (LOCK_LOST) і лишає слід у журналі.
 * Повне fencing потребує транзакцій MongoDB (replica set) — див. docs/AUDIT_V5_2026-11-04.md §9.
 */
async function assertStillHeld(lock, programCode) {
  if (await locks.isHeld(lock)) return;
  console.error(`reference ${lock.key}: the lock expired during the write; ${programCode} may contain rows from two saves — open the reference and save it again`);
  await locks.assertHeld(lock);
}

/** Силабуси набору зі станом (лише потрібні поля). */
const cohortSyllabi = (programCode, select) => Syllabus.find({ programCode, state: { $exists: true, $ne: null } }).select(`_id title ${select}`).lean();

/**
 * ПРН набору: [{ code, text, label }] у потрібному порядку. Видалити ПРН, з яким уже пов'язані результати курсу
 * в силабусах набору, не можна (409 OUTCOME_IN_USE): спершу треба перемапити ці CLO.
 */
async function saveOutcomes(programCode, rawOutcomes, { userId } = {}) {
  const seen = new Set();
  const rows = list(rawOutcomes, 'outcomes').map((o, i) => {
    const raw = text(o?.code, `Outcome ${i + 1}: code`, { required: true, max: 40 });
    // Код зберігається в канонічній формі (C08): «PRN1» і «ПРН1» — той самий ПРН, зв'язки CLO не рвуться
    const code = normalizePloCode(raw);
    if (!code) throw invalid(`Outcome ${i + 1}: code is required`);
    if (seen.has(code)) throw invalid(`Outcome code ${raw} is listed twice`);
    seen.add(code);
    return {
      programCode, code, order: i + 1,
      text: text(o?.text, `${code}: official wording`, { required: true }),
      label: text(o?.label, `${code}: English label`, { max: 120 }),
      themeDraft: text(o?.themeDraft, `${code}: theme`, { max: MAX_SHORT }),
    };
  });

  return withReferenceLock(programCode, 'outcomes', userId, async (lock) => {
  const existing = await ProgramOutcome.find({ programCode }).lean();
  const removed = existing.filter((o) => !seen.has(normalizePloCode(o.code)));
  if (removed.length) {
    const gone = new Set(removed.map((o) => normalizePloCode(o.code)));
    const using = (await cohortSyllabi(programCode, 'state.outcomes.plo'))
      .filter((s) => (s.state?.outcomes || []).some((clo) => (clo.plo || []).some((p) => gone.has(normalizePloCode(p.code)))));
    if (using.length) {
      const codes = removed.filter((o) => using.some((s) => (s.state.outcomes || []).some((clo) => (clo.plo || []).some((p) => normalizePloCode(p.code) === normalizePloCode(o.code))))).map((o) => o.code);
      throw httpError(409, `Outcomes ${codes.join(', ')} cannot be removed: ${using.length} syllabi of ${programCode} link course outcomes to them. Map those course outcomes again first.`, {
        code: 'OUTCOME_IN_USE', details: { codes, syllabi: using.map((s) => ({ id: String(s._id), title: s.title })) },
      });
    }
  }
  // Видалення і перейменування коду (наприклад, «PRN1» → «ПРН1») — тим самим упорядкованим записом
  const ops = [
    ...(removed.length ? [{ deleteMany: { filter: { _id: { $in: removed.map((o) => o._id) } } } }] : []),
    ...rows.map((row) => ({ updateOne: {
      filter: { programCode, code: existing.find((o) => normalizePloCode(o.code) === row.code)?.code ?? row.code },
      update: { $set: row }, upsert: true,
    } })),
  ];
  await replaceRows(ProgramOutcome, programCode, existing, ops, lock);
  references.invalidateCache();
  return references.getOutcomes(programCode);
  });
}

/**
 * Нормативні (core) курси набору: [{ code, uk, en, ects }]. Курс, якого немає в переліку, — elective.
 * Повертає коди, чий тип змінився (додані й прибрані), — для перерахунку courseKind у силабусах.
 */
async function saveCourses(programCode, rawCourses, { userId } = {}) {
  const seen = new Set();
  const norm = (c) => str(c).normalize('NFC').replace(/\s+/g, '').toUpperCase();
  const rows = list(rawCourses, 'courses').map((c, i) => {
    const code = text(c?.code, `Course ${i + 1}: code`, { required: true, max: 40 });
    if (seen.has(norm(code))) throw invalid(`Course code ${code} is listed twice`);
    seen.add(norm(code));
    let ects = null;
    if (c?.ects !== null && c?.ects !== undefined && str(c.ects) !== '') {
      ects = Number(String(c.ects).replace(',', '.'));
      if (!Number.isFinite(ects) || ects <= 0 || ects > 60) throw invalid(`${code}: ECTS must be a number between 0 and 60`);
    }
    return {
      programCode, code,
      uk: text(c?.uk, `${code}: official (Ukrainian) title`, { required: true, max: MAX_SHORT }),
      en: text(c?.en, `${code}: English title`, { max: MAX_SHORT }),
      ects,
    };
  });
  return withReferenceLock(programCode, 'courses', userId, async (lock) => {
    const existing = await ProgramCourse.find({ programCode }).lean();
    const removed = existing.filter((c) => !seen.has(norm(c.code)));
    const added = rows.filter((r) => !existing.some((c) => norm(c.code) === norm(r.code)));
    const ops = [
      ...(removed.length ? [{ deleteMany: { filter: { _id: { $in: removed.map((c) => c._id) } } } }] : []),
      ...rows.map((row) => ({ updateOne: {
        filter: { programCode, code: existing.find((c) => norm(c.code) === norm(row.code))?.code ?? row.code },
        update: { $set: row }, upsert: true,
      } })),
    ];
    await replaceRows(ProgramCourse, programCode, existing, ops, lock);
    references.invalidateCache();
    return { courses: await references.getCourses(programCode), changedCodes: [...removed.map((c) => c.code), ...added.map((c) => c.code)] };
  });
}

/**
 * Capstone набору: типи проєктів, структура, критерії з вагами (у сумі 100%). Видалити критерій, який силабуси
 * набору вже називають у розділі Connection to Capstone, не можна (409 CRITERION_IN_USE).
 */
/** Здавальні матеріали: { presentation: '25-35 slides', report: … } — лише рядкові значення. */
function parseDeliverables(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('deliverables must be an object of texts');
  const entries = Object.entries(raw);
  if (entries.length > 20) throw invalid('At most 20 deliverables are allowed');
  return Object.fromEntries(entries.map(([k, v]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)) throw invalid(`Invalid deliverable key: ${k}`);
    return [k, text(v, `Deliverable ${k}`, { required: true, max: 500 })];
  }));
}

/** Поріг плагіату: null або { similarityPercent: 0–100, consequence }. */
function parseThreshold(raw) {
  if (raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw invalid('plagiarismThreshold must be an object or null');
  const percent = Number(raw.similarityPercent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw invalid('plagiarismThreshold.similarityPercent must be between 0 and 100');
  return { similarityPercent: percent, consequence: text(raw.consequence, 'plagiarismThreshold.consequence', { max: MAX_TEXT }) };
}

async function saveCapstone(programCode, raw = {}, { userId } = {}) {
  return withReferenceLock(programCode, 'capstone', userId, (lock) => writeCapstone(programCode, raw, lock));
}

async function writeCapstone(programCode, raw, lock) {
  const current = await CapstoneGuide.findOne({ programCode }).lean();
  const taken = new Set();
  const uniqueKey = (base) => {
    let key = base; let n = 2;
    while (taken.has(key)) key = `${base}_${n++}`;
    taken.add(key);
    return key;
  };
  const criteria = list(raw.criteria ?? current?.criteria ?? [], 'criteria').map((c, i) => {
    const name = text(c?.name, `Criterion ${i + 1}: name`, { required: true, max: MAX_SHORT });
    const weight = Number(c?.weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw invalid(`${name}: weight must be between 0 and 1 (for example 0.15 for 15%)`);
    return { n: i + 1, key: uniqueKey(str(c?.key) || slug(name)), name, weight, description: text(c?.description, `${name}: description`) };
  });
  const total = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (criteria.length && Math.abs(total - 1) > 0.001) throw invalid(`Criterion weights must add up to 100% (now ${Math.round(total * 1000) / 10}%)`);
  const projectTypes = list(raw.projectTypes ?? current?.projectTypes ?? [], 'projectTypes').map((p, i) => {
    const label = text(p?.label, `Project type ${i + 1}: name`, { required: true, max: MAX_SHORT });
    return { key: str(p?.key) || slug(label), label };
  });
  const structure = list(raw.structure ?? current?.structure ?? [], 'structure').map((s, i) => text(s, `Structure part ${i + 1}`, { required: true, max: MAX_SHORT }));

  const keys = new Set(criteria.map((c) => c.key));
  const removedCriteria = (current?.criteria || []).filter((c) => c.key && !keys.has(c.key));
  const removed = removedCriteria.map((c) => c.key);
  if (removed.length) {
    // C13: посилання — ключ у criteriaKeys або назва критерію в тексті розділу (стани з файлу ключів не мають)
    const named = (text, c) => c.name && String(text || '').toLowerCase().includes(String(c.name).toLowerCase());
    const using = (await cohortSyllabi(programCode, 'state.summary.capstone'))
      .filter((s) => (s.state?.summary?.capstone?.criteriaKeys || []).some((k) => removed.includes(k))
        || removedCriteria.some((c) => named(s.state?.summary?.capstone?.text, c)));
    if (using.length) {
      throw httpError(409, `These Capstone criteria cannot be removed: ${using.length} syllabi of ${programCode} refer to them in Connection to Capstone.`, {
        code: 'CRITERION_IN_USE', details: { keys: removed, syllabi: using.map((s) => ({ id: String(s._id), title: s.title })) },
      });
    }
  }
  await locks.assertHeld(lock);
  await CapstoneGuide.updateOne({ programCode }, {
    $set: {
      projectTypes, structure, criteria,
      version: current?.version || '',
      deliverables: raw.deliverables === undefined ? (current?.deliverables ?? {}) : parseDeliverables(raw.deliverables),
      plagiarismThreshold: raw.plagiarismThreshold === undefined ? (current?.plagiarismThreshold ?? null) : parseThreshold(raw.plagiarismThreshold),
    },
  }, { upsert: true });
  await assertStillHeld(lock, programCode);
  references.invalidateCache();
  return references.getCapstone(programCode);
}

module.exports = { saveOutcomes, saveCourses, saveCapstone };
