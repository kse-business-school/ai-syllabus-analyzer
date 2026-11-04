const express = require('express');
const multer = require('multer');
const JSZip = require('jszip');
const path = require('path');
const fs = require('fs').promises;
const { body, validationResult } = require('express-validator');

const mongoose = require('mongoose');
const Syllabus = require('../models/Syllabus');
const Suggestion = require('../models/Suggestion');
const Program = require('../models/Program');
const CourseOffering = require('../models/CourseOffering');
const { auth, requireRole } = require('../middleware/auth');
const analysisRunner = require('../services/analysisRunner');
const { deleteSyllabiCascade, deleteConversationsFor } = require('../services/syllabusCleanup');
const { removeOutputDir } = require('../services/outputs');
const { httpError, sendError } = require('../utils/httpError');
const { getRefs } = require('../services/references');
const { createEmptyState } = require('../services/syllabusState/empty');
const store = require('../services/syllabusState/store');

const { initState } = store;
const { resolveProfile } = require('../services/lecturers/profile');
const { prepareInstructor } = require('../services/lecturers/cards');
const { createDraftSuggestions } = require('../services/chat/draftSuggestions');

const CLEANUP_GRACE_MS = 10 * 60 * 1000;

const router = express.Router();

// Некоректний ObjectId → 400 замість 500
router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid syllabus id', code: 'INVALID_ID' });
  }
  next();
});

function getOwnerId(syllabus) {
  const inst = syllabus && syllabus.instructor;
  if (!inst) return null;
  if (typeof inst === 'object' && inst !== null && inst._id) {
    return inst._id.toString();
  }
  try {
    return inst.toString();
  } catch {
    return null;
  }
}

function isOwner(user, syllabus) {
  const ownerId = getOwnerId(syllabus);
  return !!ownerId && ownerId === user.userId;
}

function isOwnerOrAdmin(user, syllabus) {
  return isOwner(user, syllabus) || user.role === 'admin';
}

const notFound = () => httpError(404, 'Syllabus not found', { code: 'NOT_FOUND' });
const forbidden = (message = 'Access denied') => httpError(403, message, { code: 'FORBIDDEN' });

// Формат визначаємо за розширенням І сигнатурою файлу, а не за mimetype клієнта.
const FORMAT_MIMETYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};

async function detectFormat(filePath, ext) {
  const handle = await fs.open(filePath, 'r');
  let head;
  try {
    const buf = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buf, 0, 8, 0);
    head = buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  const isPdf = head.subarray(0, 4).toString('latin1') === '%PDF';
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // 'PK'
  const isOle = head.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  if (ext === '.pdf' && isPdf) return 'pdf';
  if (ext === '.doc' && isOle) return 'doc';
  // DOCX — це zip з головною частиною word/document.xml
  if (ext === '.docx' && isZip) {
    try {
      const zip = await JSZip.loadAsync(await fs.readFile(filePath));
      return zip.file('word/document.xml') ? 'docx' : null;
    } catch {
      return null;
    }
  }
  return null;
}

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/syllabi');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const UNSUPPORTED_FORMAT_MESSAGE = 'Upload a .docx, .doc or .pdf file';

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760,
  },
  fileFilter: (req, file, cb) => {
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (['.pdf', '.docx', '.doc'].includes(fileExt)) {
      return cb(null, true);
    }
    cb(httpError(400, UNSUPPORTED_FORMAT_MESSAGE, { code: 'UNSUPPORTED_FORMAT' }));
  }
});

async function unlinkQuiet(filePath) {
  if (filePath) await fs.unlink(filePath).catch(() => {});
}

// Помилки multer (формат, розмір) віддаємо з code; розмір лишається на глобальному обробнику (413)
function uploadSingle(req, res, next) {
  upload.single('syllabus')(req, res, (err) => {
    if (err && err.statusCode) return sendError(res, err);
    next(err);
  });
}

// programCode — редакція програми; без редакцій у програмі він дорівнює коду програми
async function resolveProgram(programId, rawProgramCode) {
  const program = await Program.findById(programId).lean();
  if (!program) throw httpError(400, 'Program not found', { code: 'INVALID_PROGRAM_CODE' });
  if (!program.editions || !program.editions.length) return { program, programCode: program.code };
  const programCode = String(rawProgramCode || '').trim().toUpperCase();
  if (!program.editions.some((e) => e.code === programCode)) {
    throw httpError(400, `programCode must be one of: ${program.editions.map((e) => e.code).join(', ')}`, { code: 'INVALID_PROGRAM_CODE' });
  }
  return { program, programCode };
}

