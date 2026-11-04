#!/usr/bin/env node
/**
 * Міграція v4 → v5 (Syllabus.state як джерело правди; submit і формати виходу прибрано).
 *
 *   - Syllabus програми з `editions` (MBA) без `programCode` → `--default-edition` (за замовчуванням MBA28).
 *   - `status: 'submitted'` → `in_progress`; `submittedAt` переноситься в `legacySubmittedAt`.
 *   - $unset полів submit (`submitting`, `submissionEmailStatus`, `submittedPdfPath`, `submittedAt`)
 *     і кешу outputs старих форматів (clean, tracked, trackedPdf, annotated, edited, previewPdf);
 *     файли цих outputs і `submittedPdfPath` видаляються з диска.
 *   - Suggestion з непорожніми `ops` (v4; також у варіантах choice) видаляються.
 *   - Message.kind `submission-cta` → `text`.
 *   - Syllabus з `document`, але без `state` (не в аналізі) → `needsRebuild: true`
 *     («Rebuild in the new format» = `POST /api/syllabus/:id/analyze`).
 *   - Pre-v4 legacy (`legacy: true`) лишаються read-only; їм теж проставляється `programCode`, знімається статус
 *     `submitted` і поля submit (resend-submission видалено), але `needsRebuild` не ставиться (немає `document`).
 *   - Suggestion з полями v4 (`group`, `docVersion`, `finding`) також видаляються (модель їх більше не має).
 *   - Прибирається решта v4 у Syllabus: `workingFile` (файл видаляється, якщо це не сам оригінал), `rubricSummary`,
 *     `document.{pdfBlockMap,sourceBlocks,sourceDocVersion}`; етапи аналізу v4 (structure…rewrite) → `analysisStage: null`.
 *
 * Idempotent: повторний запуск дає 0 змін. `--dry-run` лише рахує.
 *
 * Usage (з кореня репозиторію):
 *   node scripts/migrate-v5-state.js [--dry-run] [--default-edition=MBA28]
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', 'backend');
const fromBackend = (name) => require(require.resolve(name, { paths: [BACKEND] }));
const Syllabus = require(path.join(BACKEND, 'models/Syllabus'));

const OLD_OUTPUT_KEYS = ['clean', 'tracked', 'trackedPdf', 'annotated', 'edited', 'previewPdf'];
const SUBMIT_FIELDS = ['submitting', 'submissionEmailStatus', 'submittedPdfPath', 'submittedAt'];
const NOT_LEGACY = { legacy: { $ne: true } };
const V4_SYLLABUS_FIELDS = ['workingFile', 'rubricSummary', 'document.pdfBlockMap', 'document.sourceBlocks', 'document.sourceDocVersion'];
const V4_STAGES = ['structure', 'diagnose', 'verify', 'rewrite'];

const oldFilePaths = (doc) => [
  ...OLD_OUTPUT_KEYS.map((k) => doc.outputs?.[k]?.path),
  doc.submittedPdfPath,
].filter(Boolean);

/**
 * @param {import('mongodb').Db} db
 * @param {{dryRun?: boolean, defaultEdition?: string}} opts
 */
