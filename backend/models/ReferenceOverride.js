const mongoose = require('mongoose');

// Довідник набору, змінений у кабінеті (ПРН, нормативні курси, Capstone): сід з фікстур його більше не перезаписує
// і не повертає видалені записи. Одна позначка на пару (programCode, kind).
const referenceOverrideSchema = new mongoose.Schema({
  programCode: { type: String, required: true, uppercase: true, trim: true },
  kind: { type: String, enum: ['outcomes', 'courses', 'capstone'], required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Короткий lease на час заміни переліку (C04): одночасні збереження того самого довідника конфліктують
  lockedUntil: { type: Date, default: null },
}, { timestamps: true });

referenceOverrideSchema.index({ programCode: 1, kind: 1 }, { unique: true });

module.exports = mongoose.model('ReferenceOverride', referenceOverrideSchema);
