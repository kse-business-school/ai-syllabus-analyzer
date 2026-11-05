// Програми та їхні набори (редакції): MBA27, MBA28, EMBA25… Код набору — Syllabus.programCode, за ним
// вибираються довідники (ПРН, нормативні курси, Capstone) і призначення курсів. Нічого не зашито в коді:
// набори додає адміністратор, а довідники нового набору можна скопіювати з попереднього й потім змінити.
//
// Ефективні коди програми — її набори, а якщо наборів немає, то код самої програми (C05). Кожен ефективний
// код належить одній програмі: реєстр ProgramCode з унікальним індексом робить захоплення атомарним.
// Зміни виконуються як «підготувати → застосувати → за помилки відкотити» (C06): транзакцій MongoDB
// (replica set) розгортання не вимагає, тож усе, що записано до збою, прибирається явно.
const Program = require('../models/Program');
const ProgramCode = require('../models/ProgramCode');
const Syllabus = require('../models/Syllabus');
const CourseOffering = require('../models/CourseOffering');
const ProgramOutcome = require('../models/ProgramOutcome');
const ProgramCourse = require('../models/ProgramCourse');
const CapstoneGuide = require('../models/CapstoneGuide');
const ReferenceOverride = require('../models/ReferenceOverride');
const { invalidateCache } = require('./references');
const { httpError } = require('../utils/httpError');

const { EDITION_CODE_RE } = Program;
const MAX_EDITIONS = 50;
const normCode = (code) => String(code || '').trim().toUpperCase();
const strip = ({ _id, __v, createdAt, updatedAt, ...rest }) => rest;

/** Коди довідників програми: набори або (без наборів) код самої програми. */
const effectiveCodes = (program, editions = program.editions) => (editions?.length ? editions.map((e) => normCode(e.code)) : [normCode(program.code)]);

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

const codeTaken = (code, owner) => httpError(409, `Cohort code ${code} is already used by programme ${owner}`, { code: 'EDITION_CODE_TAKEN' });

/** Код не належить іншій програмі ні в реєстрі, ні в даних програм (реєстр може бути ще не синхронізований). */
async function assertCodesFree(programId, codes) {
  if (!codes.length) return;
  const registered = await ProgramCode.findOne({ code: { $in: codes }, programId: { $ne: programId } }).lean();
  if (registered) {
    const owner = await Program.findById(registered.programId).select('code').lean();
    throw codeTaken(registered.code, owner?.code || 'another programme');
  }
  const clash = await Program.findOne({
    _id: { $ne: programId },
    $or: [{ 'editions.code': { $in: codes } }, { code: { $in: codes }, 'editions.0': { $exists: false } }],
  }).select('code editions.code').lean();
  if (clash) {
    const code = codes.find((c) => c === clash.code || (clash.editions || []).some((e) => e.code === c));
    throw codeTaken(code, clash.code);
  }
}

/** Атомарно займає коди за програмою; за конфлікту звільняє вже зайняті в цьому виклику й кидає 409. */
async function claimCodes(programId, codes) {
  const created = [];
  try {
    for (const code of codes) {
      try {
        await ProgramCode.create({ code, programId });
        created.push(code);
      } catch (err) {
        if (err?.code !== 11000) throw err;
        const owner = await ProgramCode.findOne({ code }).lean();
        if (String(owner?.programId) !== String(programId)) {
          const program = owner && await Program.findById(owner.programId).select('code').lean();
          throw codeTaken(code, program?.code || 'another programme');
        }
      }
    }
  } catch (err) {
    await releaseCodes(programId, created);
    throw err;
  }
  return created;
}

async function releaseCodes(programId, codes) {
  if (codes.length) await ProgramCode.deleteMany({ programId, code: { $in: codes } });
}

/** Реєстр з наявних програм (старт сервера, після сіду): конфлікти лише логуються — їх розв'язує адміністратор. */
async function syncCodeRegistry() {
  for (const program of await Program.find({}).lean()) {
    try {
      await claimCodes(program._id, effectiveCodes(program));
    } catch (err) {
      console.warn(`programme code registry: ${program.code}: ${err.message}`);
    }
  }
}

