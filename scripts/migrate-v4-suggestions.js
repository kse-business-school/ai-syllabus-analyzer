#!/usr/bin/env node
/**
 * Міграція на v4 (пропозиції в окремій колекції, модель документа з блоками).
 *
 *   - Syllabus без `document.docVersion` → `legacy: true`; `recommendations` → `legacyRecommendations`
 *     (історія рішень лишається в БД для аудиту). Чат таких силабусів лише читається,
 *     мутації повертають 409 LEGACY_SYLLABUS.
 *   - Syllabus: $unset editedText, revisionMarkup, previewPdf, structure, analysis, editingStatus,
 *     recommendations (для нових — порожні).
 *   - Message.kind `before-after` | `choice` | `case-cards` → `text` (content лишається для історії).
 *   - Conversation: $unset currentIssueId, readiness (старі ваги/блоки; readiness рахується заново).
 *
 * Idempotent: можна запускати повторно. `--dry-run` лише показує кількість змін.
 *
 * Usage (з кореня репозиторію):
 *   node scripts/migrate-v4-suggestions.js [--dry-run]
 */

const path = require('path');

const BACKEND = path.join(__dirname, '..', 'backend');
const fromBackend = (name) => require(require.resolve(name, { paths: [BACKEND] }));
const Syllabus = require(path.join(BACKEND, 'models/Syllabus'));

const REMOVED_SYLLABUS_FIELDS = ['editedText', 'revisionMarkup', 'previewPdf', 'structure', 'analysis', 'editingStatus'];
const OLD_MESSAGE_KINDS = ['before-after', 'choice', 'case-cards'];

async function count(collection, filter) {
  return collection.countDocuments(filter);
}

/**
 * @param {import('mongodb').Db} db
 * @param {{dryRun?: boolean}} opts
 */
async function migrate(db, { dryRun = false } = {}) {
  const syllabi = db.collection(Syllabus.collection.name);
  const messages = db.collection('messages');
  const conversations = db.collection('conversations');
  const stats = {};

  // Нові завантаження (v4) мають sourceFormat ще до розбору документа — їх не чіпаємо
  const legacyFilter = { 'document.docVersion': { $exists: false }, sourceFormat: { $exists: false }, legacy: { $ne: true } };
  stats.syllabiMarkedLegacy = await count(syllabi, legacyFilter);
  if (!dryRun && stats.syllabiMarkedLegacy) {
    await syllabi.updateMany(legacyFilter, { $set: { legacy: true } });
  }

  // У dry-run legacy ще не проставлено, тож враховуємо і ті, що стануть legacy
  const renameFilter = {
    recommendations: { $exists: true },
    legacyRecommendations: { $exists: false },
    $or: [{ legacy: true }, { 'document.docVersion': { $exists: false }, sourceFormat: { $exists: false } }],
  };
  stats.recommendationsArchived = await count(syllabi, renameFilter);
  if (!dryRun && stats.recommendationsArchived) {
    await syllabi.updateMany(renameFilter, { $rename: { recommendations: 'legacyRecommendations' } });
  }

  const unsetFields = [...REMOVED_SYLLABUS_FIELDS, 'recommendations'];
  const unsetFilter = { $or: unsetFields.map((f) => ({ [f]: { $exists: true } })) };
  stats.syllabiFieldsUnset = await count(syllabi, unsetFilter);
  if (!dryRun && stats.syllabiFieldsUnset) {
    await syllabi.updateMany(unsetFilter, { $unset: Object.fromEntries(unsetFields.map((f) => [f, ''])) });
  }

  const messageFilter = { kind: { $in: OLD_MESSAGE_KINDS } };
  stats.messagesRemapped = await count(messages, messageFilter);
  if (!dryRun && stats.messagesRemapped) {
    await messages.updateMany(messageFilter, { $set: { kind: 'text' } });
  }

  const convFilter = {
    $or: [
      { currentIssueId: { $exists: true } },
      { 'readiness.weights': { $exists: true } },
      { 'readiness.breakdown.templateCompliance': { $exists: true } },
    ],
  };
  stats.conversationsCleaned = await count(conversations, convFilter);
  if (!dryRun && stats.conversationsCleaned) {
    await conversations.updateMany(convFilter, { $unset: { currentIssueId: '', readiness: '' } });
  }

  return stats;
}

async function run() {
  fromBackend('dotenv').config({ path: path.join(BACKEND, '.env') });
  const mongoose = fromBackend('mongoose');
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-syllabus-analyzer';
  console.log(`[migrate-v4] connecting to ${uri}${dryRun ? ' (DRY RUN)' : ''}`);
  await mongoose.connect(uri);
  const stats = await migrate(mongoose.connection.db, { dryRun });
  console.log('[migrate-v4] summary:', stats);
  await mongoose.disconnect();
  console.log('[migrate-v4] done.');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[migrate-v4] failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate };
