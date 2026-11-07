const request = require('supertest');
const helpers = require('./helpers');
const mongoose = require('mongoose');
const app = require('../server');
const Policy = require('../models/Policy');
const { seedPolicyLibrary, getPolicyLibrary, getPolicyBlock, policyMarkdown } = require('../services/references/policies');
const { readFixture } = require('../services/references/fixtureRefs');
const { migrate } = require('../../scripts/migrate-v5-policies');

beforeAll(helpers.connectDb);
afterAll(helpers.disconnectDb);
beforeEach(async () => { await Policy.deleteMany({}); });

const fixture = () => { const { version, blocks } = readFixture('policies.library.json'); return { version, blocks }; };

test('модель: syllabus-policy без createdBy, унікальний key', async () => {
  await Policy.init();
  const p = await Policy.create({ type: 'syllabus-policy', key: 'k.one', title: 'T', content: 'c', mode: 'locked', text: 'x', isRequired: false });
  expect(p.version).toBe(1);
  await expect(Policy.create({ type: 'syllabus-policy', key: 'k.one', title: 'T', content: 'c' })).rejects.toThrow();
  await expect(Policy.create({ type: 'ai-policy', title: 'T', content: 'c' })).rejects.toThrow(/createdBy/);
});

test('сід: 13 блоків, повторний запуск нічого не змінює, адмінська правка не перезаписується', async () => {
  expect(await seedPolicyLibrary()).toEqual({ created: 13, updated: 0, skipped: 0, conflicts: [] });
  expect(await seedPolicyLibrary()).toEqual({ created: 0, updated: 0, skipped: 13, conflicts: [] });
  expect(await Policy.countDocuments({ type: 'syllabus-policy', isRequired: false })).toBe(13);

  await Policy.updateOne({ key: 'policy.absence' }, { text: 'Admin text', libraryVersion: '2.1' });
  await seedPolicyLibrary();
  expect((await Policy.findOne({ key: 'policy.absence' })).text).toBe('Admin text');

  // фікстура новішої версії оновлює лише блоки зі старішою libraryVersion
  const bumped = { version: '2.2', blocks: fixture().blocks };
  expect(await seedPolicyLibrary(bumped)).toEqual({ created: 0, updated: 13, skipped: 0, conflicts: [] });
});

test('сід: блок з adminModified не перезаписується новою версією фікстури, а йде в conflicts', async () => {
  await seedPolicyLibrary();
  await Policy.updateOne({ key: 'policy.absence' }, { text: 'Admin text', adminModified: true });
  const bumped = { version: '9.0', blocks: fixture().blocks };

  const dry = await seedPolicyLibrary(bumped, { dryRun: true });
  expect([dry.updated, dry.conflicts.map((c) => c.key)]).toEqual([12, ['policy.absence']]);

  const stats = await seedPolicyLibrary(bumped);
  expect(stats).toMatchObject({ created: 0, updated: 12, skipped: 0 });
  expect(stats.conflicts).toEqual([{ key: 'policy.absence', libraryVersion: expect.any(String), fixtureVersion: '9.0' }]);
  const kept = await Policy.findOne({ key: 'policy.absence' });
  expect(kept.text).toBe('Admin text');
  expect(kept.adminModified).toBe(true);
  expect((await Policy.findOne({ key: 'policy.attendance' })).libraryVersion).toBe('9.0');
});

test('getPolicyLibrary: формат фікстури, фолбек на порожню БД, getPolicyBlock', async () => {
  expect(await getPolicyLibrary()).toEqual(fixture());
  await seedPolicyLibrary();
  expect(await getPolicyLibrary()).toEqual(fixture());
  const block = await getPolicyBlock('policy.attendance');
  expect(block.options.length).toBeGreaterThan(1);
  expect(await getPolicyBlock('nope')).toBeNull();
  expect(policyMarkdown(block)).toContain(block.options[0].text);
  const locked = await getPolicyBlock('policy.absence');
  expect(policyMarkdown(locked)).toContain(locked.text);
});

