const mongoose = require('mongoose');

// Розділ шаблону силабуса. programCode: null — спільний для всіх програм; запис програми перекриває його за key
const templateSectionSchema = new mongoose.Schema({
  programCode: { type: String, default: null, uppercase: true, trim: true },
  key: { type: String, required: true },
  order: { type: Number, required: true },
  docNumber: { type: Number, default: null },
  docTitle: { type: String, default: '' },
  title: { type: String, required: true },
  required: { type: Boolean, default: true },
  nature: { type: String, default: 'fixed' },
  slotTypes: { type: [String], default: [] },
  question: { type: String, default: null },
  // Українські назва й питання розділу (B-1.3): для силабусів мовою uk
  titleUk: { type: String, default: null },
  questionUk: { type: String, default: null },
  docTitleUk: { type: String, default: null },
  // Профіль програми (B-6.1): запис програми з disabled: true прибирає спільний розділ із її силабусів
  disabled: { type: Boolean, default: false },
  // Підказка слота для викладача (B-6.5): лише в UI, у .docx не потрапляє
  hint: { en: { type: String, default: null }, uk: { type: String, default: null } },
  // Текст рівня програми (B-6.4, scope programme): однаковий у кожному силабусі програми, викладач його не змінює
  fixedText: { type: mongoose.Schema.Types.Mixed, default: null }, // { en: [{ title, text }], uk: [...] }
  fixtureRef: { type: String, default: null },
  computeFrom: { type: [String], default: [] },
}, { timestamps: true });

templateSectionSchema.index({ programCode: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('TemplateSection', templateSectionSchema);
