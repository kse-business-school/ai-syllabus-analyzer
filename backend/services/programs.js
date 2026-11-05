// Програми та їхні набори (редакції): MBA27, MBA28, EMBA25… Код набору — Syllabus.programCode, за ним
// вибираються довідники (ПРН, нормативні курси, Capstone) і призначення курсів. Нічого не зашито в коді:
// набори додає адміністратор, а довідники нового набору можна скопіювати з попереднього й потім змінити.
const Program = require('../models/Program');
const Syllabus = require('../models/Syllabus');
const CourseOffering = require('../models/CourseOffering');
const ProgramOutcome = require('../models/ProgramOutcome');
const ProgramCourse = require('../models/ProgramCourse');
const CapstoneGuide = require('../models/CapstoneGuide');
const { invalidateCache } = require('./references');
const { httpError } = require('../utils/httpError');

const { EDITION_CODE_RE } = Program;
const MAX_EDITIONS = 50;
const normCode = (code) => String(code || '').trim().toUpperCase();
const strip = ({ _id, __v, createdAt, updatedAt, ...rest }) => rest;

/** Нормалізує й перевіряє список наборів: [{ code, label, copyFrom? }]. */
function parseEditions(raw) {
  if (!Array.isArray(raw)) throw httpError(400, 'editions must be an array', { code: 'INVALID_EDITIONS' });
  if (raw.length > MAX_EDITIONS) throw httpError(400, `A programme can have at most ${MAX_EDITIONS} cohorts`, { code: 'INVALID_EDITIONS' });
  const seen = new Set();
  return raw.map((e) => {
    const code = normCode(e?.code);
    if (!EDITION_CODE_RE.test(code)) {
      throw httpError(400, `Invalid cohort code "${e?.code ?? ''}": use letters, digits, ".", "-" or "_" (up to 32 characters)`, { code: 'INVALID_EDITION_CODE' });
    }
    if (seen.has(code)) throw httpError(400, `Cohort ${code} is listed twice`, { code: 'DUPLICATE_EDITION' });
    seen.add(code);
    const copyFrom = e?.copyFrom ? normCode(e.copyFrom) : null;
    return { code, label: String(e?.label ?? '').trim().slice(0, 120), copyFrom };
  });
}

/** Код набору ідентифікує довідники глобально: він не може належати іншій програмі (ні як набір, ні як код програми). */
async function assertCodesFree(programId, codes) {
  if (!codes.length) return;
  const clash = await Program.findOne({
    _id: { $ne: programId },
    $or: [{ 'editions.code': { $in: codes } }, { code: { $in: codes }, 'editions.0': { $exists: false } }],
  }).select('code editions.code').lean();
  if (clash) {
    const code = codes.find((c) => c === clash.code || (clash.editions || []).some((e) => e.code === c));
    throw httpError(409, `Cohort code ${code} is already used by programme ${clash.code}`, { code: 'EDITION_CODE_TAKEN' });
  }
}

/** Набір, на який посилаються силабуси чи призначення курсів, прибрати не можна. */
async function assertRemovable(codes) {
  for (const code of codes) {
    const [syllabi, offerings] = await Promise.all([
      Syllabus.countDocuments({ programCode: code }), CourseOffering.countDocuments({ programCode: code }),
    ]);
    if (syllabi || offerings) {
      throw httpError(409, `Cohort ${code} cannot be removed: ${syllabi} syllabi and ${offerings} course assignments refer to it`, {
        code: 'EDITION_IN_USE', details: { edition: code, syllabi, offerings },
      });
    }
  }
}

/**
 * Копіює довідники набору from у набір to (ПРН з мітками, нормативні курси, Capstone), лише якщо в to їх ще немає.
 * Призначення курсів не копіюються: викладачі й дедлайни в кожному наборі свої.
 * @returns {Promise<{ outcomes: number, courses: number, capstone: number }>}
 */
async function copyEditionReferences(from, to) {
  const src = normCode(from);
  const dst = normCode(to);
  const result = { outcomes: 0, courses: 0, capstone: 0 };
  if (!(await ProgramOutcome.exists({ programCode: dst }))) {
    const rows = await ProgramOutcome.find({ programCode: src }).lean();
    if (rows.length) await ProgramOutcome.insertMany(rows.map((r) => ({ ...strip(r), programCode: dst })));
    result.outcomes = rows.length;
  }
  if (!(await ProgramCourse.exists({ programCode: dst }))) {
    const rows = await ProgramCourse.find({ programCode: src }).lean();
    if (rows.length) await ProgramCourse.insertMany(rows.map((r) => ({ ...strip(r), programCode: dst })));
    result.courses = rows.length;
  }
  if (!(await CapstoneGuide.exists({ programCode: dst }))) {
    const guide = await CapstoneGuide.findOne({ programCode: src }).lean();
    if (guide) {
      await CapstoneGuide.create({ ...strip(guide), programCode: dst });
      result.capstone = 1;
    }
  }
  invalidateCache();
  return result;
}

/** Усі відомі коди наборів (для copyFrom можна взяти набір будь-якої програми). */
async function knownEditionCodes() {
  const programs = await Program.find({}).select('code editions.code').lean();
  return new Set(programs.flatMap((p) => (p.editions?.length ? p.editions.map((e) => e.code) : [p.code])));
}

/**
 * Замінює список наборів програми. Нові набори з copyFrom отримують копію довідників цього набору.
 * @returns {Promise<{ program, copied: Record<string, object> }>}
 */
async function setEditions(programId, rawEditions) {
  const program = await Program.findById(programId);
  if (!program) throw httpError(404, 'Programme not found', { code: 'PROGRAM_NOT_FOUND' });
  const editions = parseEditions(rawEditions);
  const before = new Set((program.editions || []).map((e) => e.code));
  const after = new Set(editions.map((e) => e.code));
  const added = editions.filter((e) => !before.has(e.code));
  const removed = [...before].filter((c) => !after.has(c));
  await assertCodesFree(program._id, added.map((e) => e.code));
  await assertRemovable(removed);
  const known = await knownEditionCodes();
  for (const e of added) {
    if (e.copyFrom && !known.has(e.copyFrom)) throw httpError(400, `Unknown cohort to copy from: ${e.copyFrom}`, { code: 'UNKNOWN_PROGRAM_CODE' });
  }

  program.editions = editions.map(({ code, label }) => ({ code, label }));
  await program.save();
  const copied = {};
  for (const e of added.filter((x) => x.copyFrom)) copied[e.code] = await copyEditionReferences(e.copyFrom, e.code);
  invalidateCache();
  return { program, copied };
}

module.exports = { parseEditions, setEditions, copyEditionReferences, assertCodesFree, assertRemovable };
