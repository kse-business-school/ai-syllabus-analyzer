const express = require('express');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { body, query, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const Syllabus = require('../models/Syllabus');
const Suggestion = require('../models/Suggestion');
const workspaceService = require('../services/workspaceService');
const { needsRebuildError } = require('../services/chat/state');
const { sendError } = require('../utils/httpError');
const { canSeeAll } = require('../services/roles');

const router = express.Router();

// Жорсткіший ліміт на LLM-дії чату (вільні повідомлення, Reword, Answer). Ключ — користувач.
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.CHAT_MESSAGE_RATE_LIMIT || '30', 10),
  standardHeaders: true,
  legacyHeaders: false,
  // Викликається після auth, тож ключ — перевірений userId
  keyGenerator: (req) => (req.user?.userId ? `user:${req.user.userId}` : req.ip),
  message: { message: 'Too many requests to the AI. Please wait a minute.' },
});

router.param('syllabusId', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid syllabus id' });
  }
  next();
});

router.param('sid', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid suggestion id' });
  }
  next();
});

function isOwner(syllabus, user) {
  return syllabus.instructor && syllabus.instructor.toString() === user.userId;
}

async function loadSyllabusOrFail(syllabusId, res) {
  const syllabus = await Syllabus.findById(syllabusId).select('instructor status legacy needsRebuild');
  if (!syllabus) {
    res.status(404).json({ message: 'Syllabus not found' });
    return null;
  }
  return syllabus;
}

// Читання: власник, manager, director або admin. Мутації: лише власник (решта — read-only у чаті), не для силабусів v4.
async function gateRead(req, res, next) {
  try {
    const syllabus = await loadSyllabusOrFail(req.params.syllabusId, res);
    if (!syllabus) return;
    if (!isOwner(syllabus, req.user) && !canSeeAll(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    req.syllabus = syllabus;
    next();
  } catch (err) {
    next(err);
  }
}

async function gateMutate(req, res, next) {
  try {
    const syllabus = await loadSyllabusOrFail(req.params.syllabusId, res);
    if (!syllabus) return;
    if (!isOwner(syllabus, req.user)) {
      return res.status(403).json({ message: 'Only the syllabus owner can change the conversation' });
    }
    if (syllabus.legacy || syllabus.needsRebuild) return sendError(res, needsRebuildError());
    req.syllabus = syllabus;
    next();
  } catch (err) {
    next(err);
  }
}

function validationFailed(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ message: 'Validation error', errors: errors.array() });
  return true;
}

function view(req) {
  return workspaceService.getConversationView(req.params.syllabusId, { userId: req.user.userId });
}

/** Обгортка для мутацій: валідація → дія → GET-view (дія може повернути додаткові поля відповіді). */
function mutation(action, fallbackMessage) {
  return async (req, res) => {
    if (validationFailed(req, res)) return;
    try {
      const result = await action(req);
      // Сервіси можуть повертати Mongoose-документ; у View не віддаємо його службові поля.
      const extra = Array.isArray(result?.approved) && Array.isArray(result?.skipped)
        ? { approved: result.approved, skipped: result.skipped } : {};
      res.json({ ...(await view(req)), ...extra });
    } catch (err) {
      sendError(res, err, fallbackMessage || 'Something went wrong. Please try again.');
    }
  };
}

const expectedRevision = body('expectedRevision').optional({ nullable: true }).isInt({ min: 0 }).withMessage('expectedRevision must be a non-negative integer').toInt();
const revisionOf = (req) => (req.body.expectedRevision === null ? undefined : req.body.expectedRevision);

