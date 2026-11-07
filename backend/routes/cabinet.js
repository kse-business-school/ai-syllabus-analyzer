const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');
const { body, param, validationResult } = require('express-validator');
const { auth, requireRole } = require('../middleware/auth');
const Program = require('../models/Program');
const User = require('../models/User');
const Syllabus = require('../models/Syllabus');
const Suggestion = require('../models/Suggestion');
const { computeReadiness } = require('../services/syllabusState/readiness');
const { getRefs, getOutcomes, assertKnownProgramCode } = require('../services/references');
const { buildCoverage } = require('../services/plo/coverage');
const { sendInvitationEmail } = require('../services/emailService');
const { isLastActiveAdmin } = require('../services/userService');
const { generateToken } = require('../utils/tokens');
const CourseOffering = require('../models/CourseOffering');
const { ROLES, PROGRAMME_ROLES, canSeeAll } = require('../services/roles');
const { assertOfferingRefs, syncOfferingSyllabi } = require('../services/offerings');
const { setEditions, createProgram, deleteProgram } = require('../services/programs');
const { httpError, sendError } = require('../utils/httpError');

const admin = requireRole('admin');
const programmeStaff = requireRole(...PROGRAMME_ROLES);

// Кого повертають метрики й список: «mine» — лише власні силабуси; «all» дозволено manager/director/admin
function ownerFilter(req) {
  const wantsAll = req.query.scope === 'all';
  if (wantsAll && !canSeeAll(req.user.role)) return { denied: true };
  return wantsAll ? {} : { instructor: new mongoose.Types.ObjectId(req.user.userId) };
}
const MAX_LIMIT = 100;

function validationFailed(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  return true;
}

function parsePaging(query, defaultLimit) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function isValidId(id) {
  return mongoose.isValidObjectId(id);
}

// ─── Programs ────────────────────────────────────────────────────────────────

router.get('/programs', auth, async (req, res) => {
  try {
    const programs = await Program.find().sort({ name: 1 });
    res.json(programs);
  } catch (err) {
    console.error('List programs error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Програма з наборами: editions [{ code, label, copyFrom? }] — коди наборів (MBA28, EMBA25…), copyFrom копіює довідники.
// Логіка й відкат — services/programs (createProgram / setEditions / deleteProgram)
router.post('/programs', auth, admin, async (req, res) => {
  try {
    const { program, copied } = await createProgram(req.body || {}, { userId: req.user.userId });
    res.status(201).json({ ...program.toObject(), copied });
  } catch (err) {
    if (err.code === 11000) return sendError(res, httpError(409, 'A programme with this code already exists', { code: 'PROGRAM_EXISTS' }));
    if (err.name === 'ValidationError') return sendError(res, httpError(400, err.message, { code: 'VALIDATION_ERROR' }));
    sendError(res, err);
  }
});

router.put('/programs/:id', auth, admin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return sendError(res, httpError(400, 'Invalid programme id', { code: 'INVALID_ID' }));
    const { name, academicDirectorEmail, editions, defaultLanguage } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (defaultLanguage !== undefined) update.defaultLanguage = defaultLanguage;
    if (req.body.passingScore !== undefined) update.passingScore = req.body.passingScore === null || req.body.passingScore === '' ? null : Number(req.body.passingScore);
    // Поріг, блоки й мова програми входять у refs: кеш довідників скидається одразу (B07)
    if (Object.keys(update).length) require('../services/references').invalidateCache();
    if (academicDirectorEmail !== undefined) update.academicDirectorEmail = academicDirectorEmail;
    let program = await Program.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!program) return sendError(res, httpError(404, 'Programme not found', { code: 'PROGRAM_NOT_FOUND' }));
    let copied = {};
    // Набори замінюються списком: нові додаються (з копією довідників), невикористані прибираються
    if (editions !== undefined) ({ program, copied } = await setEditions(program._id, editions));
    res.json({ ...program.toObject(), copied });
  } catch (err) {
    if (err.name === 'ValidationError') return sendError(res, httpError(400, err.message, { code: 'VALIDATION_ERROR' }));
    sendError(res, err);
  }
});

// Видалення: ні силабусів програми, ні силабусів чи призначень курсів її наборів (C14)
router.delete('/programs/:id', auth, admin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return sendError(res, httpError(400, 'Invalid programme id', { code: 'INVALID_ID' }));
    await deleteProgram(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    sendError(res, err);
  }
});

