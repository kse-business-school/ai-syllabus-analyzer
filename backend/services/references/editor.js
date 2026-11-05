// Редагування довідників набору в кабінеті (manager / director / admin): ПРН, нормативні курси, Capstone.
// Кожне збереження замінює весь перелік набору, ставить ReferenceOverride (сід більше не перезаписує цей довідник)
// і не дає видалити те, на що вже посилаються силабуси набору.
const ProgramOutcome = require('../../models/ProgramOutcome');
const ProgramCourse = require('../../models/ProgramCourse');
const CapstoneGuide = require('../../models/CapstoneGuide');
const ReferenceOverride = require('../../models/ReferenceOverride');
const Syllabus = require('../../models/Syllabus');
const { normalizePloCode: checksPloCode } = require('../checks/plo');
const { httpError } = require('../../utils/httpError');
const references = require('./index');

// «PRN 3», «ПPН3», «ПРН3» — один код (обидві нормалізації: references і перевірки plo)
const normalizePloCode = (code) => checksPloCode(references.normalizePloCode(code));

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

async function markManaged(programCode, kind, userId) {
  await ReferenceOverride.updateOne({ programCode, kind }, { $set: { updatedBy: userId || null } }, { upsert: true });
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
    const code = text(o?.code, `Outcome ${i + 1}: code`, { required: true, max: 40 });
    const key = normalizePloCode(code);
    if (seen.has(key)) throw invalid(`Outcome code ${code} is listed twice`);
    seen.add(key);
    return {
      programCode, code, order: i + 1,
      text: text(o?.text, `${code}: official wording`, { required: true }),
      label: text(o?.label, `${code}: English label`, { max: 120 }),
      themeDraft: text(o?.themeDraft, `${code}: theme`, { max: MAX_SHORT }),
    };
  });

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
    await ProgramOutcome.deleteMany({ _id: { $in: removed.map((o) => o._id) } });
  }
  for (const row of rows) {
    await ProgramOutcome.updateOne({ programCode, code: existing.find((o) => normalizePloCode(o.code) === normalizePloCode(row.code))?.code ?? row.code }, { $set: row }, { upsert: true });
  }
  await markManaged(programCode, 'outcomes', userId);
  references.invalidateCache();
  return references.getOutcomes(programCode);
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
  const existing = await ProgramCourse.find({ programCode }).lean();
  const removed = existing.filter((c) => !seen.has(norm(c.code)));
  const added = rows.filter((r) => !existing.some((c) => norm(c.code) === norm(r.code)));
  if (removed.length) await ProgramCourse.deleteMany({ _id: { $in: removed.map((c) => c._id) } });
  for (const row of rows) {
    await ProgramCourse.updateOne({ programCode, code: existing.find((c) => norm(c.code) === norm(row.code))?.code ?? row.code }, { $set: row }, { upsert: true });
  }
  await markManaged(programCode, 'courses', userId);
  references.invalidateCache();
  return { courses: await references.getCourses(programCode), changedCodes: [...removed.map((c) => c.code), ...added.map((c) => c.code)] };
}

/**
 * Capstone набору: типи проєктів, структура, критерії з вагами (у сумі 100%). Видалити критерій, який силабуси
 * набору вже називають у розділі Connection to Capstone, не можна (409 CRITERION_IN_USE).
 */
async function saveCapstone(programCode, raw = {}, { userId } = {}) {
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
  const removed = (current?.criteria || []).map((c) => c.key).filter((k) => k && !keys.has(k));
  if (removed.length) {
    const using = (await cohortSyllabi(programCode, 'state.summary.capstone.criteriaKeys'))
      .filter((s) => (s.state?.summary?.capstone?.criteriaKeys || []).some((k) => removed.includes(k)));
    if (using.length) {
      throw httpError(409, `These Capstone criteria cannot be removed: ${using.length} syllabi of ${programCode} refer to them in Connection to Capstone.`, {
        code: 'CRITERION_IN_USE', details: { keys: removed, syllabi: using.map((s) => ({ id: String(s._id), title: s.title })) },
      });
    }
  }
  await CapstoneGuide.updateOne({ programCode }, {
    $set: {
      projectTypes, structure, criteria,
      version: current?.version || '',
      deliverables: raw.deliverables ?? current?.deliverables ?? {},
      plagiarismThreshold: raw.plagiarismThreshold ?? current?.plagiarismThreshold ?? null,
    },
  }, { upsert: true });
  await markManaged(programCode, 'capstone', userId);
  references.invalidateCache();
  return references.getCapstone(programCode);
}

module.exports = { saveOutcomes, saveCourses, saveCapstone };
