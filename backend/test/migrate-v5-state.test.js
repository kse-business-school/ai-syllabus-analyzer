const helpers = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const Syllabus = require('../models/Syllabus');
const { migrate } = require('../../scripts/migrate-v5-state');

beforeAll(helpers.connectDb);
afterAll(helpers.disconnectDb);

const ZERO = {
  programCodeSet: 0, statusReset: 0, submitFieldsUnset: 0, outputsUnset: 0, outputFilesDeleted: 0,
  suggestionsDeleted: 0, messagesRemapped: 0, needsRebuildSet: 0, workingFilesDeleted: 0, v4FieldsUnset: 0, analysisStageReset: 0,
};

test('migrate-v5-state: v4 → v5; dry-run нічого не змінює, повторний запуск — 0 змін', async () => {
  const db = mongoose.connection.db;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kse-mig-'));
  const files = { tracked: path.join(dir, 'a_tracked.docx'), clean: path.join(dir, 'a_clean.docx'), pdf: path.join(dir, 'sub.pdf') };
  for (const f of Object.values(files)) fs.writeFileSync(f, 'x');
  const working = path.join(dir, 'orig.pdf.working.docx');
  const original = path.join(dir, 'orig.docx');
  fs.writeFileSync(working, 'x');
  fs.writeFileSync(original, 'x');

  const mba = new mongoose.Types.ObjectId();
  const plain = new mongoose.Types.ObjectId();
  await db.collection('programs').insertMany([
    { _id: mba, name: 'MBA', code: 'MBA', editions: [{ code: 'MBA27' }, { code: 'MBA28' }] },
    { _id: plain, name: 'EMBA', code: 'EMBA', editions: [] },
  ]);
  const submittedAt = new Date('2026-01-10T10:00:00Z');
  const ids = { v4: new mongoose.Types.ObjectId(), v5: new mongoose.Types.ObjectId(), legacy: new mongoose.Types.ObjectId(),
    emba: new mongoose.Types.ObjectId(), analyzing: new mongoose.Types.ObjectId() };
  await Syllabus.collection.insertMany([
    {
      _id: ids.v4, title: 'v4', programId: mba, status: 'submitted', submittedAt, submitting: false, submissionEmailStatus: 'sent',
      submittedPdfPath: files.pdf, document: { docVersion: 'd1', blocks: [], pdfBlockMap: { b1: 'b1' }, sourceBlocks: [], sourceDocVersion: 'p1' },
      originalFile: { path: original }, workingFile: { path: working }, rubricSummary: { counts: { ok: 1 } },
      outputs: { tracked: { path: files.tracked }, clean: { path: files.clean }, syllabus: { path: '/keep' } },
    },
    { _id: ids.v5, title: 'v5', programId: mba, programCode: 'MBA27', status: 'in_progress', document: { docVersion: 'd2' }, state: { schemaVersion: 1 },
      originalFile: { path: original }, workingFile: { path: original } },
    { _id: ids.legacy, title: 'legacy', programId: mba, legacy: true, status: 'submitted', submittedAt, submittedPdfPath: '/tmp/none.pdf' },
    { _id: ids.emba, title: 'emba', programId: plain, status: 'in_progress' },
    { _id: ids.analyzing, title: 'parsing', programId: mba, programCode: 'MBA28', status: 'analyzing', analysisStage: 'rewrite', document: { docVersion: 'd3' } },
  ]);
  const sug = db.collection('suggestions');
  await sug.insertMany([
    { syllabusId: ids.v4, kind: 'edit', ops: [{ op: 'replaceBlock' }] },
    { syllabusId: ids.v4, kind: 'choice', ops: [], options: [{ id: 'a', ops: [{ op: 'insertAfter' }] }] },
    { syllabusId: ids.v4, kind: 'question', ops: [] },
    { syllabusId: ids.v4, kind: 'edit', group: 'policy', docVersion: 'd1', finding: { id: 'f1' } },
    { syllabusId: ids.v5, kind: 'edit', target: { path: 'header.courseTitle' } },
  ]);
  const convId = new mongoose.Types.ObjectId();
  await db.collection('messages').insertMany([
    { conversationId: convId, kind: 'submission-cta', content: 'Submit?' },
    { conversationId: convId, kind: 'text', content: 'hi' },
  ]);

  const snapshot = async () => JSON.stringify([
    await Syllabus.collection.find().sort({ _id: 1 }).toArray(),
    await sug.find().sort({ _id: 1 }).toArray(),
    await db.collection('messages').find().sort({ _id: 1 }).toArray(),
  ]);
  const before = await snapshot();

  const expected = {
    programCodeSet: 2, // v4 і legacy; programCode у v5/analyzing уже є, EMBA без редакцій
    statusReset: 2, submitFieldsUnset: 2, outputsUnset: 1, outputFilesDeleted: 3, // pre-v4 legacy теж: статус і submit-поля
    suggestionsDeleted: 3, messagesRemapped: 1, needsRebuildSet: 1,
    workingFilesDeleted: 1, // робочий файл v4; workingFile, що збігається з оригіналом, не видаляється
    v4FieldsUnset: 2, analysisStageReset: 1,
  };
  expect(await migrate(db, { dryRun: true })).toEqual(expected);
  expect(await snapshot()).toBe(before);
  expect(Object.values(files).every((f) => fs.existsSync(f))).toBe(true);
  expect(fs.existsSync(working)).toBe(true);

  expect(await migrate(db)).toEqual(expected);
  const get = (id) => Syllabus.findById(id).lean();
  const v4 = await get(ids.v4);
  expect(v4).toMatchObject({ programCode: 'MBA28', status: 'in_progress', needsRebuild: true });
  expect(v4.legacySubmittedAt).toEqual(submittedAt);
  for (const f of ['submitting', 'submissionEmailStatus', 'submittedPdfPath', 'submittedAt']) expect(v4[f]).toBeUndefined();
  expect(v4.outputs).toEqual({ syllabus: { path: '/keep' } });
  expect(Object.values(files).some((f) => fs.existsSync(f))).toBe(false);
  expect(fs.existsSync(working)).toBe(false);
  expect(fs.existsSync(original)).toBe(true);
  expect(v4.workingFile).toBeUndefined();
  expect(v4.rubricSummary).toBeUndefined();
  expect(v4.document).toEqual({ docVersion: 'd1', blocks: [] });
  expect((await get(ids.v5)).workingFile).toBeUndefined();
  expect((await get(ids.analyzing)).analysisStage).toBeNull();

  expect(await sug.countDocuments()).toBe(2);
  expect(await db.collection('messages').countDocuments({ kind: 'submission-cta' })).toBe(0);
  expect((await get(ids.v5)).needsRebuild).toBeUndefined();
  expect((await get(ids.analyzing)).needsRebuild).toBeUndefined();
  expect((await get(ids.emba)).programCode).toBeUndefined();
  // pre-v4 legacy лишається read-only без needsRebuild; статус і submit-поля знято
  const legacy = await get(ids.legacy);
  expect(legacy).toMatchObject({ legacy: true, status: 'in_progress', programCode: 'MBA28', legacySubmittedAt: submittedAt });
  expect(legacy.needsRebuild).toBeUndefined();
  expect(legacy.submittedPdfPath).toBeUndefined();

  const after = await snapshot();
  expect(await migrate(db)).toEqual(ZERO);
  expect(await snapshot()).toBe(after);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--default-edition: інша редакція; невідома редакція не проставляється', async () => {
  const db = mongoose.connection.db;
  const program = await db.collection('programs').findOne({ code: 'MBA' });
  const id = new mongoose.Types.ObjectId();
  await Syllabus.collection.insertOne({ _id: id, title: 'x', programId: program._id, status: 'in_progress' });
  expect((await migrate(db, { defaultEdition: 'mba99' })).programCodeSet).toBe(0);
  expect((await migrate(db, { defaultEdition: 'mba27' })).programCodeSet).toBe(1);
  expect((await Syllabus.findById(id).lean()).programCode).toBe('MBA27');
});