describe('маршрути', () => {
  let admin; let adminToken; let instructorToken;
  beforeAll(async () => {
    admin = await helpers.createUser({ role: 'admin' });
    adminToken = helpers.tokenFor(admin);
    instructorToken = helpers.tokenFor(await helpers.createUser());
  });
  beforeEach(seedPolicyLibrary);

  test('GET ?type=syllabus-policy повертає 13 блоків за order', async () => {
    const res = await request(app).get('/api/policies?type=syllabus-policy').set('Authorization', `Bearer ${instructorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.policies).toHaveLength(13);
    expect(res.body.policies.map((p) => p.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  test('PUT: адмін правит options/text, key і mode незмінні, version росте', async () => {
    const lib = await Policy.findOne({ key: 'policy.attendance' });
    const options = lib.options.map((o) => ({ key: o.key, label: o.label, text: `${o.text} (edited)` }));
    const res = await request(app).put(`/api/policies/${lib._id}`).set('Authorization', `Bearer ${adminToken}`).send({ options });
    expect(res.status).toBe(200);
    expect(res.body.policy.version).toBe(2);
    expect(res.body.policy.libraryVersion).toBe(fixture().version);
    expect(res.body.policy.content).toContain('(edited)');

    const put = (body) => request(app).put(`/api/policies/${lib._id}`).set('Authorization', `Bearer ${adminToken}`).send(body);
    expect((await put({ key: 'other' })).status).toBe(400);
    expect((await put({ mode: 'locked' })).status).toBe(400);
    expect((await put({ options: [{ key: 'x', label: 'a', text: 'b' }] })).status).toBe(400);
    expect((await put({ text: 'no' })).status).toBe(400);

    const locked = await Policy.findOne({ key: 'policy.absence' });
    const r2 = await request(app).put(`/api/policies/${locked._id}`).set('Authorization', `Bearer ${adminToken}`).send({ text: 'New locked' });
    expect(r2.status).toBe(200);
    expect(r2.body.policy.content).toContain('New locked');

    // сід не перезаписує правку, навіть коли фікстура новішої версії: блок іде в conflicts
    expect((await Policy.findById(locked._id)).adminModified).toBe(true);
    await seedPolicyLibrary();
    expect((await Policy.findById(locked._id)).text).toBe('New locked');
    const stats = await seedPolicyLibrary({ version: '9.9', blocks: fixture().blocks });
    expect(stats.conflicts.map((c) => c.key).sort()).toEqual(['policy.absence', 'policy.attendance']);
    expect((await Policy.findById(locked._id)).text).toBe('New locked');
  });

  test('POST і DELETE для syllabus-policy заборонені, інструктор не редагує', async () => {
    const lib = await Policy.findOne({ key: 'policy.late' });
    const post = await request(app).post('/api/policies').set('Authorization', `Bearer ${adminToken}`).send({ title: 'x', content: 'y', type: 'syllabus-policy' });
    expect(post.status).toBe(400);
    expect((await request(app).delete(`/api/policies/${lib._id}`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(409);
    expect((await request(app).put(`/api/policies/${lib._id}`).set('Authorization', `Bearer ${instructorToken}`).send({ title: 'z' })).status).toBe(403);
  });
});

test('migrate-v5-policies: dry-run нічого не пише, повторний запуск idempotent', async () => {
  expect(await migrate({ dryRun: true })).toEqual({ created: 13, updated: 0, skipped: 0, conflicts: [] });
  expect(await Policy.countDocuments({})).toBe(0);
  expect(await migrate()).toEqual({ created: 13, updated: 0, skipped: 0, conflicts: [] });
  expect(await migrate()).toEqual({ created: 0, updated: 0, skipped: 13, conflicts: [] });
  expect(await migrate({ dryRun: true })).toEqual({ created: 0, updated: 0, skipped: 13, conflicts: [] });
});
