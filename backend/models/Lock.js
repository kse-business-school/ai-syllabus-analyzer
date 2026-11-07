const mongoose = require('mongoose');

// Короткі блокування операцій з токеном власника (services/locks.js): зняти блокування чи відкотити зміни
// може лише той, хто його взяв; прострочене блокування може перехопити інший запит.
const lockSchema = new mongoose.Schema({
  key: { type: String, required: true },
  token: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

lockSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('Lock', lockSchema);
