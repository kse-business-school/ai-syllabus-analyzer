const mongoose = require('mongoose');

// ПРН програми (різні переліки для MBA27 і MBA28)
const programOutcomeSchema = new mongoose.Schema({
  programCode: { type: String, required: true, uppercase: true, trim: true },
  code: { type: String, required: true },
  text: { type: String, required: true },
  themeDraft: { type: String, default: '' },
  label: { type: String, trim: true, maxlength: 120, default: '' },
  order: { type: Number, required: true },
}, { timestamps: true });

programOutcomeSchema.index({ programCode: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('ProgramOutcome', programOutcomeSchema);
