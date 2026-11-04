const helpers = require('./helpers');
process.env.MAX_FILE_SIZE = String(10 * 1024 * 1024);

jest.mock('../services/syllabusState/readiness', () => {
  const actual = jest.requireActual('../services/syllabusState/readiness');
  return { ...actual, computeReadiness: jest.fn(actual.computeReadiness) };
});

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const Program = require('../models/Program');
const Syllabus = require('../models/Syllabus');
const Suggestion = require('../models/Suggestion');
const SlotChange = require('../models/SlotChange');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { validateState } = require('../services/syllabusState/schema');
const { seedReferences } = require('../services/references/seed');
const { computeReadiness } = require('../services/syllabusState/readiness');
const { deleteSyllabiCascade } = require('../services/syllabusCleanup');
const emailService = require('../services/emailService');

let owner; let admin; let auth; let adminAuth; let mba; let plain;

beforeAll(async () => {
  await helpers.connectDb();
  owner = await helpers.createUser();
  admin = await helpers.createUser({ role: 'admin' });
  auth = { Authorization: `Bearer ${helpers.tokenFor(owner)}` };
  adminAuth = { Authorization: `Bearer ${helpers.tokenFor(admin)}` };
  await Program.seedDefaults();
  await seedReferences();
  mba = await Program.findOne({ code: 'MBA' });
  plain = await Program.create({ name: 'Plain', code: 'PLAIN' });
});
afterAll(helpers.disconnectDb);

describe('POST /api/syllabus (трек 1)', () => {
  const create = (body, headers = auth) => request(app).post('/api/syllabus').set(headers).send(body);

  test('створює порожній валідний стан, in_progress, без файлу', async () => {
    const res = await create({ title: 'Risk Management', programId: String(mba._id), programCode: 'mba27', courseCode: 'НД.4' });
    expect(res.status).toBe(201);
    const { syllabus } = res.body;
    expect(syllabus).toMatchObject({ title: 'Risk Management', programCode: 'MBA27', track: 'scratch', status: 'in_progress', stateRevision: 1 });
    expect(syllabus.state).toBeUndefined();
    expect(syllabus.baselineState).toBeUndefined();

    const doc = await Syllabus.findById(syllabus._id).lean();
    expect(doc.sourceFormat).toBeNull();
    expect(doc.originalFile?.path).toBeUndefined();
    expect(validateState(doc.state)).toEqual([]);
    expect(doc.state).toMatchObject({ programCode: 'MBA27', track: 'scratch' });
    expect(doc.state.header).toMatchObject({ courseTitle: 'Risk Management', courseCode: 'НД.4', courseKind: 'core' });
    expect(doc.state.policies).toHaveLength(13);
    expect(doc.baselineState).toEqual(doc.state);
    expect(String(doc.instructor)).toBe(String(owner._id));
  });

  test('програма без редакцій: programCode = program.code', async () => {
    const res = await create({ title: 'Plain course', programId: String(plain._id) });
    expect(res.status).toBe(201);
    expect(res.body.syllabus.programCode).toBe('PLAIN');
  });

  test('INVALID_PROGRAM_CODE: немає/чужа редакція, невідома програма; нічого не створюється', async () => {
    const before = await Syllabus.countDocuments();
    for (const body of [
      { title: 'X', programId: String(mba._id) },
      { title: 'X', programId: String(mba._id), programCode: 'MBA99' },
      { title: 'X', programId: String(new mongoose.Types.ObjectId()), programCode: 'MBA27' },
    ]) {
      const res = await create(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PROGRAM_CODE');
    }
    expect(await Syllabus.countDocuments()).toBe(before);
  });

  test('валідація і авторизація', async () => {
    expect((await create({ programId: String(mba._id), programCode: 'MBA27' })).status).toBe(400);
    expect((await create({ title: 'X', programId: 'bad', programCode: 'MBA27' })).status).toBe(400);
    expect((await request(app).post('/api/syllabus').send({})).status).toBe(401);
  });

  test('scratch: analyze → 409 NO_SOURCE_FILE, download → 404', async () => {
    const res = await create({ title: 'S', programId: String(plain._id) });
    const id = res.body.syllabus._id;
    const analyze = await request(app).post(`/api/syllabus/${id}/analyze`).set(auth);
    expect([analyze.status, analyze.body.code]).toEqual([409, 'NO_SOURCE_FILE']);
    expect((await request(app).get(`/api/syllabus/${id}/download`).set(auth)).status).toBe(404);
  });
});

describe('upload', () => {
  test('.pptx → 400 UNSUPPORTED_FORMAT', async () => {
    const before = await Syllabus.countDocuments();
    const res = await request(app).post('/api/syllabus/upload').set(auth)
      .field('courseName', 'Deck').field('programId', String(mba._id)).field('programCode', 'MBA27')
      .attach('syllabus', Buffer.from('PK\u0003\u0004'), 'deck.pptx');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'UNSUPPORTED_FORMAT', message: 'Upload a .docx, .doc or .pdf file' });
    expect(await Syllabus.countDocuments()).toBe(before);
  });
});