// GET /api/chat/:syllabusId — View: стан, розділи, readiness, перевірки, картки, розмова
router.get('/:syllabusId', auth, gateRead, async (req, res) => {
  try {
    res.json(await view(req));
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/chat/:syllabusId/start — створити розмову (ідемпотентно): привітання і перший крок
router.post('/:syllabusId/start', auth, gateMutate,
  mutation((req) => workspaceService.startConversation(req.params.syllabusId, req.user.userId)));

// GET /api/chat/:syllabusId/document?diff=0|1 — права панель
router.get('/:syllabusId/document', auth, gateRead, [
  query('diff').optional().isIn(['0', '1']).withMessage('diff must be 0 or 1'),
], async (req, res) => {
  if (validationFailed(req, res)) return;
  try {
    res.json(await workspaceService.documentView(req.params.syllabusId, { diff: req.query.diff === '1' }));
  } catch (err) {
    sendError(res, err, 'Could not build the document view');
  }
});

// ---------- розділи ----------

// body { sections?: [key], expectedRevision? } — sections: лише розділи з картки approve-all
router.post('/:syllabusId/sections/approve-all', auth, gateMutate, [
  expectedRevision,
  body('sections').optional({ nullable: true }).isArray({ max: 50 }).withMessage('sections must be an array of section keys'),
  body('sections.*').isString().isLength({ min: 1, max: 100 }).withMessage('Invalid section key'),
], mutation((req) => workspaceService.approveAllSections(req.params.syllabusId, {
  userId: req.user.userId, expectedRevision: revisionOf(req), keys: req.body.sections || undefined,
})));

router.post('/:syllabusId/sections/:key/approve', auth, gateMutate, [expectedRevision],
  mutation(async (req) => {
    await workspaceService.approveSection(req.params.syllabusId, req.params.key, { userId: req.user.userId, expectedRevision: revisionOf(req) });
  }));

router.delete('/:syllabusId/sections/:key/approve', auth, gateMutate,
  mutation(async (req) => {
    await workspaceService.unapproveSection(req.params.syllabusId, req.params.key, { userId: req.user.userId });
  }));

// Мова документа (B-1.2): лише власник; написаний текст не перекладається
router.put('/:syllabusId/language', auth, gateMutate, [
  body('language').isIn(['en', 'uk']).withMessage('language must be "en" or "uk"'),
  expectedRevision,
], mutation((req) => workspaceService.setDocumentLanguage(req.params.syllabusId, req.body.language, {
  userId: req.user.userId, expectedRevision: revisionOf(req),
})));

// Корпус і блок програми (B-8.6): лише власник, значення із закритого списку програми
router.put('/:syllabusId/program-block', auth, gateMutate, [
  body('programBlock').optional({ nullable: true }).isString().isLength({ max: 200 }),
  expectedRevision,
], mutation((req) => workspaceService.setProgramBlock(req.params.syllabusId, req.body.programBlock ?? null, {
  userId: req.user.userId, expectedRevision: revisionOf(req),
})));

// ---------- політики ----------

router.post('/:syllabusId/policies/:key/choose', auth, gateMutate, [
  body('optionKey').optional({ nullable: true }).isString().isLength({ min: 1, max: 100 }).withMessage('Invalid optionKey'),
  body('writeOwn').optional({ nullable: true }).isBoolean().withMessage('writeOwn must be boolean').toBoolean(),
  body('keepText').optional({ nullable: true }).isBoolean().withMessage('keepText must be boolean').toBoolean(),
  body().custom((value) => {
    const chosen = [value.optionKey, value.writeOwn === true || undefined, value.keepText === true || undefined].filter(Boolean);
    if (chosen.length !== 1) throw new Error('Send exactly one of optionKey, writeOwn or keepText');
    return true;
  }),
  expectedRevision,
], mutation((req) => workspaceService.choosePolicy(req.params.syllabusId, req.params.key, {
  optionKey: req.body.optionKey || null,
  writeOwn: req.body.writeOwn === true,
  keepText: req.body.keepText === true,
  expectedRevision: revisionOf(req),
}, req.user.userId)));

// ---------- рішення по картках ----------

router.post('/:syllabusId/suggestions/:sid/accept', auth, gateMutate, [
  body('optionId').optional({ nullable: true }).isString().isLength({ max: 100 }).withMessage('Invalid optionId'),
  expectedRevision,
], mutation((req) => workspaceService.acceptSuggestion(
  req.params.syllabusId, req.params.sid,
  { optionId: req.body.optionId || null, expectedRevision: revisionOf(req) },
  req.user.userId,
)));

router.post('/:syllabusId/suggestions/:sid/values', auth, gateMutate, [
  body('values').isArray({ min: 1, max: 50 }).withMessage('values must be a non-empty array'),
  body('values.*.id').isString().isLength({ min: 1, max: 50 }).withMessage('Each value needs an id'),
  body('values.*.value').optional().isString().isLength({ min: 1, max: 500 }).withMessage('A value must be 1–500 characters'),
  body('values.*.confirmed').optional().isBoolean().withMessage('confirmed must be boolean').toBoolean(),
], mutation((req) => workspaceService.updateValues(req.params.syllabusId, req.params.sid, { values: req.body.values }, req.user.userId)));

router.post('/:syllabusId/suggestions/:sid/reject', auth, gateMutate, [
  body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }).withMessage('The reason must be a string up to 2000 characters'),
  body('rejectTag').optional({ nullable: true }).isIn(Suggestion.REJECT_TAGS).withMessage('Invalid reason category'),
], mutation((req) => workspaceService.rejectSuggestion(
  req.params.syllabusId, req.params.sid,
  { reason: req.body.reason || null, rejectTag: req.body.rejectTag || null },
  req.user.userId,
)));

router.post('/:syllabusId/suggestions/:sid/refine', auth, messageLimiter, gateMutate, [
  body('feedback').isString().trim().isLength({ min: 1, max: 4000 }).withMessage('Feedback must be 1–4000 characters'),
], mutation((req) => workspaceService.refineSuggestion(
  req.params.syllabusId, req.params.sid, { feedback: req.body.feedback }, req.user.userId,
), 'Could not reword the draft'));

router.post('/:syllabusId/suggestions/:sid/answer', auth, messageLimiter, gateMutate, [
  body('answer').isString().trim().isLength({ min: 1, max: 4000 }).withMessage('The answer must be 1–4000 characters'),
], mutation((req) => workspaceService.answerSuggestion(
  req.params.syllabusId, req.params.sid, { answer: req.body.answer }, req.user.userId,
), 'Could not prepare a draft'));

router.post('/:syllabusId/suggestions/:sid/reopen', auth, gateMutate,
  mutation((req) => workspaceService.reopenSuggestion(req.params.syllabusId, req.params.sid, req.user.userId),
    'Could not reopen the suggestion'));

// ---------- розмова ----------

// POST /api/chat/:syllabusId/message — хід оркестратора з інструментами
router.post('/:syllabusId/message', auth, messageLimiter, gateMutate, [
  body('text').isString().trim().isLength({ min: 1, max: 4000 }).withMessage('The text must be 1–4000 characters'),
], mutation((req) => workspaceService.freeChatMessage(req.params.syllabusId, req.body.text, req.user.userId)));

// POST /api/chat/:syllabusId/skip — пропустити слот
router.post('/:syllabusId/skip', auth, gateMutate, [
  body('slotKey').isString().trim().isLength({ min: 1, max: 100 }).withMessage('slotKey is required'),
], mutation((req) => workspaceService.skipSlot(req.params.syllabusId, req.body.slotKey, req.user.userId)));

// GET /api/chat/:syllabusId/outputs/syllabus.docx — доступний на будь-якому етапі
router.get('/:syllabusId/outputs/:name', auth, gateRead, async (req, res) => {
  try {
    const file = await workspaceService.getOutputFile(req.params.syllabusId, req.params.name);
    res.setHeader('Content-Type', file.contentType);
    res.download(file.path, file.filename, { headers: { 'Content-Type': file.contentType } }, (err) => {
      if (err && !res.headersSent) sendError(res, err, 'File transfer failed');
    });
  } catch (err) {
    sendError(res, err, 'Could not prepare the file');
  }
});

module.exports = router;
