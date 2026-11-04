#!/usr/bin/env node
/**
 * Міграція: призначення курсу до набору (CourseOffering, ТЗ доповнення 29.10 §3).
 *
 *   - З кожного силабуса з programCode і кодом курсу створює CourseOffering
 *     (type = state.header.courseKind, lecturerId = автор силабуса), якщо такого ще немає.
 *   - Проставляє Syllabus.offeringId там, де його немає.
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
  const stats = { offeringsCreated: 0, syllabiLinked: 0, skippedNoCode: 0 };

  const cursor = Syllabus.find({ programCode: { $exists: true, $ne: null } })
    .select('programCode course instructor offeringId state.header.courseKind').lean().cursor();
  for await (const s of cursor) {
    const courseCode = String(s.course?.code || '').trim();
    if (!courseCode) { stats.skippedNoCode += 1; continue; }
    let offering = await CourseOffering.findOne({ programCode: s.programCode, courseCode }).select('_id').lean();
    if (!offering) {
      stats.offeringsCreated += 1;
      if (!dryRun) {
        offering = await CourseOffering.create({
          programCode: s.programCode,
          courseCode,
          courseName: s.course?.name || '',
          type: s.state?.header?.courseKind === 'core' ? 'core' : 'elective',
          lecturerId: s.instructor || null,
        });
      }
    }
    if (!s.offeringId && offering) {
      stats.syllabiLinked += 1;
      if (!dryRun) await Syllabus.updateOne({ _id: s._id }, { $set: { offeringId: offering._id } });
    } else if (!s.offeringId && dryRun) {
      stats.syllabiLinked += 1;
    }
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