describe('GET /:id і analyze', () => {
  test('GET віддає programCode/track/needsRebuild/stateRevision без state і шляхів', async () => {
    const s = await helpers.createDocSyllabus(owner, {
      programCode: 'MBA28', needsRebuild: true, state: { schemaVersion: 1 }, baselineState: { schemaVersion: 1 }, stateRevision: 3,
    });
    const res = await request(app).get(`/api/syllabus/${s._id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ programCode: 'MBA28', track: 'upload', needsRebuild: true, stateRevision: 3 });
    for (const f of ['state', 'baselineState', 'workingFile', 'outputs']) expect(res.body[f]).toBeUndefined();
    expect(res.body.originalFile.path).toBeUndefined();
  });

  test('v4-силабус з needsRebuild: analyze дозволений, скидає картки, розмову, повідомлення', async () => {
    const runner = require('../services/analysisRunner');
    const spy = jest.spyOn(runner, 'runAnalysisInBackground').mockImplementation(() => {});
    const s = await helpers.createDocSyllabus(owner, { needsRebuild: true });
    await helpers.createSuggestion(s);
    const conv = await Conversation.create({ syllabusId: s._id, instructorId: owner._id });
    await Message.create({ conversationId: conv._id, role: 'ai', content: 'hi' });

    const res = await request(app).post(`/api/syllabus/${s._id}/analyze`).set(auth);
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect((await Syllabus.findById(s._id)).status).toBe('analyzing');
    expect(await Suggestion.countDocuments({ syllabusId: s._id })).toBe(0);
    expect(await Conversation.countDocuments({ syllabusId: s._id })).toBe(0);
    expect(await Message.countDocuments({ conversationId: conv._id })).toBe(0);
  });
});

describe('кабінет', () => {
  test('resend-submission видалено', async () => {
    const s = await helpers.createSyllabus(owner);
    const res = await request(app).post(`/api/cabinet/syllabi/${s._id}/resend-submission`).set(adminAuth);
    expect(res.status).toBe(404);
  });

  test('sendSubmissionToAdEmail видалено, інші листи лишилися', () => {
    expect(emailService.sendSubmissionToAdEmail).toBeUndefined();
    for (const fn of ['sendInvitationEmail', 'sendPasswordResetEmail', 'sendAccountDeletionEmail', 'sendEmailChangeConfirmation']) {
      expect(typeof emailService[fn]).toBe('function');
    }
  });

  test('metrics: total, inProgress, downloads, ready100 (без submitted)', async () => {
    await Syllabus.deleteMany({});
    const ready = await helpers.createSyllabus(owner, { programCode: 'MBA27', downloads: 2, state: { programCode: 'MBA27', marker: 'ready' } });
    await helpers.createSyllabus(owner, { programCode: 'MBA27', downloads: 3, state: { programCode: 'MBA27', marker: 'draft' } });
    await helpers.createSyllabus(owner, { downloads: 1 });
    const other = await helpers.createUser();
    await helpers.createSyllabus(other, { downloads: 10 });
    computeReadiness.mockImplementation((state) => ({ score: state.marker === 'ready' ? 100 : 40, sections: {}, counts: {} }));

    const res = await request(app).get('/api/cabinet/metrics').set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 3, inProgress: 3, downloads: 6, ready100: 1 });
    expect(res.body.submitted).toBeUndefined();

    const all = await request(app).get('/api/cabinet/metrics?scope=all').set(adminAuth);
    expect(all.body).toEqual({ total: 4, inProgress: 4, downloads: 16, ready100: 1 });
    expect(ready._id).toBeDefined();
    computeReadiness.mockImplementation(jest.requireActual('../services/syllabusState/readiness').computeReadiness);
  });

  test('/syllabi: readiness зі state, outputs, без state у відповіді', async () => {
    await Syllabus.deleteMany({});
    const res0 = await request(app).post('/api/syllabus').set(auth).send({ title: 'Cab', programId: String(mba._id), programCode: 'MBA28' });
    const id = res0.body.syllabus._id;
    await helpers.createSuggestion({ _id: id }, { status: 'accepted' });
    const noState = await helpers.createSyllabus(owner);

    const res = await request(app).get('/api/cabinet/syllabi').set(auth);
    expect(res.status).toBe(200);
    const item = res.body.syllabi.find((x) => x._id === id);
    expect(item.state).toBeUndefined();
    expect(item.baselineState).toBeUndefined();
    expect(item.outputs).toEqual(['syllabus.docx']);
    expect(item.programCode).toBe('MBA28');
    expect(item.readiness.score).toBe(0);
    expect(Object.keys(item.readiness.sections).length).toBeGreaterThan(5);
    // Картка підтвердження профілю викладача створюється разом зі силабусом (pending)
    expect(item.issueCounts).toEqual({ pending: 1, accepted: 1, rejected: 0, total: 2 });
    const bare = res.body.syllabi.find((x) => x._id === String(noState._id));
    expect(bare.readiness.score).toBe(0);
    expect(bare.issueCounts).toEqual({ pending: 0, accepted: 0, rejected: 0, total: 0 });
  });
});

describe('каскадне видалення і cleanup', () => {
  test('видаляє SlotChange разом з рештою', async () => {
    const s = await helpers.createDocSyllabus(owner);
    await SlotChange.create({ syllabusId: s._id, revision: 1, path: 'header.courseTitle', after: 'x' });
    await helpers.createSuggestion(s);
    expect(await deleteSyllabiCascade({ _id: s._id })).toBe(1);
    expect(await SlotChange.countDocuments({ syllabusId: s._id })).toBe(0);
    expect(await Suggestion.countDocuments({ syllabusId: s._id })).toBe(0);
    expect(await Syllabus.countDocuments({ _id: s._id })).toBe(0);
  });

  test('sweepery submit/pdf прибрано', () => {
    const cleanup = require('../services/syllabusCleanup');
    expect(cleanup.releaseStuckSubmits).toBeUndefined();
    expect(cleanup.sweepOldPdfs).toBeUndefined();
  });

  test('cleanup-uploads не чіпає uploads/outputs/<id>/syllabus.docx живих силабусів', async () => {
    const s = await helpers.createSyllabus(owner);
    const dir = path.join(__dirname, '../uploads/outputs', String(s._id));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'syllabus.docx');
    fs.writeFileSync(file, 'x');
    const old = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(file, old, old);
    const orphan = path.join(__dirname, '../uploads/syllabi', `orphan-${Date.now()}.docx`);
    fs.mkdirSync(path.dirname(orphan), { recursive: true });
    fs.writeFileSync(orphan, 'x');
    fs.utimesSync(orphan, old, old);

    const res = await request(app).post('/api/syllabus/maintenance/cleanup-uploads').set(adminAuth);
    expect(res.status).toBe(200);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(orphan)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
