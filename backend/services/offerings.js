// Призначення курс × набір (CourseOffering, доповнення 29.10 §3): прив'язка силабуса, валідація посилань
// і синхронізація E-полів силабусів після зміни типу курсу в наборі.
const mongoose = require('mongoose');
const CourseOffering = require('../models/CourseOffering');
const Syllabus = require('../models/Syllabus');
const User = require('../models/User');
const Program = require('../models/Program');
const store = require('./syllabusState/store');
const { getRefs, invalidateCache } = require('./references');
const { invalidateOutputs } = require('./outputs');
const { canManageProgramme } = require('./roles');
const { httpError } = require('../utils/httpError');

// Той самий ключ, що й у references.getOfferingTypes і computed.courseKindOf
const normCourseCode = (code) => String(code || '').normalize('NFC').replace(/\s+/g, '').toUpperCase();

/** Викладач може взяти лише своє призначення (або без викладача); manager/director/admin — будь-яке. */
function assertCanUse(offering, user) {
  const own = !offering.lecturerId || String(offering.lecturerId) === String(user.userId);
  if (!own && !canManageProgramme(user.role)) {
    throw httpError(403, 'This course is assigned to another lecturer', { code: 'OFFERING_FORBIDDEN' });
  }
  return offering;
}

/** Призначення за кодом курсу в наборі (без урахування регістру й пробілів) або null. */
async function findOfferingFor(programCode, courseCode) {
  const wanted = normCourseCode(courseCode);
  if (!programCode || !wanted) return null;
  const rows = await CourseOffering.find({ programCode: String(programCode).trim().toUpperCase() }).lean();
  return rows.find((o) => normCourseCode(o.courseCode) === wanted) || null;
}

/**
 * Призначення для нового силабуса: явний offeringId, інакше — призначення, знайдене за programCode + courseCode.
 * Без другого кроку перевірку «курс призначено іншому викладачу» обходили, просто не передавши offeringId.
 */
async function resolveOfferingForCreate({ offeringId, programCode, courseCode }, user) {
  if (offeringId) {
    if (!mongoose.isValidObjectId(offeringId)) throw httpError(400, 'Invalid offering id', { code: 'INVALID_OFFERING' });
    const offering = await CourseOffering.findById(offeringId).lean();
    if (!offering) throw httpError(404, 'Course offering not found', { code: 'OFFERING_NOT_FOUND' });
    return assertCanUse(offering, user);
  }
  const implicit = await findOfferingFor(programCode, courseCode);
  return implicit ? assertCanUse(implicit, user) : null;
}

/** Пара курс × набір має один силабус: другий → 409 з id наявного. */
async function assertOfferingFree(offeringId) {
  if (!offeringId) return;
  const existing = await Syllabus.findOne({ offeringId }).select('_id').lean();
  if (existing) {
    throw httpError(409, 'A syllabus for this course and cohort already exists. Open it instead of creating a new one.', {
      code: 'OFFERING_TAKEN', details: { syllabusId: String(existing._id) },
    });
  }
}

/** E11000 на унікальному індексі Syllabus.offeringId (паралельні запити) → та сама 409. */
function offeringTakenError() {
  return httpError(409, 'A syllabus for this course and cohort already exists. Open it instead of creating a new one.', { code: 'OFFERING_TAKEN' });
}

/** Посилання призначення мають існувати: набір — серед Program.editions, викладач — активний користувач. */
async function assertOfferingRefs({ programCode, lecturerId }) {
  if (programCode !== undefined) {
    const code = String(programCode).trim().toUpperCase();
    if (!(await Program.exists({ 'editions.code': code }))) {
      throw httpError(400, `Unknown cohort: ${programCode}`, { code: 'UNKNOWN_PROGRAM_CODE' });
    }
  }
  if (lecturerId) {
    const lecturer = await User.findOne({ _id: lecturerId, isActive: { $ne: false } }).select('_id').lean();
    if (!lecturer) throw httpError(400, 'The lecturer does not exist or is inactive', { code: 'UNKNOWN_LECTURER' });
  }
}

const MAX_SYNC_ATTEMPTS = 3;
// Розділи, які залежать від типу курсу: At a Glance (Course type) і Learning Outcomes (перевірка покриття ПРН)
const COURSE_KIND_SECTIONS = ['at_a_glance', 'learning_outcomes'];

/**
 * Після зміни призначення: скинути кеш довідників і перерахувати E-поля (courseKind) у силабусах цієї пари.
 * Запис — через store.mutate (знімає approved з зачепленого розділу At a Glance і пише SlotChange).
 * @returns {Promise<number>} скільки силабусів змінилось
 */
async function syncOfferingSyllabi({ programCode, courseCode, offeringId = null }) {
  invalidateCache();
  const code = String(programCode || '').trim().toUpperCase();
  const wanted = normCourseCode(courseCode);
  const or = [{ programCode: code }];
  if (offeringId) or.push({ offeringId });
  const candidates = await Syllabus.find({ $or: or, state: { $exists: true, $ne: null }, legacy: { $ne: true }, needsRebuild: { $ne: true } })
    .select('_id offeringId programCode state.header.courseCode course.code status').lean();
  const affected = candidates.filter((s) => (offeringId && String(s.offeringId) === String(offeringId))
    || normCourseCode(s.state?.header?.courseCode || s.course?.code) === wanted);
  if (!affected.length) return 0;
  const refs = await getRefs(code);
  let changed = 0;
  for (const s of affected) {
    if (s.status === 'analyzing') continue; // аналіз сам перерахує стан із свіжими довідниками
    for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
      try {
        const { state: before, revision } = await store.getState(s._id);
        // E-поля перераховує сам mutate; SlotChange для них не пишеться, тож затвердження знімаємо явно
        let result = await store.mutate(s._id, revision, (st) => st, { source: 'offering', refs });
        if (before.header?.courseKind !== result.state.header?.courseKind) {
          for (const key of COURSE_KIND_SECTIONS) {
            result = await store.unapproveSection(s._id, key, { expectedRevision: result.revision });
          }
          changed += 1;
          invalidateOutputs(s._id);
        }
        break;
      } catch (err) {
        if (err?.code !== 'STATE_CONFLICT' || attempt === MAX_SYNC_ATTEMPTS) {
          console.warn(`offering sync failed for syllabus ${String(s._id)}: ${err.message}`);
          break;
        }
      }
    }
  }
  return changed;
}

module.exports = {
  normCourseCode, findOfferingFor, resolveOfferingForCreate, assertOfferingFree, offeringTakenError, assertOfferingRefs, syncOfferingSyllabi,
};
