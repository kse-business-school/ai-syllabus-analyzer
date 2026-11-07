#!/usr/bin/env node
/**
 * Міграція: призначення курсу до набору (CourseOffering, ТЗ доповнення 29.10 §3).
 *
 *   - З кожного силабуса з programCode і кодом курсу створює CourseOffering
 *     (type = state.header.courseKind, lecturerId = автор силабуса), якщо такого ще немає.
 *   - Проставляє Syllabus.offeringId там, де його немає. Пара курс × набір має один силабус (унікальний
 *     індекс Syllabus.offeringId): прив'язується найсвіжіший силабус автора-викладача призначення; решта
 *     (дублікати й чужі силабуси) лишаються без offeringId і рахуються в skippedDuplicate.
 *
 *   - Дозаповнює CourseOffering.courseKey (нормалізований код курсу, C09). Призначення, що після нормалізації
 *     збігаються з уже наявним у тому ж наборі («foreign.1» і «FOREIGN.1»), лишаються без ключа й
 *     рахуються в duplicateOfferings — їх треба звести вручну.
 *
 * Idempotent. `--dry-run` лише показує кількість змін.
 *
 * Usage (з кореня репозиторію):
 *   node scripts/migrate-v5-offerings.js [--dry-run]
 */

const path = require('path');

const BACKEND = path.join(__dirname, '..', 'backend');
const fromBackend = (name) => require(require.resolve(name, { paths: [BACKEND] }));

/** @param {{dryRun?: boolean}} opts  Потребує підключеного mongoose. */
async function migrate({ dryRun = false } = {}) {
  const Syllabus = require(path.join(BACKEND, 'models/Syllabus'));
  const CourseOffering = require(path.join(BACKEND, 'models/CourseOffering'));
  const stats = { offeringsCreated: 0, syllabiLinked: 0, skippedNoCode: 0, skippedDuplicate: 0, courseKeysSet: 0, duplicateOfferings: 0 };
  const { courseKeyOf } = CourseOffering;

  // 0. courseKey для старих призначень (за датою створення: перше лишається основним)
  const keyed = new Set((await CourseOffering.find({ courseKey: { $type: 'string' } }).select('programCode courseKey').lean())
    .map((o) => `${o.programCode}|${o.courseKey}`));
  for (const o of await CourseOffering.find({ $or: [{ courseKey: null }, { courseKey: { $exists: false } }] }).sort({ createdAt: 1, _id: 1 }).lean()) {
    const key = `${o.programCode}|${courseKeyOf(o.courseCode)}`;
    if (keyed.has(key)) { stats.duplicateOfferings += 1; continue; }
    keyed.add(key);
    stats.courseKeysSet += 1;
    if (!dryRun) await CourseOffering.updateOne({ _id: o._id }, { $set: { courseKey: courseKeyOf(o.courseCode) } });
  }
  // Призначення, вже зайняті в цьому прогоні (dry-run не пише в БД, тож рахуємо тут)
  const linked = new Set((await Syllabus.distinct('offeringId', { offeringId: { $ne: null } })).map(String));
  const created = new Map(); // dry-run: programCode|courseCode → lecturerId створеного призначення

  const cursor = Syllabus.find({ programCode: { $exists: true, $ne: null } })
    .sort({ updatedAt: -1, _id: -1 })
    .select('programCode course instructor offeringId state.header.courseKind').lean().cursor();
  for await (const s of cursor) {
    const courseCode = String(s.course?.code || '').trim();
    if (!courseCode) { stats.skippedNoCode += 1; continue; }
    const key = `${s.programCode}|${courseKeyOf(courseCode)}`;
    if (s.offeringId) continue;
    // Пошук за нормалізованим кодом, як при створенні силабуса (services/offerings.findOfferingFor)
    let offering = (await CourseOffering.find({ programCode: s.programCode }).select('_id lecturerId courseCode createdAt').sort({ createdAt: 1, _id: 1 }).lean())
      .find((o) => courseKeyOf(o.courseCode) === courseKeyOf(courseCode)) || null;
    if (!offering && dryRun && created.has(key)) offering = { _id: key, lecturerId: created.get(key) };
    if (!offering) {
      stats.offeringsCreated += 1;
      if (dryRun) {
        created.set(key, s.instructor || null);
        offering = { _id: key, lecturerId: s.instructor || null };
      } else {
        offering = await CourseOffering.create({
          programCode: s.programCode,
          courseCode,
          courseName: s.course?.name || '',
          type: s.state?.header?.courseKind === 'core' ? 'core' : 'elective',
          lecturerId: s.instructor || null,
        });
      }
    }
    const id = String(offering._id);
    const ownAuthor = !offering.lecturerId || String(offering.lecturerId) === String(s.instructor);
    const taken = linked.has(id) || (!dryRun && await Syllabus.exists({ offeringId: offering._id }));
    if (taken || !ownAuthor) { stats.skippedDuplicate += 1; continue; }
    linked.add(id);
    stats.syllabiLinked += 1;
    if (!dryRun) await Syllabus.updateOne({ _id: s._id, offeringId: null }, { $set: { offeringId: offering._id } });
  }
  return stats;
}

async function run() {
  fromBackend('dotenv').config({ path: path.join(BACKEND, '.env') });
  const mongoose = fromBackend('mongoose');
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-syllabus-analyzer';
  console.log(`[migrate-v5-offerings] connecting to ${uri}${dryRun ? ' (DRY RUN)' : ''}`);
  await mongoose.connect(uri);
  console.log('[migrate-v5-offerings] summary:', await migrate({ dryRun }));
  await mongoose.disconnect();
  console.log('[migrate-v5-offerings] done.');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[migrate-v5-offerings] failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate };
