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
const { getRefs } = require('../services/references');
const { sendInvitationEmail } = require('../services/emailService');
const { isLastActiveAdmin } = require('../services/userService');
const { generateToken } = require('../utils/tokens');
const CourseOffering = require('../models/CourseOffering');
const { ROLES, PROGRAMME_ROLES, canSeeAll } = require('../services/roles');

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
  res.status(400).json({ message: 'Помилка валідації', errors: errors.array() });
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
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
  }
});

router.post('/programs', auth, admin, async (req, res) => {
  try {
    const { name, code, academicDirectorEmail } = req.body;
    if (!name || !code) return res.status(400).json({ message: 'Потрібні name і code' });
    const program = await Program.create({ name, code, academicDirectorEmail, createdBy: req.user.userId });
    res.status(201).json(program);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Програма з таким кодом уже існує' });
    if (err.name === 'ValidationError') return res.status(400).json({ message: err.message });
    console.error('Create program error:', err);
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
  }
});

router.put('/programs/:id', auth, admin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Некоректний id програми' });
    const { name, academicDirectorEmail } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (academicDirectorEmail !== undefined) update.academicDirectorEmail = academicDirectorEmail;
    const program = await Program.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!program) return res.status(404).json({ message: 'Програму не знайдено' });
    res.json(program);
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ message: err.message });
    console.error('Update program error:', err);
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
  }
});

router.delete('/programs/:id', auth, admin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Некоректний id програми' });
    const used = await Syllabus.countDocuments({ programId: req.params.id });
    if (used > 0) {
      return res.status(409).json({ message: `Програму не можна видалити: на неї посилаються силабуси (${used})` });
    }
    const program = await Program.findByIdAndDelete(req.params.id);
    if (!program) return res.status(404).json({ message: 'Програму не знайдено' });
    res.json({ message: 'Видалено' });
  } catch (err) {
    console.error('Delete program error:', err);
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
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
    if (filter.denied) return res.status(403).json({ message: 'Доступ заборонено. Недостатньо прав.' });
    const [total, inProgress, downloads, ready100] = await Promise.all([
      Syllabus.countDocuments(filter),
      Syllabus.countDocuments({ ...filter, status: 'in_progress' }),
      Syllabus.aggregate([{ $match: filter }, { $group: { _id: null, sum: { $sum: '$downloads' } } }]),
      countReady100(filter),
    ]);
    res.json({ total, inProgress, downloads: downloads[0]?.sum || 0, ready100 });
  } catch (err) {
    console.error('Metrics error:', err);
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
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
    if (program && !isValidId(program)) return res.status(400).json({ message: 'Некоректний id програми' });

    const filter = ownerFilter(req);
    if (filter.denied) return res.status(403).json({ message: 'Доступ заборонено. Недостатньо прав.' });
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
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
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
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
  }
});

const offeringBody = [
  body('programCode').optional().trim().notEmpty().withMessage('programCode не може бути порожнім'),
  body('courseCode').optional().trim().notEmpty().withMessage('courseCode не може бути порожнім'),
  body('type').optional().isIn(['core', 'elective']).withMessage('type має бути core або elective'),
  body('lecturerId').optional({ nullable: true }).custom((v) => v === null || isValidId(v)).withMessage('Некоректний lecturerId'),
  body('deadline').optional({ nullable: true }).isISO8601().withMessage('deadline має бути датою ISO'),
];

router.post('/offerings', auth, programmeStaff, [
  body('programCode').trim().notEmpty().withMessage('Потрібен programCode'),
  body('courseCode').trim().notEmpty().withMessage('Потрібен courseCode'),
  body('type').isIn(['core', 'elective']).withMessage('type має бути core або elective'),
  ...offeringBody.slice(3),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const { programCode, courseCode, courseName, type, lecturerId = null, deadline = null } = req.body;
    const offering = await CourseOffering.create({
      programCode, courseCode, courseName, type, lecturerId, deadline, createdBy: req.user.userId,
    });
    res.status(201).json(offering);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Цей курс уже призначено до цього набору' });
    console.error('Create offering error:', err);
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
  }
});

router.put('/offerings/:id', auth, programmeStaff, [param('id').isMongoId(), ...offeringBody], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const update = {};
    for (const key of ['courseName', 'type', 'lecturerId', 'deadline']) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const offering = await CourseOffering.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!offering) return res.status(404).json({ message: 'Призначення не знайдено' });
    res.json(offering);
  } catch (err) {
    console.error('Update offering error:', err);
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
  }
});

router.delete('/offerings/:id', auth, programmeStaff, [param('id').isMongoId()], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const used = await Syllabus.countDocuments({ offeringId: req.params.id });
    if (used > 0) return res.status(409).json({ message: `Призначення не можна видалити: на нього посилаються силабуси (${used})` });
    const offering = await CourseOffering.findByIdAndDelete(req.params.id);
    if (!offering) return res.status(404).json({ message: 'Призначення не знайдено' });
    res.json({ message: 'Видалено' });
  } catch (err) {
    console.error('Delete offering error:', err);
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
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
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
  }
});

router.post('/users', auth, admin, [
  body('email').isEmail().withMessage('Вкажіть коректний email'),
  body('firstName').trim().notEmpty().withMessage('Ім\'я обов\'язкове'),
  body('lastName').trim().notEmpty().withMessage('Прізвище обов\'язкове'),
  body('role').optional().isIn(ROLES).withMessage(`Роль має бути одна з: ${ROLES.join(', ')}`),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const { email, firstName, lastName, role = 'instructor' } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(409).json({ message: 'Користувач з такою поштою вже існує' });

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
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
  }
});

router.patch('/users/:id', auth, admin, [
  param('id').isMongoId().withMessage('Некоректний id користувача'),
  body('isActive').optional().isBoolean().withMessage('isActive має бути boolean').bail().toBoolean(),
  body('role').optional().isIn(ROLES).withMessage(`Роль має бути одна з: ${ROLES.join(', ')}`),
  body().custom((value) => {
    if (value.isActive === undefined && value.role === undefined) {
      throw new Error('Потрібно вказати isActive або role');
    }
    return true;
  }),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Користувача не знайдено' });

    const { isActive, role } = req.body;
    const losesAdmin = (isActive === false) || (role !== undefined && role !== 'admin');
    if (losesAdmin && await isLastActiveAdmin(user)) {
      return res.status(409).json({ message: 'Неможливо залишити систему без активного адміністратора' });
    }

    if (isActive !== undefined) user.isActive = isActive;
    if (role !== undefined) user.role = role;
    await user.save();

    const safe = await User.findById(user._id).select(USER_SAFE_SELECT);
    res.json({ user: safe });
  } catch (err) {
    console.error('Patch user error:', err);
    res.status(500).json({ message: 'Внутрішня помилка сервера' });
  }
});

module.exports = router;
