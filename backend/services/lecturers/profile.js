const User = require('../../models/User');
const Syllabus = require('../../models/Syllabus');
const validator = require('validator');
const crm = require('./crm');
const { httpError } = require('../../utils/httpError');
const { deepEqual } = require('../syllabusState/paths');

const TEXT_FIELDS = ['name', 'position', 'email', 'officeHours', 'assistants'];
const LIST_FIELDS = ['expertise', 'education', 'experience'];
const PROFILE_FIELDS = [...TEXT_FIELDS, ...LIST_FIELDS];
const MAX_TEXT = 1000;
const MAX_ITEMS = 50;

function profileValues(profile = {}) {
  return Object.fromEntries(PROFILE_FIELDS.map((key) => [key, profile[key] ?? (LIST_FIELDS.includes(key) ? [] : '')]));
}

function warningsFor(profile) {
  const count = profile.expertise.length;
  return count < 3 || count > 6 ? ['Areas of Expertise should ideally contain 3–6 items.'] : [];
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'A lecturer profile object is required', { code: 'VALIDATION_ERROR' });
  const patch = {};
  for (const [key, value] of Object.entries(input)) {
    if (!PROFILE_FIELDS.includes(key)) throw httpError(400, `Unknown or read-only profile field: ${key}`, { code: 'VALIDATION_ERROR' });
    if (LIST_FIELDS.includes(key)) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw httpError(400, `${key} must be an array of strings`, { code: 'VALIDATION_ERROR' });
      if (value.length > MAX_ITEMS || value.some((item) => item.length > MAX_TEXT)) throw httpError(400, `${key} is too long`, { code: 'VALIDATION_ERROR' });
      patch[key] = value.map((item) => item.trim()).filter(Boolean);
    } else {
      if (typeof value !== 'string') throw httpError(400, `${key} must be a string`, { code: 'VALIDATION_ERROR' });
      if (value.length > MAX_TEXT) throw httpError(400, `${key} is too long`, { code: 'VALIDATION_ERROR' });
      patch[key] = value.trim();
    }
  }
  if (patch.email && !validator.isEmail(patch.email)) throw httpError(400, 'Enter a valid lecturer email address', { code: 'VALIDATION_ERROR' });
  return patch;
}

// Розділ 2 з попереднього силабуса того самого автора: викладач заповнює дані один раз.
async function previousInstructor(userId, excludeSyllabusId) {
  const filter = { instructor: userId, 'state.instructors.0': { $exists: true } };
  if (excludeSyllabusId) filter._id = { $ne: excludeSyllabusId };
  const previous = await Syllabus.find(filter).sort({ updatedAt: -1 }).limit(10).select('state.instructors updatedAt').lean();
  const found = previous.find((s) => hasInstructor(s.state?.instructors?.[0]));
  return found ? { ...found.state.instructors[0], updatedAt: found.updatedAt } : null;
}

async function resolveProfile(userId, { excludeSyllabusId = null } = {}) {
  const user = await User.findById(userId).select('email firstName lastName lecturerProfile avatarUrl').lean();
  if (!user) throw httpError(404, 'User not found', { code: 'NOT_FOUND' });
  const remote = await crm.getProfile({ userId: String(user._id), email: user.email });
  // Збережений профіль новіший за будь-який силабус лише якщо його справді редагували.
  const saved = user.lecturerProfile?.updatedAt ? user.lecturerProfile : null;
  const carried = remote || saved ? null : await previousInstructor(userId, excludeSyllabusId);
  const local = saved || carried || user.lecturerProfile
    || { name: `${user.firstName} ${user.lastName}`.trim(), email: user.email };
  const profile = {
    ...profileValues(remote || local),
    photo: user.avatarUrl || null,
    updatedAt: (remote || local).updatedAt || null,
    crmId: (remote || local).crmId || null,
  };
  return { profile, source: remote ? 'crm' : 'instructor_directed', warnings: warningsFor(profile) };
}

async function saveProfile(userId, values, { crmId = null } = {}) {
  const profile = { ...profileValues(values), crmId, updatedAt: new Date() };
  const user = await User.findByIdAndUpdate(userId, { $set: { lecturerProfile: profile } }, { new: true, runValidators: true });
  if (!user) throw httpError(404, 'User not found', { code: 'NOT_FOUND' });
  // Збій CRM не скасовує локальний запис: дані не повинні губитися.
  const crmWriteBack = await crm.writeBack(profile).catch(() => ({ ok: false, reason: 'CRM_ERROR' }));
  return { profile: { ...user.lecturerProfile.toObject(), photo: user.avatarUrl || null }, source: 'instructor_directed', warnings: warningsFor(profile), crmWriteBack };
}

async function updateProfile(userId, input) {
  const patch = validateInput(input);
  const { profile } = await resolveProfile(userId);
  return saveProfile(userId, { ...profile, ...patch }, { crmId: profile.crmId });
}

function toInstructor({ profile, source }, id = 'instructor1') {
  return { id, ...profileValues(profile), photo: profile.photo || null, crmId: profile.crmId, source, evidenceBlockIds: [] };
}

const hasInstructor = (instructor) => PROFILE_FIELDS.some((key) => Array.isArray(instructor?.[key])
  ? instructor[key].some((v) => v.trim()) : Boolean(instructor?.[key]?.trim()));

// Порівнюємо факти, а не id сутності, провенанс чи CRM-ідентифікатор, якого у файлі може не бути.
const sameProfile = (a, b) => deepEqual(profileValues(a), profileValues(b));

async function writeBackAccepted(userId, before, after) {
  if (sameProfile(before, after)) return null;
  const user = await User.findById(userId).select('lecturerProfile').lean();
  return saveProfile(userId, profileValues(after), { crmId: user?.lecturerProfile?.crmId || after?.crmId || before?.crmId || null });
}

module.exports = { resolveProfile, updateProfile, toInstructor, hasInstructor, sameProfile, writeBackAccepted };