// ─── Metrics ─────────────────────────────────────────────────────────────────

// Readiness силабусу зі state; refs (шаблон і обов'язковість розділів) — за programCode, кешуються в getRefs
async function stateReadiness(syllabus, refsCache) {
  if (!syllabus.state) return null;
  const code = syllabus.state.programCode || syllabus.programCode;
  if (!refsCache.has(code)) refsCache.set(code, getRefs(code).catch(() => undefined));
  return computeReadiness(syllabus.state, { refs: await refsCache.get(code) });
}

async function countReady100(filter) {
  const refsCache = new Map();
  let ready = 0;
  const cursor = Syllabus.find({ ...filter, state: { $exists: true, $ne: null } }).select('state programCode').lean().cursor();
  for await (const syllabus of cursor) {
    const r = await stateReadiness(syllabus, refsCache);
    if (r && r.score === 100) ready += 1;
  }
  return ready;
}

router.get('/metrics', auth, async (req, res) => {
  try {
    const filter = ownerFilter(req);
    if (filter.denied) return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    const [total, inProgress, downloads, ready100] = await Promise.all([
      Syllabus.countDocuments(filter),
      Syllabus.countDocuments({ ...filter, status: 'in_progress' }),
      Syllabus.aggregate([{ $match: filter }, { $group: { _id: null, sum: { $sum: '$downloads' } } }]),
      countReady100(filter),
    ]);
    res.json({ total, inProgress, downloads: downloads[0]?.sum || 0, ready100 });
  } catch (err) {
    console.error('Metrics error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── Syllabi ─────────────────────────────────────────────────────────────────

// Проєкція для списку: метадані, без документа і текстів
const LIST_PROJECTION = [
  'title', 'course', 'instructor', 'programId', 'programCode', 'track', 'status', 'analysisStage',
  'analysisError', 'sourceFormat', 'legacy', 'needsRebuild', 'downloads', 'stateRevision', 'state',
  'document.convertedFrom', 'createdAt', 'updatedAt',
].join(' ');

// Лічильники пропозицій по силабусах: { syllabusId → { pending, accepted, rejected, total } }
async function suggestionCounts(syllabusIds) {
  const rows = await Suggestion.aggregate([
    { $match: { syllabusId: { $in: syllabusIds } } },
    { $group: { _id: { syllabusId: '$syllabusId', status: '$status' }, count: { $sum: 1 } } },
  ]);
  const bySyllabus = new Map();
  for (const r of rows) {
    const key = String(r._id.syllabusId);
    if (!bySyllabus.has(key)) bySyllabus.set(key, { pending: 0, accepted: 0, rejected: 0, total: 0 });
    const counts = bySyllabus.get(key);
    if (r._id.status in counts) counts[r._id.status] = r.count;
    counts.total += r.count;
  }
  return bySyllabus;
}

router.get('/syllabi', auth, async (req, res) => {
  try {
    const { program, status, programCode } = req.query;
    const { page, limit, skip } = parsePaging(req.query, 20);
    if (program && !isValidId(program)) return res.status(400).json({ message: 'Invalid programme id' });

    const filter = ownerFilter(req);
    if (filter.denied) return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    if (status) filter.status = String(status);
    if (program) filter.programId = new mongoose.Types.ObjectId(program);
    if (programCode) filter.programCode = String(programCode).toUpperCase();

    const [syllabi, total] = await Promise.all([
      Syllabus.find(filter)
        .select(LIST_PROJECTION)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('instructor', 'firstName lastName email')
        .populate('programId', 'name code')
        .lean(),
      Syllabus.countDocuments(filter),
    ]);

    const counts = await suggestionCounts(syllabi.map((item) => item._id));
    const refsCache = new Map();
    const enriched = await Promise.all(syllabi.map(async (syllabus) => {
      const { document, state, ...meta } = syllabus; // state і baselineState у відповідь не йдуть
      const r = ['analyzing', 'error'].includes(meta.status) ? null : await stateReadiness({ state, programCode: meta.programCode }, refsCache);
      return {
        ...meta,
        convertedFrom: document?.convertedFrom || null,
        legacy: Boolean(meta.legacy),
        needsRebuild: Boolean(meta.needsRebuild),
        outputs: ['syllabus.docx'],
        readiness: r ? { score: r.score, sections: r.sections, counts: r.counts } : { score: 0, sections: {}, counts: null },
        issueCounts: counts.get(String(meta._id)) || { pending: 0, accepted: 0, rejected: 0, total: 0 },
      };
    }));
    res.json({ syllabi: enriched, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('List syllabi error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── Course offerings (course × cohort) ──────────────────────────────────────

// Читання: manager/director/admin бачать усі призначення, викладач — лише свої
router.get('/offerings', auth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.programCode) filter.programCode = String(req.query.programCode).toUpperCase();
    if (!canSeeAll(req.user.role)) filter.lecturerId = new mongoose.Types.ObjectId(req.user.userId);
    const offerings = await CourseOffering.find(filter)
      .sort({ programCode: 1, courseCode: 1 })
      .populate('lecturerId', 'firstName lastName email')
      .lean();
    res.json({ offerings });
  } catch (err) {
    console.error('List offerings error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

const offeringBody = [
  body('programCode').optional().trim().notEmpty().withMessage('programCode cannot be empty'),
  body('courseCode').optional().trim().notEmpty().withMessage('courseCode cannot be empty'),
  body('type').optional().isIn(['core', 'elective']).withMessage('type must be core or elective'),
  body('lecturerId').optional({ nullable: true }).custom((v) => v === null || isValidId(v)).withMessage('Invalid lecturerId'),
  body('deadline').optional({ nullable: true }).isISO8601().withMessage('deadline must be an ISO date'),
];

const offeringNotFound = () => httpError(404, 'Course assignment not found', { code: 'OFFERING_NOT_FOUND' });

router.post('/offerings', auth, programmeStaff, [
  body('programCode').trim().notEmpty().withMessage('programCode is required'),
  body('courseCode').trim().notEmpty().withMessage('courseCode is required'),
  body('type').isIn(['core', 'elective']).withMessage('type must be core or elective'),
  ...offeringBody.slice(3),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const { programCode, courseCode, courseName, type, lecturerId = null, deadline = null } = req.body;
    // Набір — лише відома редакція програми, викладач — наявний активний користувач (courseCode довільний: elective)
    await assertOfferingRefs({ programCode, lecturerId });
    const offering = await CourseOffering.create({
      programCode, courseCode, courseName, type, lecturerId, deadline, createdBy: req.user.userId,
    });
    await syncOfferingSyllabi({ programCode: offering.programCode, courseCode: offering.courseCode, offeringId: offering._id });
    res.status(201).json(offering);
  } catch (err) {
    if (err.code === 11000) return sendError(res, httpError(409, 'This course is already assigned to this cohort', { code: 'OFFERING_EXISTS' }));
    sendError(res, err);
  }
});

router.put('/offerings/:id', auth, programmeStaff, [param('id').isMongoId().withMessage('Invalid offering id'), ...offeringBody], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const update = {};
    for (const key of ['courseName', 'type', 'lecturerId', 'deadline']) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (update.lecturerId) await assertOfferingRefs({ lecturerId: update.lecturerId });
    const offering = await CourseOffering.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!offering) return sendError(res, offeringNotFound());
    // Тип курсу в наборі змінює courseKind: кеш довідників і E-поля силабусів цієї пари оновлюються одразу
    await syncOfferingSyllabi({ programCode: offering.programCode, courseCode: offering.courseCode, offeringId: offering._id });
    res.json(offering);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/offerings/:id', auth, programmeStaff, [param('id').isMongoId().withMessage('Invalid offering id')], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const used = await Syllabus.countDocuments({ offeringId: req.params.id });
    if (used > 0) {
      return sendError(res, httpError(409, `This assignment cannot be deleted: syllabi refer to it (${used})`, { code: 'OFFERING_IN_USE' }));
    }
    const offering = await CourseOffering.findByIdAndDelete(req.params.id);
    if (!offering) return sendError(res, offeringNotFound());
    await syncOfferingSyllabi({ programCode: offering.programCode, courseCode: offering.courseCode });
    res.json({ message: 'Deleted' });
  } catch (err) {
    sendError(res, err);
  }
});

// Викладачі для вибору в призначенні (admin-список користувачів для manager/director закритий)
router.get('/lecturers', auth, programmeStaff, async (req, res) => {
  try {
    const users = await User.find({ isActive: { $ne: false } })
      .select('firstName lastName email role').sort({ lastName: 1, firstName: 1 }).lean();
    res.json({ lecturers: users });
  } catch (err) {
    console.error('List lecturers error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── PLO coverage (ТЗ, доповнення 29.10 §8) ──────────────────────────────────

// Матриця ПРН × курси набору, зібрана зі state силабусів. Читають manager/director/admin
router.get('/plo-coverage', auth, programmeStaff, async (req, res) => {
  try {
    const programCode = await assertKnownProgramCode(req.query.programCode);
    const [outcomes, offerings, syllabi] = await Promise.all([
      getOutcomes(programCode),
      CourseOffering.find({ programCode }).sort({ courseCode: 1 }).lean(),
      Syllabus.find({ programCode, state: { $exists: true, $ne: null } })
        .select('course programCode offeringId instructor status updatedAt state').lean(),
    ]);
    res.json({ programCode, ...buildCoverage({ outcomes, offerings, syllabi }) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message, code: err.code });
    console.error('PLO coverage error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── Users ────────────────────────────────────────────────────────────────────

const USER_SAFE_SELECT = '-password -resetPasswordToken -resetPasswordExpires -emailChangeToken -emailChangeTokenExpires';

router.get('/users', auth, admin, async (req, res) => {
  try {
    const { role } = req.query;
    const { page, limit, skip } = parsePaging(req.query, 50);
    const filter = {};
    if (role) filter.role = String(role);
    const [users, total] = await Promise.all([
      User.find(filter)
        .select(USER_SAFE_SELECT)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);
    res.json({ users, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/users', auth, admin, [
  body('email').isEmail().withMessage('Enter a valid email'),
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('role').optional().isIn(ROLES).withMessage(`Role must be one of: ${ROLES.join(', ')}`),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const { email, firstName, lastName, role = 'instructor' } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(409).json({ message: 'A user with this email already exists' });

    const { raw, hash } = generateToken();

    const user = await User.create({
      email: normalizedEmail,
      firstName,
      lastName,
      role,
      password: crypto.randomBytes(16).toString('hex'),
      isActive: true,
      resetPasswordToken: hash,
      resetPasswordExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    try {
      await sendInvitationEmail(user.email, raw);
    } catch (emailErr) {
      console.error('Invitation email failed:', emailErr.message);
    }

    res.status(201).json({ _id: user._id, email: user.email, firstName, lastName, role });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.patch('/users/:id', auth, admin, [
  param('id').isMongoId().withMessage('Invalid user id'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean').bail().toBoolean(),
  body('role').optional().isIn(ROLES).withMessage(`Role must be one of: ${ROLES.join(', ')}`),
  body().custom((value) => {
    if (value.isActive === undefined && value.role === undefined) {
      throw new Error('Specify isActive or role');
    }
    return true;
  }),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { isActive, role } = req.body;
    const losesAdmin = (isActive === false) || (role !== undefined && role !== 'admin');
    if (losesAdmin && await isLastActiveAdmin(user)) {
      return res.status(409).json({ message: 'The system cannot be left without an active administrator' });
    }

    if (isActive !== undefined) user.isActive = isActive;
    if (role !== undefined) user.role = role;
    await user.save();

    const safe = await User.findById(user._id).select(USER_SAFE_SELECT);
    res.json({ user: safe });
  } catch (err) {
    console.error('Patch user error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
