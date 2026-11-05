const mongoose = require('mongoose');

// Реєстр кодів довідників (C05): кожен ефективний код — набір програми або код програми без наборів — належить
// рівно одній програмі. Унікальний індекс на code робить захоплення коду атомарним навіть за одночасних запитів.
const programCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  programId: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', required: true },
}, { timestamps: true });

programCodeSchema.index({ code: 1 }, { unique: true });
programCodeSchema.index({ programId: 1 });

module.exports = mongoose.model('ProgramCode', programCodeSchema);
