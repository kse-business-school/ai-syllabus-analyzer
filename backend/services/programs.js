// Програми та їхні набори (редакції): MBA27, MBA28, EMBA25… Код набору — Syllabus.programCode, за ним
// вибираються довідники (ПРН, нормативні курси, Capstone) і призначення курсів. Нічого не зашито в коді:
// набори додає адміністратор, а довідники нового набору можна скопіювати з попереднього й потім змінити.
//
// Ефективні коди програми — її набори, а якщо наборів немає, то код самої програми (C05). Кожен ефективний
// код належить одній програмі: реєстр ProgramCode з унікальним індексом робить захоплення атомарним.
// Зміни виконуються як «підготувати → застосувати → за помилки відкотити» (C06) під блокуванням програми
// з токеном (services/locks, N01–N04): транзакцій MongoDB (replica set) розгортання не вимагає, тож усе,
// що записано до збою, прибирається явно й лише власником операції.
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
const locks = require('./locks');

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

/**
 * Атомарно займає коди за програмою; за конфлікту звільняє вже зайняті в цьому виклику й кидає 409.
 * З token коди лише резервуються (committed: false) до commitCodes; без token (реєстр) — одразу закомічені.
 * Незакомічене резервування тієї самої програми лишилося від перерваної операції (зміни програми серіалізовані
 * блокуванням) — його переймає поточна операція.
 */
async function claimCodes(programId, codes, { token = null } = {}) {
  const created = [];
  try {
    for (const code of codes) {
      try {
        await ProgramCode.create({ code, programId, token, committed: !token });
        created.push(code);
      } catch (err) {
        if (err?.code !== 11000) throw err;
        const owner = await ProgramCode.findOne({ code }).lean();
        if (String(owner?.programId) !== String(programId)) {
          const program = owner && await Program.findById(owner.programId).select('code').lean();
          throw codeTaken(code, program?.code || 'another programme');
        }
        if (token && owner.committed === false) {
          await ProgramCode.updateOne({ _id: owner._id, committed: false }, { $set: { token } });
          created.push(code);
        }
      }
    }
  } catch (err) {
    await releaseReserved(programId, token, created);
    throw err;
  }
  return created;
}

/** Відкат резервувань операції: лише власні й ще незакомічені (N03). Без token — звичайне звільнення. */
async function releaseReserved(programId, token, codes) {
  if (!codes.length) return;
  if (token) await ProgramCode.deleteMany({ programId, code: { $in: codes }, token, committed: false });
  else await ProgramCode.deleteMany({ programId, code: { $in: codes } });
}

async function releaseCodes(programId, codes) {
  if (codes.length) await ProgramCode.deleteMany({ programId, code: { $in: codes } });
}

const commitCodes = (programId, token) => ProgramCode.updateMany({ programId, token, committed: false }, { $set: { committed: true } });

const STALE_RESERVATION_MS = 10 * 60 * 1000;

/**
 * Реєстр з наявних програм (старт сервера, після сіду): конфлікти лише логуються — їх розв'язує адміністратор.
 * Довершує перервані операції (N02): код, що вже не є ефективним кодом своєї програми (прибраний набір, видалена
 * програма, давнє незакомічене резервування), спершу очищається від довідників і лише потім звільняється.
 */
async function syncCodeRegistry() {
  // Захоплення коду атомарне лише з унікальним індексом; у production autoIndex вимкнено
  try {
    await ProgramCode.createIndexes();
  } catch (err) {
    console.error(`programme code registry: unique index on code is missing (${err.message}); resolve duplicate codes`);
  }
  const programs = await Program.find({}).lean();
  for (const program of programs) {
    try {
      await claimCodes(program._id, effectiveCodes(program));
    } catch (err) {
      console.warn(`programme code registry: ${program.code}: ${err.message}`);
    }
  }
  const staleBefore = new Date(Date.now() - STALE_RESERVATION_MS);
  for (const { _id: rowId, programId, code } of await ProgramCode.find({}).select('_id programId code').lean()) {
    try {
      await locks.withLock(`program:${programId}`, (lock) => finishRegistryRow(rowId, code, staleBefore, lock));
    } catch (err) {
      console.warn(`programme code registry: cleanup of ${code}: ${err.message}`);
    }
  }
}

