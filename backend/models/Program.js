const mongoose = require('mongoose');
const validator = require('validator');

// Програми й набори для першого запуску — дані (fixtures/reference/programs.json), не код
const { readFixture } = require('../services/references/fixtureRefs');

const DEFAULT_PROGRAMS = readFixture('programs.json').programs;

// Код набору (редакції): літери, цифри, «-», «_», «.»; за ним вибираються довідники (Syllabus.programCode)
const EDITION_CODE_RE = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

const programSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, trim: true, uppercase: true },
  academicDirectorEmail: {
    type: String,
    trim: true,
    lowercase: true,
    validate: [(v) => !v || validator.isEmail(v), 'Enter a valid email'],
  },
  // Редакції програми (набори): з них береться Syllabus.programCode
  editions: {
    type: [new mongoose.Schema({
      code: { type: String, required: true, uppercase: true, trim: true, match: EDITION_CODE_RE },
      label: { type: String, default: '', trim: true },
    }, { _id: false })],
    default: [],
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

/**
 * Створює відсутні програми з fixtures/reference/programs.json разом з їхніми наборами.
 * Наявні програми не змінюються: набори далі керуються в кабінеті, тож видалений адміністратором набір
 * не повертається після рестарту, а підписи не затираються. Нові набори з фікстури для наявних програм
 * додає scripts/migrate-v5-references.js.
 */
programSchema.statics.seedDefaults = async function () {
  for (const { editions = [], ...p } of DEFAULT_PROGRAMS) {
    await this.updateOne({ code: p.code }, { $setOnInsert: { ...p, editions } }, { upsert: true });
  }
};

/** Найновіший набір програми — останній у списку (набори додаються в порядку набору студентів). */
const latestEdition = (program) => (program?.editions?.length ? program.editions[program.editions.length - 1].code : null);

module.exports = mongoose.model('Program', programSchema);
module.exports.DEFAULT_PROGRAMS = DEFAULT_PROGRAMS;
module.exports.EDITION_CODE_RE = EDITION_CODE_RE;
module.exports.latestEdition = latestEdition;
