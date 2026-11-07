// B-3.6: інтерв'ю треку 1 починається з блоку At a Glance — одне питання про кілька полів, відповідь записує
// кожне дослівно назване значення окремим set_slot у тому самому ході. LLM мокається.
jest.mock('../services/ai/client', () => ({ ...jest.requireActual('../services/ai/client'), createResponse: jest.fn() }));
const helpers = require('./helpers');
const request = require('supertest');
const app = require('../server');
const Program = require('../models/Program');
const store = require('../services/syllabusState/store');
const { seedReferences } = require('../services/references/seed');
const { seedPolicyLibrary } = require('../services/references/policies');
const { createResponse } = require('../services/ai/client');

let auth; let mmm;
beforeAll(async () => {
  await helpers.connectDb();
  await Program.seedDefaults();
  await seedReferences();
  await seedPolicyLibrary();
  const lecturer = await helpers.createUser();
  auth = { Authorization: `Bearer ${helpers.tokenFor(lecturer)}` };
  mmm = await Program.findOne({ code: 'MMM' });
});
afterAll(helpers.disconnectDb);

const call = (name, args, id) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });

test('перше питання — блок At a Glance мовою документа; відповідь записує формат і кредити одним ходом', async () => {
  const created = await request(app).post('/api/syllabus').set(auth).send({ title: 'Бренд', programId: String(mmm._id), programCode: 'MMM26' });
  const id = created.body.syllabus._id;
  createResponse.mockRejectedValue(new Error('no LLM in this test'));
  const start = await request(app).post(`/api/chat/${id}/start`).set(auth).send({});
  expect(start.status).toBe(200);
  // Спершу картка профілю викладача; питання — після рішення щодо неї
  const profile = start.body.suggestions.find((x) => x.status === 'pending');
  const after = profile ? await request(app).post(`/api/chat/${id}/suggestions/${profile.id}/reject`).set(auth).send({}) : start;
  expect(after.status).toBe(200);
  const question = after.body.messages.filter((m) => m.kind === 'question').pop();
  expect(question.payload.slotKey).toBe('glance.block');
  expect(question.content).toMatch(/Почнімо з основного/);
  expect(question.content).toMatch(/блоку програми/);

  createResponse.mockReset();
  createResponse
    .mockResolvedValueOnce({ output: [call('set_slot', { key: 'glance.delivery_mode', value: 'офлайн' }, 'c1'), call('set_slot', { key: 'glance.ects', value: '3' }, 'c2')] })
    .mockResolvedValue({ output_text: 'Записав формат і кредити.', output: [] });
  const answer = await request(app).post(`/api/chat/${id}/message`).set(auth).send({ text: 'Курс офлайн, 3 кредити' });
  expect(answer.status).toBe(200);
  const { state } = await store.getState(id);
  expect(state.header).toMatchObject({ deliveryFormat: 'offline', ects: 3 });
  const next = answer.body.messages.filter((m) => m.kind === 'question').pop();
  expect(next?.payload?.slotKey).not.toBe('glance.block');
});
