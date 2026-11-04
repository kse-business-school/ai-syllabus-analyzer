const helpers = require('./helpers');
const request = require('supertest');
const app = require('../server');
const User = require('../models/User');

beforeAll(helpers.connectDb);
afterAll(helpers.disconnectDb);

describe('login limiter', () => {
  test('per-IP, не обходиться підробленим Authorization', async () => {
    const attempt = (ip) => request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .set('Authorization', 'Bearer fake.token.value')
      .send({ email: 'nobody@example.com', password: 'wrong' });

    for (let i = 0; i < 3; i++) expect((await attempt('10.0.0.1')).status).toBe(401);
    expect((await attempt('10.0.0.1')).status).toBe(429);
    // інший IP має власний лічильник
    expect((await attempt('10.0.0.2')).status).toBe(401);
  });
});

describe('ролі', () => {
  test('роль береться з БД: понижений адмін одразу втрачає доступ', async () => {
    const admin = await helpers.createUser({ role: 'admin' });
    const token = helpers.tokenFor(admin);
    const ok = await request(app).get('/api/cabinet/users').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);

    await User.updateOne({ _id: admin._id }, { role: 'instructor' });
    const denied = await request(app).get('/api/cabinet/users').set('Authorization', `Bearer ${token}`);
    expect(denied.status).toBe(403);
  });

  test('деактивований користувач отримує 401', async () => {
    const u = await helpers.createUser();
    const token = helpers.tokenFor(u);
    await User.updateOne({ _id: u._id }, { isActive: false });
    const res = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  test('захист останнього адміна (PATCH і DELETE account)', async () => {
    await User.deleteMany({});
    const admin = await helpers.createUser({ role: 'admin' });
    const token = helpers.tokenFor(admin);
    const auth = { Authorization: `Bearer ${token}` };

    const r1 = await request(app).patch(`/api/cabinet/users/${admin._id}`).set(auth).send({ isActive: false });
    expect(r1.status).toBe(409);
    const r2 = await request(app).patch(`/api/cabinet/users/${admin._id}`).set(auth).send({ role: 'instructor' });
    expect(r2.status).toBe(409);
    const r3 = await request(app).delete('/api/users/account').set(auth).send({ password: 'secret123' });
    expect(r3.status).toBe(409);

    // з другим адміном зміна дозволена
    const second = await helpers.createUser({ role: 'admin' });
    const r4 = await request(app).patch(`/api/cabinet/users/${second._id}`).set(auth).send({ isActive: false });
    expect(r4.status).toBe(200);
    expect(r4.body.user.isActive).toBe(false);
    expect(r4.body.user.password).toBeUndefined();
  });

  test('PATCH валідує тіло', async () => {
    const admin = await helpers.createUser({ role: 'admin' });
    const res = await request(app).patch(`/api/cabinet/users/${admin._id}`)
      .set('Authorization', `Bearer ${helpers.tokenFor(admin)}`).send({ role: 'superuser' });
    expect(res.status).toBe(400);
  });
});

describe('видалені ендпоінти', () => {
  test.each([
    ['post', '/api/auth/create-user'],
    ['post', '/api/auth/verify-email'],
    ['post', '/api/auth/resend-verification'],
  ])('%s %s → 404', async (method, url) => {
    const res = await request(app)[method](url).send({});
    expect(res.status).toBe(404);
  });
});
