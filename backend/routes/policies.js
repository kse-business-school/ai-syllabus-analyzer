const express = require('express');
const mongoose = require('mongoose');
const Policy = require('../models/Policy');
const { auth, requireRole } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

const { policyMarkdown } = require('../services/references/policies');

const router = express.Router();
const POLICY_TYPES = ['ai-policy', 'academic-integrity', 'teaching-tips', 'syllabus-policy'];
const SYLLABUS_POLICY = 'syllabus-policy';

// options приходять масивом (JSON) або рядком JSON (multipart)
function parseOptions(raw) {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

// Валідація правки довідника: ключі варіантів незмінні, змінюються лише label/text
function validateLibraryEdit(policy, body) {
  if (body.key !== undefined && body.key !== policy.key) return 'The block key cannot be changed';
  if (body.mode !== undefined && body.mode !== policy.mode) return 'The block mode cannot be changed';
  if (body.type !== undefined && body.type !== SYLLABUS_POLICY) return 'The library block type cannot be changed';
  if (body.text !== undefined) {
    if (policy.mode !== 'locked') return 'The text field is only available for locked blocks';
    if (typeof body.text !== 'string' || !body.text.trim()) return 'Text cannot be empty';
  }
  const options = parseOptions(body.options);
  if (options !== undefined) {
    if (policy.mode !== 'library') return 'The options field is only available for library blocks';
    const keys = (policy.options || []).map((o) => o.key).sort().join('|');
    const ok = Array.isArray(options)
      && options.every((o) => o && typeof o.key === 'string' && typeof o.label === 'string' && o.label.trim() && typeof o.text === 'string' && o.text.trim())
      && options.map((o) => o.key).sort().join('|') === keys;
    if (!ok) return 'Options must keep the same keys, with non-empty label and text';
  }
  return null;
}

router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid document id' });
  }
  next();
});

function parseBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/policies');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'policy-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.doc', '.docx', '.txt', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(Object.assign(new Error('Unsupported file type. Allowed: PDF, DOC, DOCX, TXT, MD'), { statusCode: 400 }));
    }
  }
});