// Призначення курсу до набору: programCode і код курсу беруться з нього, а не з тіла запиту.
// Викладач може взяти лише своє призначення (або без викладача); admin — будь-яке.
async function resolveOffering(offeringId, user) {
  if (!offeringId) return null;
  if (!mongoose.isValidObjectId(offeringId)) throw httpError(400, 'Invalid offering id', { code: 'INVALID_OFFERING' });
  const offering = await CourseOffering.findById(offeringId).lean();
  if (!offering) throw httpError(404, 'Course offering not found', { code: 'OFFERING_NOT_FOUND' });
  const own = !offering.lecturerId || String(offering.lecturerId) === String(user.userId);
  if (!own && user.role !== 'admin') throw httpError(403, 'This course is assigned to another lecturer', { code: 'OFFERING_FORBIDDEN' });
  return offering;
}

// Трек 1: силабус з нуля, без файлу. Порожній стан створює createEmptyState, пише його store.initState
router.post('/', auth, [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('programId').trim().notEmpty().withMessage('Program is required')
    .bail()
    .isMongoId().withMessage('Invalid program id'),
  body('courseCode').optional({ nullable: true }).trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', code: 'VALIDATION_ERROR', errors: errors.array() });
    }
    const { title, programId, courseCode } = req.body;
    const offering = await resolveOffering(req.body.offeringId, req.user);
    const { programCode } = await resolveProgram(programId, offering ? offering.programCode : req.body.programCode);
    const code = (offering ? offering.courseCode : courseCode) || undefined;

    const syllabus = await Syllabus.create({
      title,
      course: { code, name: title, year: new Date().getFullYear() },
      instructor: req.user.userId,
      programId,
      programCode,
      offeringId: offering ? offering._id : undefined,
      track: 'scratch',
      sourceFormat: null,
      status: 'in_progress',
    });
    try {
      const refs = await getRefs(programCode);
      const state = createEmptyState({ programCode, track: 'scratch', refs, course: { title, code } });
      const instructorCard = prepareInstructor(state, await resolveProfile(req.user.userId));
      const saved = await initState(syllabus._id, state, { setBaseline: true, refs });
      await createDraftSuggestions([instructorCard], { syllabusId: syllabus._id, state: saved.state, refs });
    } catch (err) {
      await Suggestion.deleteMany({ syllabusId: syllabus._id });
      await Syllabus.deleteOne({ _id: syllabus._id });
      throw err;
    }
    const created = await Syllabus.findById(syllabus._id);
    res.status(201).json({ syllabus: publicSyllabus(created) });
  } catch (error) {
    sendError(res, error);
  }
});

// Upload and analyze syllabus
router.post('/upload', auth, uploadSingle, [
  body('courseName').trim().notEmpty().withMessage('Course name is required'),
  body('courseCode').optional().trim(),
  body('credits').optional().isInt({ min: 1, max: 10 }).withMessage('Credits must be between 1 and 10'),
  body('semester').optional().trim(),
  body('year').optional().isInt({ min: 2020, max: 2030 }).withMessage('Year must be between 2020 and 2030'),
  body('programId').trim().notEmpty().withMessage('Program is required')
    .bail()
    .isMongoId().withMessage('Invalid program id')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      if (req.file) await unlinkQuiet(req.file.path);
      return res.status(400).json({ message: 'Validation failed', code: 'VALIDATION_ERROR', errors: errors.array() });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'A syllabus file is required', code: 'FILE_REQUIRED' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const format = await detectFormat(req.file.path, ext);
    if (!format) {
      await unlinkQuiet(req.file.path);
      return res.status(400).json({ message: 'File content does not match its extension. Upload a real .docx, .doc or .pdf file', code: 'UNSUPPORTED_FORMAT' });
    }

    const { courseName, courseCode, credits, semester, year, programId } = req.body;

    let programCode;
    let offering;
    try {
      offering = await resolveOffering(req.body.offeringId, req.user);
      ({ programCode } = await resolveProgram(programId, offering ? offering.programCode : req.body.programCode));
    } catch (err) {
      await unlinkQuiet(req.file.path);
      throw err;
    }

    // Розбір документа (конвертація .doc/.pdf) іде у фоні як етап `extract`

    const syllabus = new Syllabus({
      title: courseName,
      course: {
        code: offering ? offering.courseCode : courseCode,
        name: courseName,
        credits: credits ? parseInt(credits) : undefined,
        semester,
        year: year ? parseInt(year) : new Date().getFullYear()
      },
      instructor: req.user.userId,
      programId,
      programCode,
      offeringId: offering ? offering._id : undefined,
      track: 'upload',
      originalFile: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: FORMAT_MIMETYPES[format],
        size: req.file.size,
        path: req.file.path
      },
      sourceFormat: format,
      status: 'analyzing',
      analysisStage: 'extract',
      analysisStartedAt: new Date()
    });

    await syllabus.save();
    analysisRunner.runAnalysisInBackground(syllabus._id);

    res.status(201).json({
      message: 'The syllabus was uploaded. Analysis is in progress.',
      syllabusId: syllabus._id,
      status: syllabus.status
    });
  } catch (error) {
    if (req.file) await unlinkQuiet(req.file.path);
    console.error('Syllabus upload error:', error);
    sendError(res, error, 'Internal server error while uploading the file');
  }
});