/** Код, на який посилаються силабуси чи призначення курсів, прибрати не можна. */
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

/** Довідники прибраного коду (він уже не використовується): ПРН, курси, Capstone, позначки ручних правок. */
async function deleteReferencesOf(codes) {
  if (!codes.length) return;
  const filter = { programCode: { $in: codes } };
  await Promise.all([ProgramOutcome.deleteMany(filter), ProgramCourse.deleteMany(filter), CapstoneGuide.deleteMany(filter), ReferenceOverride.deleteMany(filter)]);
}

/**
 * Копіює довідники набору from у набір to (ПРН з мітками, нормативні курси, Capstone), лише якщо в to їх ще немає.
 * Призначення курсів не копіюються: викладачі й дедлайни в кожному наборі свої. Скопійоване позначається
 * ReferenceOverride, щоб сід з фікстур не змішав його з даними фікстури того самого коду.
 * Помилка посередині прибирає все, що цей виклик уже записав.
 * @returns {Promise<{ outcomes: number, courses: number, capstone: number, rollback: () => Promise<void> }>}
 */
async function copyEditionReferences(from, to) {
  const src = normCode(from);
  const dst = normCode(to);
  const result = { outcomes: 0, courses: 0, capstone: 0 };
  const written = { outcomes: [], courses: [], capstone: [], overrides: [] };
  const rollback = async () => {
    await Promise.all([
      ProgramOutcome.deleteMany({ _id: { $in: written.outcomes } }), ProgramCourse.deleteMany({ _id: { $in: written.courses } }),
      CapstoneGuide.deleteMany({ _id: { $in: written.capstone } }), ReferenceOverride.deleteMany({ _id: { $in: written.overrides } }),
    ]);
    invalidateCache();
  };
  const mark = async (kind) => {
    const res = await ReferenceOverride.updateOne({ programCode: dst, kind }, { $setOnInsert: { programCode: dst, kind } }, { upsert: true });
    if (res.upsertedId) written.overrides.push(res.upsertedId);
  };
  try {
    if (!(await ProgramOutcome.exists({ programCode: dst }))) {
      const rows = await ProgramOutcome.find({ programCode: src }).lean();
      if (rows.length) {
        written.outcomes.push(...(await ProgramOutcome.insertMany(rows.map((r) => ({ ...strip(r), programCode: dst })))).map((d) => d._id));
        await mark('outcomes');
      }
      result.outcomes = rows.length;
    }
    if (!(await ProgramCourse.exists({ programCode: dst }))) {
      const rows = await ProgramCourse.find({ programCode: src }).lean();
      if (rows.length) {
        written.courses.push(...(await ProgramCourse.insertMany(rows.map((r) => ({ ...strip(r), programCode: dst })))).map((d) => d._id));
        await mark('courses');
      }
      result.courses = rows.length;
    }
    if (!(await CapstoneGuide.exists({ programCode: dst }))) {
      const guide = await CapstoneGuide.findOne({ programCode: src }).lean();
      if (guide) {
        written.capstone.push((await CapstoneGuide.create({ ...strip(guide), programCode: dst }))._id);
        await mark('capstone');
        result.capstone = 1;
      }
    }
  } catch (err) {
    await rollback();
    throw err;
  }
  invalidateCache();
  return { ...result, rollback };
}

/** Усі ефективні коди (для copyFrom можна взяти набір будь-якої програми або код програми без наборів). */
async function knownEditionCodes() {
  const programs = await Program.find({}).select('code editions.code').lean();
  return new Set(programs.flatMap((p) => effectiveCodes(p)));
}

/**
 * Замінює список наборів програми. Порівнюються ефективні коди (C05): перехід «без наборів ↔ з наборами»
 * прибирає або займає код самої програми за тими самими правилами, що й набори.
 * Порядок: перевірки → зайняти нові коди → скопіювати довідники → зберегти програму (умова на версію) →
 * звільнити й очистити прибрані коди. Збій до збереження відкочує коди й копії (C06).
 * @param {{ isNew?: boolean }} opts isNew — щойно створена програма ще не володіє власним кодом
 * @returns {Promise<{ program, copied: Record<string, object> }>}
 */
