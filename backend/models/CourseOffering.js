const mongoose = require('mongoose');

// Призначення курсу до набору (ТЗ, доповнення 29.10 §3): курс × набір із власним типом.
// Курс читається в кількох наборах і має в кожному свій тип (Risk Management: core у MBA27, elective у MBA28).
// Окремої сутності «курс» поки немає, курс ідентифікується кодом (як Syllabus.course.code).
const courseOfferingSchema = new mongoose.Schema({
  programCode: { type: String, required: true, uppercase: true, trim: true },
  courseCode: { type: String, required: true, trim: true },
  courseName: { type: String, default: '', trim: true },
  type: { type: String, enum: ['core', 'elective'], required: true },
  lecturerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deadline: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Один курс в одному наборі — одне призначення
courseOfferingSchema.index({ programCode: 1, courseCode: 1 }, { unique: true });
courseOfferingSchema.index({ lecturerId: 1 });

module.exports = mongoose.model('CourseOffering', courseOfferingSchema);