// Без серверних шляхів до файлів і кешу outputs
function publicSyllabus(syllabus) {
  const obj = syllabus.toObject();
  if (obj.originalFile) delete obj.originalFile.path;
  delete obj.workingFile;
  delete obj.outputs;
  delete obj.submittedPdfPath;
  delete obj.submitting;
  delete obj.state;
  delete obj.baselineState;
  return obj;
}

// Get specific syllabus details
router.get('/:id', auth, async (req, res) => {
  try {
    const syllabus = await Syllabus.findById(req.params.id)
      .populate('instructor', 'firstName lastName email')
      .populate('programId', 'name code academicDirectorEmail');

    if (!syllabus) return sendError(res, notFound());
    if (!isOwnerOrAdmin(req.user, syllabus)) return sendError(res, forbidden('You can only view your own syllabi.'));
    res.json(publicSyllabus(syllabus));
  } catch (error) {
    console.error('Get syllabus error:', error);
    sendError(res, error);
  }
});

// Get syllabus analysis status
router.get('/:id/status', auth, async (req, res) => {
  try {
    const syllabus = await Syllabus.findById(req.params.id)
      .select('status analysisStage analysisError instructor')
      .populate('instructor', '_id');

    if (!syllabus) return sendError(res, notFound());
    if (!isOwnerOrAdmin(req.user, syllabus)) return sendError(res, forbidden());
    res.json({ status: syllabus.status, stage: syllabus.analysisStage || null, error: syllabus.analysisError || null });
  } catch (error) {
    console.error('Get status error:', error);
    sendError(res, error);
  }
});

// Delete syllabus (власник або адмін): каскадно прибирає файли, розмову й повідомлення
router.delete('/:id', auth, async (req, res) => {
  try {
    const syllabus = await Syllabus.findById(req.params.id).select('instructor');
    if (!syllabus) return sendError(res, notFound());
    if (!isOwnerOrAdmin(req.user, syllabus)) return sendError(res, forbidden('You can only delete your own syllabi.'));

    await deleteSyllabiCascade({ _id: syllabus._id });
    res.json({ message: 'The syllabus was deleted' });
  } catch (error) {
    console.error('Delete syllabus error:', error);
    sendError(res, error);
  }
});

// Update syllabus metadata (лише власник). Назва й код курсу синхронізуються зі state.header через store.mutate
// (єдиний писач стану); програму й редакцію змінити не можна — силабус перевіряється проти свого programCode.
router.put('/:id', auth, [
  body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
  body('courseCode').optional().trim(),
  body('courseName').optional().trim(),
  body('credits').optional().isInt({ min: 1, max: 10 }).withMessage('Credits must be between 1 and 10'),
  body('semester').optional().trim(),
  body('year').optional().isInt({ min: 2020, max: 2030 }).withMessage('Year must be between 2020 and 2030'),
  body('programId').optional().isMongoId().withMessage('Invalid program id'),
  body('programCode').optional().isString().withMessage('Invalid programme edition'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', code: 'VALIDATION_ERROR', errors: errors.array() });
    }
    const syllabus = await Syllabus.findById(req.params.id);
    if (!syllabus) return sendError(res, notFound());
    if (!isOwner(req.user, syllabus)) return sendError(res, forbidden('You can only edit your own syllabi.'));
    if (syllabus.status === 'analyzing') {
      return sendError(res, httpError(409, 'The file is still being analysed. Try again when the analysis finishes.', { code: 'ANALYSIS_IN_PROGRESS' }));
    }

    const { title, courseCode, courseName, credits, semester, year, programId, programCode } = req.body;
    const sameProgram = programId === undefined || String(programId) === String(syllabus.programId || '');
    const sameEdition = programCode === undefined || String(programCode).trim().toUpperCase() === String(syllabus.programCode || '');
    if (!sameProgram || !sameEdition) {
      return sendError(res, httpError(400, 'The programme and its edition cannot be changed. Create a new syllabus for another programme.', { code: 'PROGRAM_CHANGE_NOT_ALLOWED' }));
    }

    // Спершу стан (умова на ревізію): якщо запис не вдався, метадані теж не змінюються
    const header = {};
    if (courseName) header.courseTitle = courseName;
    else if (title) header.courseTitle = title;
    if (courseCode !== undefined) header.courseCode = courseCode || null;
    const v5 = syllabus.state && !syllabus.legacy && !syllabus.needsRebuild;
    if (v5 && Object.keys(header).length) {
      await store.mutate(syllabus._id, syllabus.stateRevision || 0, (st) => {
        st.header = { ...st.header, ...header };
      }, { by: req.user.userId, source: 'instructor_directed', refs: await getRefs(syllabus.programCode) });
    }

    const updates = {};
    if (title) updates.title = title;
    if (courseCode !== undefined) updates['course.code'] = courseCode;
    if (courseName !== undefined) updates['course.name'] = courseName;
    if (credits !== undefined) updates['course.credits'] = parseInt(credits, 10);
    if (semester !== undefined) updates['course.semester'] = semester;
    if (year !== undefined) updates['course.year'] = parseInt(year, 10);
    const saved = Object.keys(updates).length
      ? await Syllabus.findByIdAndUpdate(syllabus._id, { $set: updates }, { new: true })
      : await Syllabus.findById(syllabus._id);
    res.json({ message: 'The syllabus was updated', syllabus: publicSyllabus(saved) });
  } catch (error) {
    console.error('Update syllabus error:', error);
    sendError(res, error);
  }
});