async function setEditions(programId, rawEditions, { isNew = false } = {}) {
  const program = await Program.findById(programId);
  if (!program) throw httpError(404, 'Programme not found', { code: 'PROGRAM_NOT_FOUND' });
  const editions = parseEditions(rawEditions);
  const before = new Set(isNew && !program.editions?.length ? [] : effectiveCodes(program));
  const after = effectiveCodes(program, editions);
  const added = after.filter((c) => !before.has(c));
  const removed = [...before].filter((c) => !after.includes(c));
  await assertCodesFree(program._id, added);
  await assertRemovable(removed);
  const known = await knownEditionCodes();
  const toCopy = editions.filter((e) => e.copyFrom && added.includes(e.code));
  for (const e of toCopy) {
    if (!known.has(e.copyFrom)) {
      throw httpError(400, `Unknown cohort to copy from: ${e.copyFrom}`, { code: 'UNKNOWN_PROGRAM_CODE' });
    }
  }

  const claimed = await claimCodes(program._id, added);
  const copies = [];
  const copied = {};
  try {
    for (const e of toCopy) {
      const { rollback, ...counts } = await copyEditionReferences(e.copyFrom, e.code);
      copies.push(rollback);
      copied[e.code] = counts;
    }
    const saved = await Program.findOneAndUpdate(
      { _id: program._id, __v: program.__v },
      { $set: { editions: editions.map(({ code, label }) => ({ code, label })) }, $inc: { __v: 1 } },
      { new: true, runValidators: true },
    );
    if (!saved) throw httpError(409, 'The programme was changed by someone else. Refresh and try again.', { code: 'PROGRAM_CONFLICT' });
    await releaseCodes(program._id, removed);
    await deleteReferencesOf(removed);
    invalidateCache();
    return { program: saved, copied };
  } catch (err) {
    for (const rollback of copies.reverse()) await rollback();
    await releaseCodes(program._id, claimed);
    invalidateCache();
    throw err;
  }
}

/** Нова програма разом із наборами; будь-яка помилка не лишає ні програми, ні зайнятих кодів, ні копій. */
async function createProgram({ name, code, academicDirectorEmail, editions }, { userId } = {}) {
  const programCode = normCode(code);
  if (!name || !programCode) throw httpError(400, 'name and code are required', { code: 'VALIDATION_ERROR' });
  const withEditions = Array.isArray(editions) && editions.length > 0;
  if (!withEditions) await assertCodesFree(null, [programCode]);
  const program = await Program.create({ name, code: programCode, academicDirectorEmail, createdBy: userId, editions: [] });
  try {
    if (withEditions) return await setEditions(program._id, editions, { isNew: true });
    await claimCodes(program._id, [programCode]);
    return { program, copied: {} };
  } catch (err) {
    await Program.deleteOne({ _id: program._id });
    await ProgramCode.deleteMany({ programId: program._id });
    throw err;
  }
}

/** Видалення програми (C14): ні силабусів програми, ні силабусів чи призначень її кодів; потім очистка кодів і довідників. */
async function deleteProgram(programId) {
  const program = await Program.findById(programId).lean();
  if (!program) throw httpError(404, 'Programme not found', { code: 'PROGRAM_NOT_FOUND' });
  const used = await Syllabus.countDocuments({ programId });
  if (used) throw httpError(409, `This programme cannot be deleted: syllabi refer to it (${used})`, { code: 'PROGRAM_IN_USE' });
  const owned = (await ProgramCode.find({ programId }).lean()).map((c) => c.code);
  const codes = [...new Set([...effectiveCodes(program), ...owned])];
  await assertRemovable(codes);
  await Program.deleteOne({ _id: programId });
  await ProgramCode.deleteMany({ programId });
  await deleteReferencesOf(codes);
  invalidateCache();
}

module.exports = {
  parseEditions, setEditions, createProgram, deleteProgram, copyEditionReferences, assertCodesFree, assertRemovable,
  claimCodes, releaseCodes, syncCodeRegistry, effectiveCodes,
};
