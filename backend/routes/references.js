const express = require('express');
const { auth, requireRole } = require('../middleware/auth');
const ProgramOutcome = require('../models/ProgramOutcome');
const Program = require('../models/Program');
const references = require('../services/references');
const { sendError } = require('../utils/httpError');

// Довідники v5 за programCode (docs/api-v5.md §6 «Довідники»)
const router = express.Router();
router.use(auth);

router.get('/programs', async (req, res) => {
  try {
    const programs = await Program.find().sort({ name: 1 }).lean();
    res.json(programs.map((p) => ({ id: p._id, code: p.code, name: p.name, editions: p.editions || [] })));
  } catch (err) {
    sendError(res, err);
  }
});

const LOADERS = {
  template: references.getTemplate,
  outcomes: references.getOutcomes,
  courses: references.getCourses,
  capstone: references.getCapstone,
};

router.patch('/:programCode/outcomes/:outcomeCode', requireRole('admin', 'manager', 'director'), async (req, res) => {
  try {
    if (Object.keys(req.body).some(key => key !== 'label') || typeof req.body.label !== 'string' || !req.body.label.trim() || req.body.label.trim().length > 120) {
      return res.status(400).json({ message: 'Provide an English label of 1–120 characters. Official outcome text cannot be changed here.', code: 'VALIDATION_ERROR' });
    }
    const programCode = await references.assertKnownProgramCode(req.params.programCode);
    const outcome = await ProgramOutcome.findOneAndUpdate({ programCode, code: req.params.outcomeCode }, { $set: { label: req.body.label.trim() } }, { new: true, runValidators: true });
    if (!outcome) return res.status(404).json({ message: 'Programme outcome not found.', code: 'NOT_FOUND' });
    references.invalidateCache();
    res.json({ code: outcome.code, label: outcome.label, text: outcome.text });
  } catch (error) { sendError(res, error); }
});

router.get('/:programCode/:kind(template|outcomes|courses|capstone)', async (req, res) => {
  try {
    const code = await references.assertKnownProgramCode(req.params.programCode);
    const data = await LOADERS[req.params.kind](code);
    if (data == null) return sendError(res, Object.assign(new Error(`No ${req.params.kind} for ${code}`), { statusCode: 404, code: 'UNKNOWN_PROGRAM_CODE' }));
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