async function migrate(db, { dryRun = false, defaultEdition = 'MBA28' } = {}) {
  const syllabi = db.collection(Syllabus.collection.name);
  const programs = db.collection('programs');
  const suggestions = db.collection('suggestions');
  const messages = db.collection('messages');
  const stats = {};
  const edition = String(defaultEdition).toUpperCase();

  // 1. programCode для програм із редакціями
  const editionPrograms = await programs.find({ 'editions.0': { $exists: true } }).project({ _id: 1, editions: 1 }).toArray();
  stats.programCodeSet = 0;
  for (const program of editionPrograms) {
    if (!program.editions.some((e) => e.code === edition)) continue;
    const filter = { programId: program._id, $or: [{ programCode: { $exists: false } }, { programCode: null }, { programCode: '' }] };
    stats.programCodeSet += await syllabi.countDocuments(filter);
    if (!dryRun) await syllabi.updateMany(filter, { $set: { programCode: edition } });
  }

  // 2. submitted → in_progress, поля submit, outputs старих форматів (разом із pre-v4 legacy: статус submitted більше не існує)
  const submitFilter = {
    $or: [
      { status: 'submitted' },
      ...SUBMIT_FIELDS.map((f) => ({ [f]: { $exists: true } })),
      ...OLD_OUTPUT_KEYS.map((k) => ({ [`outputs.${k}`]: { $exists: true } })),
    ],
  };
  stats.statusReset = await syllabi.countDocuments({ status: 'submitted' });
  stats.submitFieldsUnset = await syllabi.countDocuments({ $or: SUBMIT_FIELDS.map((f) => ({ [f]: { $exists: true } })) });
  stats.outputsUnset = await syllabi.countDocuments({ $or: OLD_OUTPUT_KEYS.map((k) => ({ [`outputs.${k}`]: { $exists: true } })) });

  stats.outputFilesDeleted = 0;
  const docs = await syllabi.find(submitFilter).project({ outputs: 1, submittedPdfPath: 1 }).toArray();
  for (const doc of docs) {
    for (const file of new Set(oldFilePaths(doc))) {
      if (!fs.existsSync(file)) continue;
      stats.outputFilesDeleted += 1;
      if (!dryRun) await fs.promises.unlink(file).catch(() => {});
    }
  }

  if (!dryRun && docs.length) {
    await syllabi.updateMany(submitFilter, [
      {
        $set: {
          status: { $cond: [{ $eq: ['$status', 'submitted'] }, 'in_progress', '$status'] },
          legacySubmittedAt: { $ifNull: ['$legacySubmittedAt', { $ifNull: ['$submittedAt', { $cond: [{ $eq: ['$status', 'submitted'] }, '$updatedAt', '$$REMOVE'] }] }] },
        },
      },
      { $unset: [...SUBMIT_FIELDS, ...OLD_OUTPUT_KEYS.map((k) => `outputs.${k}`)] },
    ]);
  }

  // 3. Suggestion v4 (з ops)
  const v4Suggestions = {
    $or: [
      { 'ops.0': { $exists: true } }, { 'options.ops.0': { $exists: true } },
      { group: { $exists: true } }, { docVersion: { $exists: true } }, { finding: { $exists: true } },
    ],
  };
  stats.suggestionsDeleted = await suggestions.countDocuments(v4Suggestions);
  if (!dryRun && stats.suggestionsDeleted) await suggestions.deleteMany(v4Suggestions);

  // 4. submission-cta → text
  const ctaFilter = { kind: 'submission-cta' };
  stats.messagesRemapped = await messages.countDocuments(ctaFilter);
  if (!dryRun && stats.messagesRemapped) await messages.updateMany(ctaFilter, { $set: { kind: 'text' } });

  // 5. v4 без state → needsRebuild
  const rebuildFilter = {
    ...NOT_LEGACY,
    'document.docVersion': { $exists: true },
    $and: [{ $or: [{ state: { $exists: false } }, { state: null }] }],
    status: { $ne: 'analyzing' }, // v5-аналіз ще йде: state з'явиться після парсингу
    needsRebuild: { $ne: true },
  };
  stats.needsRebuildSet = await syllabi.countDocuments(rebuildFilter);
  if (!dryRun && stats.needsRebuildSet) await syllabi.updateMany(rebuildFilter, { $set: { needsRebuild: true } });

  // 6. Решта v4 у Syllabus: робочі файли, підсумок рубрики, поля PDF-мапінгу, етапи аналізу v4
  const v4FieldsFilter = { $or: V4_SYLLABUS_FIELDS.map((f) => ({ [f]: { $exists: true } })) };
  stats.workingFilesDeleted = 0;
  const withWorking = await syllabi.find({ 'workingFile.path': { $type: 'string' } }).project({ workingFile: 1, originalFile: 1 }).toArray();
  for (const doc of withWorking) {
    const file = doc.workingFile.path;
    if (file === doc.originalFile?.path || !fs.existsSync(file)) continue;
    stats.workingFilesDeleted += 1;
    if (!dryRun) await fs.promises.unlink(file).catch(() => {});
  }
  stats.v4FieldsUnset = await syllabi.countDocuments(v4FieldsFilter);
  if (!dryRun && stats.v4FieldsUnset) await syllabi.updateMany(v4FieldsFilter, { $unset: Object.fromEntries(V4_SYLLABUS_FIELDS.map((f) => [f, ''])) });
  const stageFilter = { analysisStage: { $in: V4_STAGES } };
  stats.analysisStageReset = await syllabi.countDocuments(stageFilter);
  if (!dryRun && stats.analysisStageReset) await syllabi.updateMany(stageFilter, { $set: { analysisStage: null } });

  return stats;
}

function parseEdition(argv) {
  const eq = argv.find((a) => a.startsWith('--default-edition='));
  if (eq) return eq.split('=')[1];
  const i = argv.indexOf('--default-edition');
  return i >= 0 ? argv[i + 1] : undefined;
}

async function run() {
  fromBackend('dotenv').config({ path: path.join(BACKEND, '.env') });
  const mongoose = fromBackend('mongoose');
  const dryRun = process.argv.includes('--dry-run');
  const defaultEdition = parseEdition(process.argv) || 'MBA28';
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-syllabus-analyzer';
  console.log(`[migrate-v5-state] connecting to ${uri}${dryRun ? ' (DRY RUN)' : ''}`);
  await mongoose.connect(uri);
  const stats = await migrate(mongoose.connection.db, { dryRun, defaultEdition });
  console.log('[migrate-v5-state] summary:', stats);
  await mongoose.disconnect();
  console.log('[migrate-v5-state] done.');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[migrate-v5-state] failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate };
