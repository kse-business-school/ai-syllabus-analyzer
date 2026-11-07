// syllabusState/store: ревізії, конфлікти, зняття approved, журнал SlotChange, затвердження, reopen.
const { connectDb, disconnectDb, createUser, createSyllabus } = require('../helpers');
const store = require('../../services/syllabusState/store');
const { setPath } = require('../../services/syllabusState/paths');
const { createEmptyState } = require('../../services/syllabusState/empty');
const { loadFixtureRefs } = require('../../services/references/fixtureRefs');
const { riskManagementState } = require('../fixtures/state/riskManagement');

const refs = loadFixtureRefs('MBA28');
let SlotChange;
let Syllabus;
let owner;

beforeAll(async () => {
  await connectDb();
  SlotChange = require('../../models/SlotChange');
  Syllabus = require('../../models/Syllabus');
  owner = await createUser();
});
afterAll(disconnectDb);

async function seeded(state = riskManagementState()) {
  const syllabus = await createSyllabus(owner);
  const { revision } = await store.initState(syllabus._id, state, { refs });
  return { id: syllabus._id, revision };
}

const meta = { approved: true, approvedAt: '2026-10-01T00:00:00.000Z', approvedRevision: 1 };

describe('initState', () => {
  test('пише стан і baseline, збільшує ревізію; нові поля Syllabus мають дефолти', async () => {
    const syllabus = await createSyllabus(owner);
    expect(syllabus).toMatchObject({ stateRevision: 0, downloads: 0, needsRebuild: false });
    expect(syllabus.plagiarismCheck.similarSyllabi).toBeNull();
    const { revision, state } = await store.initState(syllabus._id, createEmptyState({ programCode: 'MBA28', refs, course: { title: 'X' } }));
    expect(revision).toBe(1);
    const doc = await Syllabus.findById(syllabus._id).lean();
    expect(doc.state).toEqual(state);
    expect(doc.baselineState).toEqual(state);
  });

  test('невалідний стан → 422 INVALID_STATE', async () => {
    const syllabus = await createSyllabus(owner);
    await expect(store.initState(syllabus._id, { schemaVersion: 1 })).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_STATE' });
  });
});

