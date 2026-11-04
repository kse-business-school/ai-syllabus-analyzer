const helpers = require('./helpers');
const mongoose = require('mongoose');
const Syllabus = require('../models/Syllabus');
const { migrate } = require('../../scripts/migrate-v4-suggestions');

beforeAll(helpers.connectDb);
afterAll(helpers.disconnectDb);

test('migrate-v4: legacy, $unset старих полів, kind повідомлень; dry-run і повторний запуск', async () => {
  const db = mongoose.connection.db;
  const ids = { old: new mongoose.Types.ObjectId(), fresh: new mongoose.Types.ObjectId(), uploading: new mongoose.Types.ObjectId() };
  await Syllabus.collection.insertMany([
    {
      _id: ids.old, title: 'old', extractedText: 'text', editedText: 'e', revisionMarkup: 'r', previewPdf: { path: '/x' },
      structure: { hasObjectives: true }, analysis: { x: 1 }, editingStatus: 'ready',
      recommendations: [{ id: 'r1', decision: 'accepted' }], submittedPdfPath: '/tmp/old.pdf',
    },
    { _id: ids.fresh, title: 'new', sourceFormat: 'docx', document: { docVersion: 'abc', blocks: [] }, recommendations: [] },
    { _id: ids.uploading, title: 'uploading', sourceFormat: 'pdf', status: 'analyzing' },
  ]);
  const convId = new mongoose.Types.ObjectId();
  await db.collection('conversations').insertOne({
    _id: convId, syllabusId: ids.old, currentIssueId: 'r1',
    readiness: { score: 40, weights: { templateCompliance: 0.4 }, breakdown: { templateCompliance: 50 } },
  });
  await db.collection('messages').insertMany([
    { conversationId: convId, role: 'ai', kind: 'before-after', content: 'Картка 1' },
    { conversationId: convId, role: 'ai', kind: 'case-cards', content: 'Картка 2' },
    { conversationId: convId, role: 'ai', kind: 'text', content: 'Привіт' },
  ]);

  const dry = await migrate(db, { dryRun: true });
  expect(dry).toEqual({ syllabiMarkedLegacy: 1, recommendationsArchived: 1, syllabiFieldsUnset: 2, messagesRemapped: 2, conversationsCleaned: 1 });
  expect((await Syllabus.findById(ids.old).lean()).legacy).toBeUndefined();

  await migrate(db);
  const old = await Syllabus.findById(ids.old).lean();
  expect(old.legacy).toBe(true);
  expect(old.legacyRecommendations).toEqual([{ id: 'r1', decision: 'accepted' }]);
  for (const f of ['editedText', 'revisionMarkup', 'previewPdf', 'structure', 'analysis', 'editingStatus', 'recommendations']) {
    expect(old[f]).toBeUndefined();
  }
  expect(old.submittedPdfPath).toBe('/tmp/old.pdf');
  const fresh = await Syllabus.findById(ids.fresh).lean();
  expect(fresh.legacy).toBeUndefined();
  expect(fresh.recommendations).toBeUndefined();
  expect((await Syllabus.findById(ids.uploading).lean()).legacy).toBeUndefined();
  const kinds = (await db.collection('messages').find({ conversationId: convId }).toArray()).map((m) => [m.kind, m.content]);
  expect(kinds).toEqual([['text', 'Картка 1'], ['text', 'Картка 2'], ['text', 'Привіт']]);
  const conv = await db.collection('conversations').findOne({ _id: convId });
  expect(conv.currentIssueId).toBeUndefined();
  expect(conv.readiness).toBeUndefined();

  expect(await migrate(db)).toEqual({ syllabiMarkedLegacy: 0, recommendationsArchived: 0, syllabiFieldsUnset: 0, messagesRemapped: 0, conversationsCleaned: 0 });
});