// Get all policies
router.get('/', auth, async (req, res) => {
  try {
    const { type, isActive = true } = req.query;
    const query = { isActive };

    if (type) {
      query.type = type;
    }

    const policies = await Policy.find(query)
      .populate('createdBy', 'firstName lastName')
      .sort(type === SYLLABUS_POLICY ? { order: 1 } : { createdAt: -1 });

    // Add acknowledgment status for current user
    const policiesWithStatus = policies.map(policy => ({
      ...policy.toObject(),
      isAcknowledged: policy.isAcknowledgedBy(req.user.userId)
    }));

    res.json({ policies: policiesWithStatus });
  } catch (error) {
    console.error('Get policies error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get specific policy
router.get('/:id', auth, async (req, res) => {
  try {
    const policy = await Policy.findById(req.params.id)
      .populate('createdBy', 'firstName lastName');

    if (!policy) {
      return res.status(404).json({ message: 'Document not found' });
    }

    res.json({
      policy: {
        ...policy.toObject(),
        isAcknowledged: policy.isAcknowledgedBy(req.user.userId)
      }
    });
  } catch (error) {
    console.error('Get policy error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create new policy (admin only)
router.post('/', 
  auth, 
  requireRole('admin'), 
  upload.single('file'),
  async (req, res) => {
  try {
    // Manual validation since we can't use express-validator array with multer
    if (!req.body.title || !req.body.title.trim()) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Title is required' });
    }
    if ((!req.body.content || !req.body.content.trim()) && !req.file) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Content is required' });
    }
    if (req.body.contentType && !['markdown', 'plain'].includes(req.body.contentType)) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Invalid content type' });
    }
    if (req.body.type === SYLLABUS_POLICY) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Policy library blocks are created by the seed, not through the API' });
    }
    if (!req.body.type || !POLICY_TYPES.includes(req.body.type)) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Invalid document type' });
    }

    const { title, type, contentType = 'markdown' } = req.body;
    const content = req.body.content?.trim() || (req.file ? 'See the attached file.' : '');

    const policyData = {
      title: title.trim(),
      content,
      contentType,
      type,
      isRequired: parseBoolean(req.body.isRequired, true),
      createdBy: req.user.userId
    };

    // Add file info if uploaded
    if (req.file) {
      policyData.attachedFile = {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
      };
    }

    const policy = new Policy(policyData);
    await policy.save();

    res.status(201).json({
      message: 'Document created',
      policy
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    console.error('Create policy error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update policy (admin, manager, director)
router.put('/:id',
  auth,
  requireRole('admin', 'manager', 'director'),
  upload.single('file'),
  async (req, res) => {
  try {
    // Manual validation
    if (req.body.title !== undefined && !req.body.title.trim()) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Title cannot be empty' });
    }
    if (req.body.content !== undefined && !req.body.content.trim()) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Content cannot be empty' });
    }
    if (req.body.contentType && !['markdown', 'plain'].includes(req.body.contentType)) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Invalid content type' });
    }
    if (req.body.type && !POLICY_TYPES.includes(req.body.type)) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Invalid document type' });
    }

    const policy = await Policy.findById(req.params.id);

    if (!policy) {
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      return res.status(404).json({ message: 'Document not found' });
    }

    const { title, content, contentType, type, isRequired, isActive } = req.body;

    if (policy.type === SYLLABUS_POLICY) {
      const problem = validateLibraryEdit(policy, req.body);
      if (problem || req.file) {
        if (req.file) await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ message: problem || 'Files cannot be attached to library blocks' });
      }
      const options = parseOptions(req.body.options);
      const before = policyMarkdown(policy);
      if (title !== undefined) policy.title = title;
      if (req.body.titleUk !== undefined) policy.titleUk = req.body.titleUk;
      if (req.body.rationale !== undefined) policy.rationale = req.body.rationale;
      if (isActive !== undefined) policy.isActive = isActive;
      if (req.body.text !== undefined) policy.text = req.body.text;
      if (options !== undefined) policy.options = options.map(({ key, label, text }) => ({ key, label, text }));
      // content — похідне від варіантів/тексту; libraryVersion лишається, тож сід не перезапише правку
      policy.content = policyMarkdown(policy);
      if (policy.content !== before) policy.version += 1;
      policy.adminModified = true;
      await policy.save();
      return res.json({ message: 'Document updated', policy });
    }
    if (type === SYLLABUS_POLICY) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Invalid document type' });
    }

    // Версію піднімаємо, порівнюючи з поточним значенням ДО присвоєння
    let contentChanged = content !== undefined && content !== policy.content;

    if (title !== undefined) policy.title = title;
    if (content !== undefined) policy.content = content;
    if (contentType !== undefined) policy.contentType = contentType;
    if (type !== undefined) policy.type = type;
    if (isRequired !== undefined) policy.isRequired = isRequired;
    if (isActive !== undefined) policy.isActive = isActive;

    // Handle file upload
    if (req.file) {
      // Delete old file if exists
      if (policy.attachedFile?.path) {
        await fs.unlink(policy.attachedFile.path).catch(() => {});
      }
      
      policy.attachedFile = {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
      };
      contentChanged = true;
    }

    // Нова версія вимагає повторного ознайомлення
    if (contentChanged) {
      policy.version += 1;
    }

    await policy.save();

    res.json({
      message: 'Document updated',
      policy
    });
  } catch (error) {
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    console.error('Update policy error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete policy (admin only)
router.delete('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const policy = await Policy.findById(req.params.id);

    if (!policy) {
      return res.status(404).json({ message: 'Document not found' });
    }

    if (policy.type === SYLLABUS_POLICY) {
      return res.status(409).json({ message: 'Policy library blocks cannot be deleted; deactivate the block with isActive' });
    }

    // Delete associated file if exists
    if (policy.attachedFile?.path) {
      await fs.unlink(policy.attachedFile.path).catch(() => {});
    }

    await Policy.findByIdAndDelete(req.params.id);

    res.json({ message: 'Document deleted' });
  } catch (error) {
    console.error('Delete policy error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Acknowledge policy
router.post('/:id/acknowledge', auth, async (req, res) => {
  try {
    const policy = await Policy.findById(req.params.id);

    if (!policy) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Підтвердження чинне лише для поточної версії документа
    if (policy.isAcknowledgedBy(req.user.userId)) {
      return res.status(400).json({ message: 'The document is already approved' });
    }

    const existing = policy.acknowledgments.find((ack) => ack.user.toString() === req.user.userId);
    if (existing) {
      existing.version = policy.version;
      existing.acknowledgedAt = new Date();
    } else {
      policy.acknowledgments.push({
        user: req.user.userId,
        version: policy.version
      });
    }

    await policy.save();

    res.json({
      message: 'Document approved',
      acknowledgedAt: new Date()
    });
  } catch (error) {
    console.error('Acknowledge policy error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get acknowledgment status for user
router.get('/:id/status', auth, async (req, res) => {
  try {
    const policy = await Policy.findById(req.params.id);

    if (!policy) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const isAcknowledged = policy.isAcknowledgedBy(req.user.userId);
    const acknowledgment = policy.acknowledgments.find(
      ack => ack.user.toString() === req.user.userId
    );

    res.json({
      isAcknowledged,
      acknowledgedAt: acknowledgment?.acknowledgedAt,
      version: acknowledgment?.version,
      currentVersion: policy.version,
      needsReAcknowledgment: acknowledgment && acknowledgment.version < policy.version
    });
  } catch (error) {
    console.error('Get acknowledgment status error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Download attached file
router.get('/:id/download', auth, async (req, res) => {
  try {
    const policy = await Policy.findById(req.params.id);

    if (!policy) {
      return res.status(404).json({ message: 'Document not found' });
    }

    if (!policy.attachedFile || !policy.attachedFile.path) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Check if file exists
    try {
      await fs.access(policy.attachedFile.path);
    } catch {
      return res.status(404).json({ message: 'The file was not found on the server' });
    }

    res.download(policy.attachedFile.path, policy.attachedFile.originalName);
  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
