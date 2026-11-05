#!/usr/bin/env node
/**
 * Міграція довідників v5 (етап 1 ТЗ).
 *
 *   - Програми з fixtures/reference/programs.json: додає набори (editions), яких ще немає, не затираючи наявні.
 *   - Сідить довідники (шаблон, ПРН, курси, Capstone) з backend/fixtures/reference.
 *   - Syllabus програми з `editions` без `programCode` → `--default-edition`, якщо цей набір належить програмі,
 *     інакше найновіший набір цієї програми (останній у списку); `track` = upload для тих, де його немає.
 *
 * Idempotent. `--dry-run` лише показує кількість змін.
 *
 * Usage (з кореня репозиторію):
 *   node scripts/migrate-v5-references.js [--dry-run] [--default-edition=<код набору>]
 */

const path = require('path');

const BACKEND = path.join(__dirname, '..', 'backend');
const fromBackend = (name) => require(require.resolve(name, { paths: [BACKEND] }));

/**
 * @param {{dryRun?: boolean, defaultEdition?: string}} opts
 * Працює через mongoose-моделі backend (підключення має бути встановлене).
 */
async function migrate({ dryRun = false, defaultEdition = null } = {}) {
  const Program = require(path.join(BACKEND, 'models/Program'));
  const Syllabus = require(path.join(BACKEND, 'models/Syllabus'));
  const { seedReferences } = require(path.join(BACKEND, 'services/references/seed'));
  const { DEFAULT_PROGRAMS, latestEdition } = Program;
  const stats = {};
  const wanted = defaultEdition ? String(defaultEdition).toUpperCase() : null;

  stats.editionsAdded = 0;
  for (const def of DEFAULT_PROGRAMS.filter((p) => p.editions)) {
    const program = await Program.findOne({ code: def.code }).lean();
    if (!program) continue; // створить seedDefaults при старті сервера
    const have = new Set((program.editions || []).map((e) => e.code));
    const missing = def.editions.filter((e) => !have.has(e.code));
    stats.editionsAdded += missing.length;
    if (!dryRun && missing.length) {
      await Program.updateOne({ _id: program._id }, { $push: { editions: { $each: missing } } });
    }
  }

  if (!dryRun) await seedReferences();
  stats.referencesSeeded = !dryRun;

  // Кожна програма з наборами отримує свій набір: заданий (якщо належить їй) або найновіший
  // dry-run набори не додає, тож рахуємо за тим, якими набори стануть після кроку вище
  const fixtureEditions = new Map(DEFAULT_PROGRAMS.filter((p) => p.editions?.length).map((p) => [p.code, p.editions]));
  const withEditions = (await Program.find({}).lean()).map((p) => {
    const have = p.editions || [];
    const extra = (fixtureEditions.get(p.code) || []).filter((e) => !have.some((h) => h.code === e.code));
    return { ...p, editions: [...have, ...extra] };
  }).filter((p) => p.editions.length);
  stats.syllabiProgramCodeSet = 0;
  for (const program of withEditions) {
    const edition = wanted && program.editions.some((e) => e.code === wanted) ? wanted : latestEdition(program);
    const filter = {
      programId: program._id,
      $or: [{ programCode: { $exists: false } }, { programCode: null }, { programCode: '' }],
    };
    const n = await Syllabus.countDocuments(filter);
    stats.syllabiProgramCodeSet += n;
    if (!dryRun && n) await Syllabus.collection.updateMany(filter, { $set: { programCode: edition } });
  }
  const trackFilter = { track: { $exists: false } };
  stats.syllabiTrackSet = await Syllabus.countDocuments(trackFilter);
  if (!dryRun && stats.syllabiTrackSet) {
    await Syllabus.collection.updateMany(trackFilter, { $set: { track: 'upload' } });
  }
  return stats;
}

async function run() {
  fromBackend('dotenv').config({ path: path.join(BACKEND, '.env') });
  const mongoose = fromBackend('mongoose');
  const dryRun = process.argv.includes('--dry-run');
  const arg = process.argv.find((a) => a.startsWith('--default-edition='));
  const defaultEdition = arg ? arg.split('=')[1] : null;
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-syllabus-analyzer';
  console.log(`[migrate-v5-references] connecting to ${uri}${dryRun ? ' (DRY RUN)' : ''}`);
  await mongoose.connect(uri);
  const stats = await migrate({ dryRun, defaultEdition });
  console.log('[migrate-v5-references] summary:', stats);
  await mongoose.disconnect();
  console.log('[migrate-v5-references] done.');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[migrate-v5-references] failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate };
