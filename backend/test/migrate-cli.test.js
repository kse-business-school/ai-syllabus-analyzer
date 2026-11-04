const helpers = require('./helpers');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const mongoose = require('mongoose');
const Syllabus = require('../models/Syllabus');

const run = promisify(execFile);
beforeAll(helpers.connectDb);
afterAll(helpers.disconnectDb);

test('v2/v3 CLI runs from repository root against the collection used by the app', async () => {
  const owner = await helpers.createUser({ role: 'manager' });
  const id = new mongoose.Types.ObjectId();
  await Syllabus.collection.insertOne({
    _id: id, title: 'Old syllabus', instructor: owner._id, status: 'analyzed',
    practicalChallenge: { text: 'old' }, vectorEmbedding: [1, 2], version: 1,
    recommendations: [{ id: 'r1', status: 'accepted', decidedVia: 'admin-override' }],
  });
  const uri = mongoose.connection.getClient().options.hosts[0].toString();
  const env = {
    ...process.env,
    MONGODB_URI: `mongodb://${uri}/${mongoose.connection.name}`,
  };
  const cli = (script, dryRun = false) => run(process.execPath, [
    `scripts/${script}`, ...(dryRun ? ['--dry-run'] : []),
  ], { cwd: path.resolve(__dirname, '../..'), env });

  const before = await Syllabus.collection.findOne({ _id: id });
  await cli('migrate-v2.js', true);
  await cli('migrate-v3-cleanup.js', true);
  expect(await Syllabus.collection.findOne({ _id: id })).toEqual(before);

  await cli('migrate-v2.js');
  await cli('migrate-v3-cleanup.js');
  const migrated = await Syllabus.findById(id).lean();
  expect(migrated.status).toBe('in_progress');
  expect(migrated.recommendations).toEqual([{ id: 'r1', decision: 'accepted', decidedVia: 'chat' }]);
  for (const field of ['practicalChallenge', 'vectorEmbedding', 'version']) {
    expect(migrated[field]).toBeUndefined();
  }
  expect((await owner.constructor.findById(owner._id)).role).toBe('manager');
  expect(await mongoose.connection.db.listCollections({ name: 'syllabi' }).toArray()).toEqual([]);

  await cli('migrate-v2.js');
  await cli('migrate-v3-cleanup.js');
  expect(await Syllabus.findById(id).lean()).toEqual(migrated);
});
