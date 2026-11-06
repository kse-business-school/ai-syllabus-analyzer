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
const normCourseCode = CourseOffering.courseKeyOf;

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

/**
 * Зміна коду курсу наявного силабуса (PUT /api/syllabus/:id, картка «Is this a core course?»): ті самі правила, що
 * й при створенні (C01). Прив'язаний силабус код не змінює (400). Якщо новий код — чуже призначення → 403,
 * зайняте → 409; своє вільне — атомарно займається (умова offeringId: null + унікальний індекс).
 * @returns {Promise<{ offering: object|null, courseCode: string|null, release: () => Promise<void> }>}
 *   release — відкат прив'язки, якщо наступний запис стану не вдався
 */
async function claimOfferingForCode(syllabus, courseCode, user) {
  const code = courseCode == null ? null : String(courseCode).trim() || null;
  const noop = { offering: null, courseCode: code, release: async () => {} };
  if (syllabus.offeringId) {
    if (normCourseCode(code) !== normCourseCode(syllabus.course?.code)) {
      throw httpError(400, 'The course code comes from the course assignment and cannot be changed here.', { code: 'OFFERING_COURSE_LOCKED' });
    }
    return noop;
  }
  if (!code) return noop;
  const offering = await resolveOfferingForCreate({ programCode: syllabus.programCode, courseCode: code }, user);
  if (!offering) return noop;
  await assertOfferingFree(offering._id);
  let res;
  try {
    res = await Syllabus.updateOne({ _id: syllabus._id, offeringId: null }, { $set: { offeringId: offering._id, 'course.code': offering.courseCode } });
  } catch (err) {
    if (err?.code === 11000) throw offeringTakenError();
    throw err;
  }
  if (!res.modifiedCount) throw httpError(409, 'The syllabus has changed. Refresh the page and try again.', { code: 'STATE_CONFLICT' });
  return {
    offering,
    courseCode: offering.courseCode,
    release: async () => {
      await Syllabus.updateOne({ _id: syllabus._id, offeringId: offering._id }, { $unset: { offeringId: '' }, $set: { 'course.code': syllabus.course?.code ?? null } });
    },
  };
}

/**
 * Усі силабуси набору (N10, після зміни переліку нормативних курсів): перерахунок ідемпотентний, тож повтор
 * запиту після 503 SYNC_INCOMPLETE доводить до ладу й ті силабуси, чий курс у diff уже не потрапляє.
 */
const syncCohortSyllabi = (programCode) => syncOfferingSyllabi({ programCode, allCourses: true });

/** Ключ блокування зміни коду курсу силабуса (N05): PUT, Confirm і Reopen картки коду серіалізуються. */
const courseCodeLockKey = (syllabusId) => `syllabus-code:${String(syllabusId)}`;

/**
 * Узгоджує метадані силабуса з кодом курсу в стані (N06, після Reopen коду): прив'язка до призначення
 * з іншим кодом знімається, course.code = код зі стану. Викликати під courseCodeLockKey.
 */
async function reconcileCourseCode(syllabusId) {
  const syllabus = await Syllabus.findById(syllabusId).select('offeringId course.code state.header.courseCode').lean();
  if (!syllabus) return;
  const code = syllabus.state?.header?.courseCode ?? null;
  const $set = { 'course.code': code };
  const update = { $set };
  if (syllabus.offeringId) {
    const offering = await CourseOffering.findById(syllabus.offeringId).select('courseCode').lean();
    if (!offering || normCourseCode(offering.courseCode) !== normCourseCode(code)) update.$unset = { offeringId: '' };
    else return;
  }
  await Syllabus.updateOne({ _id: syllabusId }, update);
}

/** Посилання призначення мають існувати: набір — серед Program.editions, викладач — активний користувач. */
async function assertOfferingRefs({ programCode, lecturerId }) {
  if (programCode !== undefined) {
    const code = String(programCode).trim().toUpperCase();
    // Набір програми або програма без наборів (її код сам є кодом довідників і призначень)
    if (!(await Program.exists({ $or: [{ 'editions.code': code }, { code, 'editions.0': { $exists: false } }] }))) {
      throw httpError(400, `Unknown cohort: ${programCode}`, { code: 'UNKNOWN_PROGRAM_CODE' });
    }
  }
  if (lecturerId) {
    const lecturer = await User.findOne({ _id: lecturerId, isActive: { $ne: false } }).select('_id').lean();
    if (!lecturer) throw httpError(400, 'The lecturer does not exist or is inactive', { code: 'UNKNOWN_LECTURER' });
  }
}

const MAX_SYNC_ATTEMPTS = 3;

/**
 * Після зміни призначення: скинути кеш довідників і перерахувати E-поля (courseKind) у силабусах цієї пари.
 * Запис — через store.mutate (знімає approved з зачепленого розділу At a Glance і пише SlotChange).
 * @returns {Promise<number>} скільки силабусів змінилось
 */
async function syncOfferingSyllabi({ programCode, courseCode, offeringId = null, allCourses = false }) {
  invalidateCache();
  const code = String(programCode || '').trim().toUpperCase();
  const wanted = normCourseCode(courseCode);
  const or = [{ programCode: code }];
  if (offeringId) or.push({ offeringId });
  const candidates = await Syllabus.find({ $or: or, state: { $exists: true, $ne: null }, legacy: { $ne: true }, needsRebuild: { $ne: true } })
    .select('_id offeringId programCode state.header.courseCode course.code status').lean();
  const affected = candidates.filter((s) => (allCourses && s.programCode === code)
    || (offeringId && String(s.offeringId) === String(offeringId))
    || normCourseCode(s.state?.header?.courseCode || s.course?.code) === wanted);
  if (!affected.length) return 0;
  const refs = await getRefs(code);
  let changed = 0;
  const failed = [];
  for (const s of affected) {
    if (s.status === 'analyzing') continue; // аналіз сам перерахує стан із свіжими довідниками
    for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
      try {
        const { state: before, revision } = await store.getState(s._id);
        // E-поля перераховує mutate; при зміні courseKind він же в тому самому записі знімає затвердження
        // залежних розділів (store.COURSE_KIND_SECTIONS), тож повтор після STATE_CONFLICT нічого не губить
        const result = await store.mutate(s._id, revision, (st) => st, { source: 'offering', refs });
        if (before.header?.courseKind !== result.state.header?.courseKind) {
          changed += 1;
          invalidateOutputs(s._id);
        }
        break;
      } catch (err) {
        if (err?.code !== 'STATE_CONFLICT' || attempt === MAX_SYNC_ATTEMPTS) {
          console.warn(`offering sync failed for syllabus ${String(s._id)}: ${err.message}`);
          failed.push(String(s._id));
          break;
        }
      }
    }
  }
  // Невдалий перерахунок не мовчить (C07): зміну довідника збережено, повтор того самого запиту перерахує решту
  if (failed.length) {
    throw httpError(503, `The change was saved, but ${failed.length} syllabi could not be updated yet. Repeat the request to finish.`, {
      code: 'SYNC_INCOMPLETE', retryable: true, details: { syllabi: failed },
    });
  }
  return changed;
}

module.exports = {
  normCourseCode, findOfferingFor, resolveOfferingForCreate, assertOfferingFree, offeringTakenError, assertOfferingRefs, syncOfferingSyllabi,
  claimOfferingForCode, courseCodeLockKey, reconcileCourseCode, syncCohortSyllabi,
};