// Trigger AI analysis (re-analyze) — лише власник; скидає розмову й похідний стан
router.post('/:id/analyze', auth, async (req, res) => {
  try {
    const syllabus = await Syllabus.findById(req.params.id).select('instructor status track');
    if (!syllabus) return sendError(res, notFound());
    if (!isOwner(req.user, syllabus)) return sendError(res, forbidden('Only the syllabus owner can run the analysis.'));

    if (syllabus.track === 'scratch') {
      return res.status(409).json({ message: 'A syllabus created from scratch has no file to analyze', code: 'NO_SOURCE_FILE' });
    }

    // Атомарне захоплення: два паралельні запити не запустять аналіз двічі
    const claimed = await Syllabus.findOneAndUpdate(
      { _id: syllabus._id, status: { $ne: 'analyzing' } },
      {
        $set: { status: 'analyzing', analysisStage: null, analysisStartedAt: new Date(), analysisAttempts: 0 },
        $unset: { outputs: '', rubricSummary: '', analysisError: '', analysisLeaseUntil: '', analysisLeaseToken: '' },
      },
      { new: false }
    );
    if (!claimed) {
      return res.status(409).json({ message: 'Analysis is already running', code: 'ANALYSIS_RUNNING', status: syllabus.status });
    }

    await removeOutputDir(syllabus._id);
    await Suggestion.deleteMany({ syllabusId: syllabus._id });
    await deleteConversationsFor([syllabus._id]);
    analysisRunner.runAnalysisInBackground(syllabus._id);

    res.json({ message: 'The analysis has started', status: 'analyzing' });
  } catch (error) {
    console.error('Start analysis error:', error);
    sendError(res, error);
  }
});

// Download original syllabus file
router.get('/:id/download', auth, async (req, res) => {
  try {
    const syllabus = await Syllabus.findById(req.params.id);
    if (!syllabus) return sendError(res, notFound());
    if (!isOwnerOrAdmin(req.user, syllabus)) return sendError(res, forbidden());

    const filePath = syllabus.originalFile?.path;
    if (!filePath) {
      return res.status(404).json({ message: 'This syllabus has no uploaded file', code: 'NO_SOURCE_FILE' });
    }
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({ message: 'The uploaded file was not found on the server', code: 'FILE_NOT_FOUND' });
    }
    res.download(filePath, syllabus.originalFile.originalName);
  } catch (error) {
    console.error('Download syllabus error:', error);
    sendError(res, error);
  }
});

// Admin: cleanup orphaned files under uploads/syllabi (файли молодші за 10 хв не чіпаємо)
router.post('/maintenance/cleanup-uploads', auth, requireRole('admin'), async (req, res) => {
  try {
    const dir = path.join(__dirname, '../uploads/syllabi');
    let entries = [];
    try { entries = await fs.readdir(dir); } catch { entries = []; }

    const docs = await Syllabus.find().select(Syllabus.FILE_FIELDS).lean();
    const referenced = new Set(docs.flatMap((d) => Syllabus.filePaths(d)).map((p) => path.basename(p)));

    let deleted = 0;
    for (const name of entries) {
      if (referenced.has(name)) continue;
      const full = path.join(dir, name);
      try {
        const stat = await fs.stat(full);
        if (!stat.isFile() || Date.now() - stat.mtimeMs < CLEANUP_GRACE_MS) continue;
        await fs.unlink(full);
        deleted++;
      } catch { /* ignore */ }
    }
    return res.json({ message: 'Cleanup finished', deleted });
  } catch (e) {
    console.error('Cleanup uploads error:', e);
    return sendError(res, e);
  }
});

module.exports = router;
