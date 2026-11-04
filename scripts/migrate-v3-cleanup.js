#!/usr/bin/env node
/**
 * Міграція після чистки бекенду (v3).
 *
 *   - Syllabus: $unset vectorEmbedding, modifiedFile, editedPdf, editingError, version,
 *     analysis.studentClusterAnalysis, analysis.*.recommendations, analysis.error
 *   - Syllabus.recommendations[].decidedVia 'admin-override' → 'chat'
 *   - Conversation.status 'abandoned' → 'active'
 *   - User: $unset isVerified, verificationToken, verificationTokenExpires, openSyllabusIds, settings.language
 *   - User: $unset resetPasswordToken/emailChangeToken (+ терміни дії). Токени тепер зберігаються як SHA-256,
 *     тож старі сирі токени більше не діють; запрошення треба надіслати повторно («Забули пароль»).
 *
 * Idempotent: можна запускати повторно. `--dry-run` лише показує кількість змін.
 *
 * Usage:
 *   node scripts/migrate-v3-cleanup.js [--dry-run]
 */

const path = require('path');
const BACKEND = path.join(__dirname, '..', 'backend');
const fromBackend = (name) => require(require.resolve(name, { paths: [BACKEND] }));
fromBackend('dotenv').config({ path: path.join(BACKEND, '.env') });
const mongoose = fromBackend('mongoose');
const Syllabus = require(path.join(BACKEND, 'models/Syllabus'));

const DRY = process.argv.includes('--dry-run');
const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-syllabus-analyzer';

async function unsetFields(collection, fields) {
  const filter = { $or: fields.map((f) => ({ [f]: { $exists: true } })) };
  if (DRY) return collection.countDocuments(filter);
  const unset = Object.fromEntries(fields.map((f) => [f, '']));
  const r = await collection.updateMany(filter, { $unset: unset });
  return r.modifiedCount;
}

async function run() {
  console.log(`[migrate-v3] connecting to ${URI}${DRY ? ' (DRY RUN)' : ''}`);
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  const syllabi = db.collection(Syllabus.collection.name);
  const users = db.collection('users');
  const conversations = db.collection('conversations');

  const stats = {};

  stats.syllabiUnset = await unsetFields(syllabi, [
    'vectorEmbedding',
    'modifiedFile',
    'editedPdf',
    'editingError',
    'version',
    'analysis.studentClusterAnalysis',
    'analysis.templateCompliance.recommendations',
    'analysis.learningObjectivesAlignment.recommendations',
    'analysis.error',
  ]);

  const overrideFilter = { 'recommendations.decidedVia': 'admin-override' };
  if (DRY) {
    stats.decidedViaRemapped = await syllabi.countDocuments(overrideFilter);
  } else {
    const r = await syllabi.updateMany(
      overrideFilter,
      { $set: { 'recommendations.$[r].decidedVia': 'chat' } },
      { arrayFilters: [{ 'r.decidedVia': 'admin-override' }] }
    );
    stats.decidedViaRemapped = r.modifiedCount;
  }

  const abandonedFilter = { status: 'abandoned' };
  if (DRY) {
    stats.conversationsAbandoned = await conversations.countDocuments(abandonedFilter);
  } else {
    const r = await conversations.updateMany(abandonedFilter, { $set: { status: 'active' } });
    stats.conversationsAbandoned = r.modifiedCount;
  }

  stats.usersUnset = await unsetFields(users, [
    'isVerified',
    'verificationToken',
    'verificationTokenExpires',
    'openSyllabusIds',
    'settings.language',
    'resetPasswordToken',
    'resetPasswordExpires',
    'emailChangeToken',
    'emailChangeTokenExpires',
  ]);

  console.log('[migrate-v3] summary:', stats);
  await mongoose.disconnect();
  console.log('[migrate-v3] done.');
}

run().catch((err) => {
  console.error('[migrate-v3] failed:', err);
  process.exit(1);
});
