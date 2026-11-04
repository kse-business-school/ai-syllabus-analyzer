#!/usr/bin/env node
/**
 * Migration to the chat-first Professor's Tutor data shape.
 *
 *   - Drops the practicalChallenge subdocument from every syllabus
 *   - Remaps Syllabus.status: processing→analyzing, analyzed|reviewed|approved→in_progress
 *   - Renames recommendations[].status → recommendations[].decision
 *   - Renames recommendations[].suggestedText → kept as-is (consumed by Phase 2 beforeAfter generator)
 *
 * Idempotent: safe to run multiple times. Run with `--dry-run` to preview.
 *
 * Usage:
 *   node scripts/migrate-v2.js [--dry-run]
 */

const path = require('path');
const BACKEND = path.join(__dirname, '..', 'backend');
const fromBackend = (name) => require(require.resolve(name, { paths: [BACKEND] }));
fromBackend('dotenv').config({ path: path.join(BACKEND, '.env') });
const mongoose = fromBackend('mongoose');
const Syllabus = require(path.join(BACKEND, 'models/Syllabus'));

const DRY = process.argv.includes('--dry-run');
const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-syllabus-analyzer';

async function run() {
  console.log(`[migrate-v2] connecting to ${URI}${DRY ? ' (DRY RUN)' : ''}`);
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  const syllabi = db.collection(Syllabus.collection.name);

  const stats = {
    syllabiInspected: 0,
    practicalChallengeUnset: 0,
    statusRemapped: 0,
    recDecisionRenamed: 0,
    recSuggestedTextDropped: 0,
    usersDemoted: 0,
  };

  // 1. Drop practicalChallenge field
  if (DRY) {
    stats.practicalChallengeUnset = await syllabi.countDocuments({
      practicalChallenge: { $exists: true },
    });
  } else {
    const r = await syllabi.updateMany(
      { practicalChallenge: { $exists: true } },
      { $unset: { practicalChallenge: '' } }
    );
    stats.practicalChallengeUnset = r.modifiedCount;
  }

  // 2. Remap top-level status enum values
  const statusMap = [
    { from: 'processing', to: 'analyzing' },
    { from: 'analyzed', to: 'in_progress' },
    { from: 'reviewed', to: 'in_progress' },
    { from: 'approved', to: 'submitted' }, // approved → submitted (closest match for already-finalised work)
  ];
  for (const { from, to } of statusMap) {
    if (DRY) {
      stats.statusRemapped += await syllabi.countDocuments({ status: from });
    } else {
      const r = await syllabi.updateMany({ status: from }, { $set: { status: to } });
      stats.statusRemapped += r.modifiedCount;
    }
  }

  // 3. Per-recommendation: rename status → decision (and drop suggestedText since beforeAfter takes over)
  const cursor = syllabi.find({ 'recommendations.0': { $exists: true } });
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    stats.syllabiInspected += 1;
    let dirty = false;
    const newRecs = (doc.recommendations || []).map((rec) => {
      const next = { ...rec };
      if (rec.status && !rec.decision) {
        next.decision = rec.status;
        delete next.status;
        dirty = true;
        stats.recDecisionRenamed += 1;
      }
      if (rec.suggestedText) {
        delete next.suggestedText;
        dirty = true;
        stats.recSuggestedTextDropped += 1;
      }
      return next;
    });
    if (dirty && !DRY) {
      await syllabi.updateOne({ _id: doc._id }, { $set: { recommendations: newRecs } });
    }
  }

  // 4. Роль manager більше не понижується: з v5 вона легітимна (призначення курсів, All syllabi)

  console.log('[migrate-v2] summary:', stats);
  await mongoose.disconnect();
  console.log('[migrate-v2] done.');
}

run().catch((err) => {
  console.error('[migrate-v2] failed:', err);
  process.exit(1);
});