describe('mutate', () => {
  test('ревізія росте, E-поля перераховуються, SlotChange на кожен змінений шлях', async () => {
    const user = await createUser();
    const { id, revision } = await seeded();
    const res = await store.mutate(id, revision, (s) => {
      s.assessments.find((a) => a.id === 'as1').weight = 25;
      s.assessments.find((a) => a.id === 'as3').weight = 50;
      s.summary.shortDescription.text = 'Risk is everywhere, and this course shows how to manage it.';
      return s;
    }, { by: user._id, source: 'instructor_directed' });

    expect(res.revision).toBe(revision + 1);
    expect(res.state.header.computed.assessmentTotal).toBe(100);
    const doc = await Syllabus.findById(id).lean();
    expect(doc.stateRevision).toBe(revision + 1);
    expect(doc.state.assessments[0].weight).toBe(25);
    expect(doc.baselineState.assessments[0].weight).toBe(35); // baseline не змінюється

    const changes = await SlotChange.find({ syllabusId: id }).sort({ path: 1 }).lean();
    expect(changes.map((c) => [c.path, c.section, c.revision])).toEqual([
      ['assessments[as1]', 'assessment', revision + 1],
      ['assessments[as3]', 'assessment', revision + 1],
      ['summary.shortDescription', 'short_description', revision + 1],
    ]);
    expect(changes[0]).toMatchObject({ source: 'instructor_directed', by: user._id });
    expect(changes[0].before.weight).toBe(35);
    expect(changes[0].after.weight).toBe(25);
  });

  test('fn може мутувати копію й нічого не повертати; без змін — без запису', async () => {
    const { id, revision } = await seeded();
    const noop = await store.mutate(id, revision, () => undefined);
    expect(noop.revision).toBe(revision);
    expect(await SlotChange.countDocuments({ syllabusId: id })).toBe(0);
    const res = await store.mutate(id, revision, (s) => { s.header.ects = 3; });
    expect(res.state.header.ects).toBe(3);
  });

  test('застаріла ревізія → 409 STATE_CONFLICT з поточною ревізією', async () => {
    const { id, revision } = await seeded();
    await store.mutate(id, revision, (s) => setPath(s, 'header.ects', 3));
    await expect(store.mutate(id, revision, (s) => setPath(s, 'header.ects', 4)))
      .rejects.toMatchObject({ statusCode: 409, code: 'STATE_CONFLICT', details: { revision: revision + 1 } });
  });

  test('гонка двох записів з однією ревізією: проходить рівно один', async () => {
    const { id, revision } = await seeded();
    const results = await Promise.allSettled([3, 4].map((ects) => store.mutate(id, revision, (s) => setPath(s, 'header.ects', ects))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe('STATE_CONFLICT');
  });

  test('approved знімається лише з торкнутих розділів; fn не може затвердити сам', async () => {
    const state = riskManagementState();
    state.sections = { assessment: meta, materials: meta, short_description: meta };
    const { id, revision } = await seeded(state);
    const res = await store.mutate(id, revision, (s) => {
      s.assessments[1].deadline = '2026-05-10';
      s.sections.schedule = meta;
      return s;
    });
    expect(Object.keys(res.state.sections).sort()).toEqual(['materials', 'short_description']);
  });

  test('невалідний результат → 422 INVALID_STATE, стан не змінено', async () => {
    const { id, revision } = await seeded();
    await expect(store.mutate(id, revision, (s) => setPath(s, 'header.ects', 'two')))
      .rejects.toMatchObject({ statusCode: 422, code: 'INVALID_STATE' });
    expect((await Syllabus.findById(id).lean()).stateRevision).toBe(revision);
  });
});

describe('approveSection / approveAll', () => {
  test('незаповнений розділ → 409 SECTION_INCOMPLETE з gaps', async () => {
    const { id } = await seeded(createEmptyState({ programCode: 'MBA28', refs, course: { title: 'X' } }));
    await expect(store.approveSection(id, 'schedule')).rejects.toMatchObject({
      statusCode: 409, code: 'SECTION_INCOMPLETE', details: { gaps: ['At least one session'] },
    });
    await expect(store.approveSection(id, 'nope')).rejects.toMatchObject({ statusCode: 400, code: 'UNKNOWN_SECTION' });
  });

  test('затвердження і зняття', async () => {
    const { id, revision } = await seeded();
    const res = await store.approveSection(id, 'schedule');
    expect(res.revision).toBe(revision + 1);
    expect(res.state.sections.schedule).toMatchObject({ approved: true, approvedRevision: revision + 1 });
    expect(await SlotChange.countDocuments({ syllabusId: id, path: 'sections.schedule', source: 'approve' })).toBe(1);
    const off = await store.unapproveSection(id, 'schedule');
    expect(off.state.sections.schedule).toBeUndefined();
  });

  test('approveAll: лише complete без блокерів, решта з причиною', async () => {
    const { id } = await seeded();
    const blockersFor = async (key) => (key === 'assessment' ? 'Resolve 1 open issue first' : null);
    // Розділи профілю набору (дані): без keys store обходить усі ключі схеми, зокрема профілю MMM
    const keys = require('../../services/references/fixtureRefs').fixtureTemplate('MBA28').map((t) => t.key);
    const res = await store.approveAll(id, { blockersFor, keys });
    expect(res.skipped).toEqual([
      { key: 'assessment', reason: 'Resolve 1 open issue first' },
      { key: 'policies', reason: expect.stringMatching(/^Incomplete: policy\.attendance: choose an option/) },
    ]);
    expect(res.approved).toHaveLength(9);
    expect(res.approved).not.toContain('assessment');
    const doc = await Syllabus.findById(id).lean();
    expect(Object.keys(doc.state.sections)).toHaveLength(9);
    // Повторний виклик нічого не затверджує і не пише
    const again = await store.approveAll(id, { blockersFor, keys });
    expect(again.approved).toEqual([]);
    expect(again.revision).toBe(res.revision);
  });
});

describe('revertChange', () => {
  test('відкочує зміну пропозиції й знімає approved', async () => {
    const { id, revision } = await seeded();
    const suggestionId = '64b000000000000000000001';
    const r1 = await store.mutate(id, revision, (s) => setPath(s, 'summary.capstone.text', 'A new capstone link sentence for this course.'), { suggestionId, source: 'ai_draft' });
    await store.approveSection(id, 'connection_to_capstone');
    const changes = await SlotChange.find({ syllabusId: id, suggestionId }).lean();
    expect(changes).toHaveLength(1);
    const res = await store.revertChange(id, changes);
    expect(res.revision).toBe(r1.revision + 2);
    expect(res.state.summary.capstone.text).toMatch(/^This course will help you anticipate/);
    expect(res.state.sections.connection_to_capstone).toBeUndefined();
    expect(await SlotChange.countDocuments({ syllabusId: id, source: 'reopen' })).toBe(1);
  });

  test('значення змінилось після пропозиції → 409 REOPEN_CONFLICT', async () => {
    const { id, revision } = await seeded();
    const r1 = await store.mutate(id, revision, (s) => setPath(s, 'assessments[as2].weight', 30));
    const [change] = await SlotChange.find({ syllabusId: id, revision: r1.revision }).lean();
    await store.mutate(id, r1.revision, (s) => setPath(s, 'assessments[as2].criteria', 'Multiple choice, 20 questions.'));
    await expect(store.revertChange(id, change)).rejects.toMatchObject({
      statusCode: 409, code: 'REOPEN_CONFLICT', details: { paths: ['assessments[as2]'] },
    });
  });

  test('відкат додавання сутності видаляє її', async () => {
    const { id, revision } = await seeded();
    const r1 = await store.mutate(id, revision, (s) => setPath(s, 'materials.required[m9]', {
      citation: 'Hopkin P. Fundamentals of Risk Management.', url: null, verified: false, source: 'instructor_directed', evidenceBlockIds: [],
    }));
    const [change] = await SlotChange.find({ syllabusId: id, revision: r1.revision }).lean();
    expect(change.path).toBe('materials.required[]');
    const res = await store.revertChange(id, change);
    expect(res.state.materials.required.map((m) => m.id)).toEqual(['m1']);
  });
});

test('SlotChange append-only', async () => {
  const { id, revision } = await seeded();
  await store.mutate(id, revision, (s) => setPath(s, 'header.ects', 3));
  await expect(SlotChange.updateOne({ syllabusId: id }, { $set: { path: 'x' } })).rejects.toThrow(/append-only/);
});
