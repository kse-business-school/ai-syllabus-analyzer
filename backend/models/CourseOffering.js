const mongoose = require('mongoose');

// Призначення курсу до набору (ТЗ, доповнення 29.10 §3): курс × набір із власним типом.
// Курс читається в кількох наборах і має в кожному свій тип (Risk Management: core у MBA27, elective у MBA28).
// Окремої сутності «курс» поки немає, курс ідентифікується кодом (як Syllabus.course.code).
const courseOfferingSchema = new mongoose.Schema({
  programCode: { type: String, required: true, uppercase: true, trim: true },
  courseCode: { type: String, required: true, trim: true },
  // Нормалізований код курсу (без пробілів, верхній регістр): «foreign.1» і «FOREIGN.1» — той самий курс (C09)
  courseKey: { type: String, default: null },
  courseName: { type: String, default: '', trim: true },
  type: { type: String, enum: ['core', 'elective'], required: true },
  lecturerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deadline: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const courseKeyOf = (code) => String(code || '').normalize('NFC').replace(/\s+/g, '').toUpperCase();
courseOfferingSchema.pre('validate', function setCourseKey(next) {
  if (this.courseCode) this.courseKey = courseKeyOf(this.courseCode);
  next();
});

// Один курс в одному наборі — одне призначення; ключ нормалізований (старі записи без ключа дозаповнює
// scripts/migrate-v5-offerings.js), тому індекс частковий
courseOfferingSchema.index({ programCode: 1, courseKey: 1 }, { unique: true, partialFilterExpression: { courseKey: { $type: 'string' } } });
courseOfferingSchema.index({ lecturerId: 1 });

module.exports = mongoose.model('CourseOffering', courseOfferingSchema);
module.exports.courseKeyOf = courseKeyOf;
