const mongoose = require('mongoose');

// v5: extract → parse → checks → review → done (старі етапи v4 прибирає scripts/migrate-v5-state.js)
const ANALYSIS_STAGES = ['extract', 'parse', 'checks', 'review', 'done'];

const syllabusSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  course: {
    code: String,
    name: String,
    credits: Number,
    semester: String,
    year: Number
  },
  instructor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  programId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Program'
  },
  // Редакція програми (MBA27/MBA28…): за нею вибираються довідники і тип курсу
  programCode: { type: String, uppercase: true, trim: true },
  // Призначення курсу до набору, з якого взято programCode (необов'язкове: старі силабуси без нього)
  offeringId: { type: mongoose.Schema.Types.ObjectId, ref: 'CourseOffering' },
  track: { type: String, enum: ['scratch', 'upload'], default: 'upload' },
  // Формат, який завантажив викладач
  sourceFormat: {
    type: String,
    enum: ['docx', 'doc', 'pdf', null], // null — трек 1 (без файлу)
    default: null,
  },
  // Оригінальний файл викладача, незмінний
  originalFile: {
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    path: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  },
  // Результат services/document.loadDocument: лише блоки вхідного файлу (джерело правди — state)
  document: {
    docVersion: String,
    format: String,
    meta: mongoose.Schema.Types.Mixed,
    convertedFrom: { type: String, enum: ['doc', 'pdf', null], default: null }, // 'pdf' — лише v4-силабуси,
    blocks: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  },
  // Похідний плоский текст (blocks.map(text).join('\n')) для пошуку і звітів
  extractedText: String,
  status: {
    type: String,
    enum: ['analyzing', 'in_progress', 'error'],
    default: 'analyzing'
  },
  analysisStage: { type: String, enum: [...ANALYSIS_STAGES, null], default: null },
  // Коли розпочато поточний аналіз (для відновлення завислих) і текст останньої помилки
  analysisStartedAt: Date,
  analysisLeaseUntil: Date,
  analysisLeaseToken: { type: String, select: false },
  analysisAttempts: { type: Number, default: 0 },
  analysisError: String,
  // Силабуси до v4 (без document): чат лише читається, мутації → 409 LEGACY_SYLLABUS
  legacy: {
    type: Boolean,
    default: false
  },
  // v5: структурований стан — єдине джерело правди (docs/api-v5.md §1). Пише лише syllabusState/store
  state: mongoose.Schema.Types.Mixed,
  stateRevision: { type: Number, default: 0 },
  // Знімок стану після парсингу (трек 2) або створення (трек 1) — основа для diff у правій панелі
  baselineState: mongoose.Schema.Types.Mixed,
  // Лічильник завантажень .docx (метрика MVP)
  downloads: { type: Number, default: 0 },
  // Силабус v4, ще не перебудований у v5
  needsRebuild: { type: Boolean, default: false },
  // Заготовка з ТЗ §10
  plagiarismCheck: {
    similarSyllabi: { type: mongoose.Schema.Types.Mixed, default: null },
  },
}, {
  timestamps: true
});

syllabusSchema.index({ instructor: 1, createdAt: -1 });
syllabusSchema.index({ status: 1 });
syllabusSchema.index({ programId: 1, status: 1 });
syllabusSchema.index({ programId: 1, updatedAt: -1 });
// Пара курс × набір (CourseOffering) має один силабус (доповнення 29.10 §3); силабуси без призначення не обмежуються
syllabusSchema.index({ offeringId: 1 }, { unique: true, partialFilterExpression: { offeringId: { $type: 'objectId' } } });

syllabusSchema.statics.ANALYSIS_STAGES = ANALYSIS_STAGES;

/**
 * Файли силабусу на диску, якими керує модель: лише оригінал. Вихідний .docx рендериться в
 * uploads/outputs/<id>/ і видаляється через outputs.removeOutputDir.
 */
syllabusSchema.statics.filePaths = function(doc) {
  return [doc?.originalFile?.path].filter(Boolean);
};

syllabusSchema.statics.FILE_FIELDS = 'originalFile.path';

syllabusSchema.methods.cleanupFiles = async function(fsPromises) {
  const fs = fsPromises || require('fs').promises;
  for (const p of new Set(this.constructor.filePaths(this))) {
    try { await fs.unlink(p); } catch { /* best-effort */ }
  }
};

syllabusSchema.statics.cleanupFilesByFilter = async function(filter = {}) {
  const fs = require('fs').promises;
  const docs = await this.find(filter).select(this.FILE_FIELDS);
  for (const doc of docs) {
    await doc.cleanupFiles(fs);
  }
};

module.exports = mongoose.model('Syllabus', syllabusSchema);
