// Блокування з токеном власника для багатодокументних операцій без транзакцій MongoDB (replica set розгортання
// не вимагає): зміни однієї програми, одного довідника набору, коду курсу одного силабуса.
//  · acquire — атомарно (унікальний key): зайняте чинне блокування → 409 retryable;
//  · release / assertHeld — лише з токеном: старий власник після спливу lease не знімає чужого блокування
//    і не відкочує чужих змін (assertHeld перед кожним комітом і відкатом).
const crypto = require('crypto');
const Lock = require('../models/Lock');
const { httpError } = require('../utils/httpError');

const DEFAULT_TTL_MS = 30 * 1000;

// Коректність тримається на унікальному індексі key, а в production autoIndex вимкнено: індекс створюється
// тут один раз на процес (createIndexes ідемпотентний і створює лише відсутні індекси)
let indexReady = null;
const ensureIndex = () => {
  if (!indexReady) indexReady = Lock.createIndexes().catch((err) => { indexReady = null; throw err; });
  return indexReady;
};

const busy = (message, code) => httpError(409, message || 'Someone else is changing this right now. Refresh and try again.', { code: code || 'LOCKED_BY_ANOTHER_REQUEST', retryable: true });
const lost = () => httpError(409, 'The operation took too long and was interrupted. Refresh and try again.', { code: 'LOCK_LOST', retryable: true });

async function acquire(key, { ttlMs = DEFAULT_TTL_MS, message, code } = {}) {
  await ensureIndex();
  const token = crypto.randomUUID();
  const now = new Date();
  try {
    await Lock.findOneAndUpdate(
      { key, expiresAt: { $lt: now } },
      { $set: { key, token, expiresAt: new Date(now.getTime() + ttlMs) } },
      { upsert: true },
    );
  } catch (err) {
    if (err?.code === 11000) throw busy(message, code);
    throw err;
  }
  return { key, token };
}

/** Блокування досі наше й чинне; інакше LOCK_LOST (операція не має права ні комітити, ні відкочувати). */
async function assertHeld(lock) {
  const held = await Lock.exists({ key: lock.key, token: lock.token, expiresAt: { $gt: new Date() } });
  if (!held) throw lost();
}

const isHeld = async (lock) => Boolean(await Lock.exists({ key: lock.key, token: lock.token, expiresAt: { $gt: new Date() } }));

async function release(lock) {
  await Lock.deleteOne({ key: lock.key, token: lock.token });
}

/** fn(lock) під блокуванням; release — завжди й лише своє. */
async function withLock(key, fn, opts) {
  const lock = await acquire(key, opts);
  try {
    return await fn(lock);
  } finally {
    await release(lock);
  }
}

module.exports = { acquire, assertHeld, isHeld, release, withLock, DEFAULT_TTL_MS };