/**
 * Один рядок реєстру під блокуванням його програми (R01): усе перечитується вже під блокуванням, а довідники коду
 * видаляються лише тоді, коли код не є ефективним кодом жодної програми і на нього не посилаються ні силабуси,
 * ні призначення. Конфлікт реєстру з чинною програмою очистки не запускає — його розв'язує адміністратор.
 */
async function finishRegistryRow(rowId, code, staleBefore, lock) {
  const row = await ProgramCode.findById(rowId).lean();
  if (!row) return;
  const owner = await Program.findById(row.programId).lean();
  if (owner && effectiveCodes(owner).includes(row.code)) {
    if (row.committed === false) await ProgramCode.updateOne({ _id: row._id, committed: false }, { $set: { committed: true } });
    return;
  }
  if (row.committed === false && row.updatedAt > staleBefore) return; // операція, можливо, ще триває
  const claimant = await Program.findOne({ $or: [{ 'editions.code': code }, { code, 'editions.0': { $exists: false } }] }).select('code').lean();
  if (claimant) {
    console.warn(`programme code registry: ${code} is registered to another programme but used by ${claimant.code}; resolve manually`);
    return;
  }
  const [syllabi, offerings] = await Promise.all([Syllabus.countDocuments({ programCode: code }), CourseOffering.countDocuments({ programCode: code })]);
  if (syllabi || offerings) {
    console.warn(`programme code registry: ${code} is not a cohort of any programme but ${syllabi} syllabi and ${offerings} assignments use it; resolve manually`);
    return;
  }
  await purgeCodeReferences(code, lock);
  await locks.assertHeld(lock);
  await ProgramCode.deleteOne({ _id: row._id, code });
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
 * Очистка довідників одного коду під блокуваннями всіх трьох довідників (R01): редактор не пише в них посередині.
 * Блокування програми (programLock) має бути чинним до самого видалення.
 */
async function purgeCodeReferences(code, programLock) {
  const held = [];
  try {
    for (const kind of ['outcomes', 'courses', 'capstone']) held.push(await locks.acquire(`ref:${code}:${kind}`, { code: 'REFERENCE_CONFLICT' }));
    await locks.assertHeld(programLock);
    await deleteReferencesOf([code]);
  } finally {
    await releaseAll(held);
  }
}

/** Звільняє кожне блокування, навіть якщо звільнення іншого впало (R03). */
async function releaseAll(held) {
  for (const lock of held.splice(0)) {
    try {
      await locks.release(lock);
    } catch (err) {
      console.warn(`lock ${lock.key}: release failed (${err.message}); it expires by TTL`);
    }
  }
}

const COPY_KINDS = [
  { kind: 'outcomes', Model: ProgramOutcome },
  { kind: 'courses', Model: ProgramCourse },
  { kind: 'capstone', Model: CapstoneGuide },
];

/**
 * Копіює довідники набору from у набір to (ПРН з мітками, нормативні курси, Capstone) — кожен лише в порожню
 * колекцію набору to і під блокуванням довідника ref:<to>:<kind> (N04), яке тримається до release().
 * Призначення курсів не копіюються: викладачі й дедлайни в кожному наборі свої. Скопійоване позначається
 * ReferenceOverride, щоб сід з фікстур не змішав його з даними фікстури того самого коду.
 * Відкат = видалити всі рядки набору to у скопійованих колекціях: до копіювання їх не було, тож навіть частковий
 * insertMany не лишає рядків.
 * @returns {Promise<{ outcomes: number, courses: number, capstone: number, rollback: () => Promise<void>, release: () => Promise<void> }>}
 */
async function copyEditionReferences(from, to) {
  const src = normCode(from);
  const dst = normCode(to);
  const result = { outcomes: 0, courses: 0, capstone: 0 };
  const held = [];
  const copiedKinds = [];
  const release = () => releaseAll(held);
  const rollback = async () => {
    for (const kind of copiedKinds) {
      const { Model } = COPY_KINDS.find((k) => k.kind === kind);
      const lock = held.find((l) => l.key === `ref:${dst}:${kind}`);
      if (lock && !(await locks.isHeld(lock))) continue; // довідником уже володіє інший запит
      await Model.deleteMany({ programCode: dst });
      await ReferenceOverride.deleteMany({ programCode: dst, kind });
    }
    invalidateCache();
  };
  try {
    for (const { kind, Model } of COPY_KINDS) {
      held.push(await locks.acquire(`ref:${dst}:${kind}`, { code: 'REFERENCE_CONFLICT' }));
      if (await Model.exists({ programCode: dst })) continue;
      const rows = await Model.find({ programCode: src }).lean();
      if (kind === 'capstone') rows.splice(1);
      if (!rows.length) continue;
      copiedKinds.push(kind);
      await Model.insertMany(rows.map((r) => ({ ...strip(r), programCode: dst })));
      await ReferenceOverride.updateOne({ programCode: dst, kind }, { $setOnInsert: { programCode: dst, kind } }, { upsert: true });
      result[kind] = kind === 'capstone' ? 1 : rows.length;
    }
  } catch (err) {
    // R03: блокування звільняються й тоді, коли відкат сам упав
    try {
      await rollback();
    } finally {
      await release();
    }
    throw err;
  }
  invalidateCache();
  return { ...result, rollback, release };
}

/** Усі ефективні коди (для copyFrom можна взяти набір будь-якої програми або код програми без наборів). */
async function knownEditionCodes() {
  const programs = await Program.find({}).select('code editions.code').lean();
  return new Set(programs.flatMap((p) => effectiveCodes(p)));
}

/**
 * Замінює список наборів програми. Порівнюються ефективні коди (C05): перехід «без наборів ↔ з наборами»
 * прибирає або займає код самої програми за тими самими правилами, що й набори.
 * Усе — під блокуванням program:<id> (N03): дві зміни однієї програми не перемежовуються.
 * Порядок: перевірки → зарезервувати нові коди → скопіювати довідники → зберегти програму (CAS за версією —
 * точка коміту) → закомітити коди → очистити довідники прибраних кодів, поки коди ще належать програмі,
 * і лише потім звільнити їх (N02). Збій до коміту відкочує резервування й копії цієї операції; збій очистки
 * після коміту не відкочує збережене — його довершить syncCodeRegistry.
 * @param {{ isNew?: boolean }} opts isNew — щойно створена програма ще не володіє власним кодом
 * @returns {Promise<{ program, copied: Record<string, object> }>}
 */
async function setEditions(programId, rawEditions, opts = {}) {
  const editions = parseEditions(rawEditions);
  return locks.withLock(`program:${programId}`, (lock) => applyEditions(programId, editions, lock, opts), PROGRAM_LOCK);
}

const PROGRAM_LOCK = { message: 'Someone else is changing this programme right now. Refresh and try again.', code: 'PROGRAM_CONFLICT' };

async function applyEditions(programId, editions, lock, { isNew = false } = {}) {
  const program = await Program.findById(programId);
  if (!program) throw httpError(404, 'Programme not found', { code: 'PROGRAM_NOT_FOUND' });
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

  const token = lock.token;
  const claimed = await claimCodes(program._id, added, { token });
  const copies = [];
  const copied = {};
  let saved;
  try {
    try {
      for (const e of toCopy) {
        const copy = await copyEditionReferences(e.copyFrom, e.code);
        copies.push(copy);
        const { rollback, release, ...counts } = copy;
        copied[e.code] = counts;
      }
      await locks.assertHeld(lock);
      saved = await Program.findOneAndUpdate(
        { _id: program._id, __v: program.__v },
        { $set: { editions: editions.map(({ code, label }) => ({ code, label })) }, $inc: { __v: 1 } },
        { new: true, runValidators: true },
      );
      if (!saved) throw httpError(409, 'The programme was changed by someone else. Refresh and try again.', { code: 'PROGRAM_CONFLICT' });
    } catch (err) {
      // Відкат лише своєї операції й лише поки блокування наше
      if (await locks.isHeld(lock)) {
        for (const copy of [...copies].reverse()) {
          await copy.rollback().catch((e) => console.warn(`programme ${program.code}: rollback of a copy failed (${e.message})`));
        }
        await releaseReserved(program._id, token, claimed);
      }
      invalidateCache();
      throw err;
    }
  } finally {
    for (const copy of copies) await copy.release();
  }

  // Після коміту: збої лише логуються, збережений набір не відкочується (N02)
  try {
    await commitCodes(program._id, token);
    for (const code of removed) {
      await purgeCodeReferences(code, lock);
      await locks.assertHeld(lock);
      await releaseCodes(program._id, [code]);
    }
  } catch (err) {
    console.warn(`programme ${program.code}: cleanup after saving cohorts is incomplete (${err.message}); syncCodeRegistry will finish it`);
  }
  invalidateCache();
  return { program: saved, copied };
}

/** Нова програма разом із наборами; будь-яка помилка не лишає ні програми, ні зайнятих кодів, ні копій. */
async function createProgram({ name, code, academicDirectorEmail, editions, defaultLanguage }, { userId } = {}) {
  const programCode = normCode(code);
  if (!name || !programCode) throw httpError(400, 'name and code are required', { code: 'VALIDATION_ERROR' });
  // N11: передані набори перевіряються завжди, до створення програми
  const parsed = editions === undefined || editions === null ? [] : parseEditions(editions);
  const withEditions = parsed.length > 0;
  if (!withEditions) await assertCodesFree(null, [programCode]);
  const program = await Program.create({ name, code: programCode, academicDirectorEmail, defaultLanguage, createdBy: userId, editions: [] });
  try {
    return await locks.withLock(`program:${program._id}`, async (lock) => {
      if (withEditions) return applyEditions(program._id, parsed, lock, { isNew: true });
      await claimCodes(program._id, [programCode]);
      return { program, copied: {} };
    }, PROGRAM_LOCK);
  } catch (err) {
    await Program.deleteOne({ _id: program._id });
    await ProgramCode.deleteMany({ programId: program._id });
    throw err;
  }
}

/**
 * Видалення програми (C14): ні силабусів програми, ні силабусів чи призначень її кодів. Точка коміту — видалення
 * програми; далі очистка довідників і лише потім звільнення кодів (N02). Збій очистки довершить syncCodeRegistry.
 */
async function deleteProgram(programId) {
  return locks.withLock(`program:${programId}`, async (lock) => {
    const program = await Program.findById(programId).lean();
    if (!program) throw httpError(404, 'Programme not found', { code: 'PROGRAM_NOT_FOUND' });
    const used = await Syllabus.countDocuments({ programId });
    if (used) throw httpError(409, `This programme cannot be deleted: syllabi refer to it (${used})`, { code: 'PROGRAM_IN_USE' });
    const owned = (await ProgramCode.find({ programId }).lean()).map((c) => c.code);
    const codes = [...new Set([...effectiveCodes(program), ...owned])];
    await assertRemovable(codes);
    await locks.assertHeld(lock);
    await Program.deleteOne({ _id: programId });
    try {
      for (const code of codes) {
        await purgeCodeReferences(code, lock);
        await locks.assertHeld(lock);
        await ProgramCode.deleteMany({ programId, code });
      }
    } catch (err) {
      console.warn(`programme ${program.code}: cleanup after deletion is incomplete (${err.message}); syncCodeRegistry will finish it`);
    }
    invalidateCache();
  }, PROGRAM_LOCK);
}

module.exports = {
  parseEditions, setEditions, createProgram, deleteProgram, copyEditionReferences, assertCodesFree, assertRemovable,
  claimCodes, releaseCodes, syncCodeRegistry, effectiveCodes,
};
