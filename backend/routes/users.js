const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const Syllabus = require('../models/Syllabus');
const User = require('../models/User');
const { generateToken, hashToken } = require('../utils/tokens');
const { isLastActiveAdmin } = require('../services/userService');
const { deleteSyllabiCascade } = require('../services/syllabusCleanup');
const { sendAccountDeletionEmail, sendEmailChangeConfirmation } = require('../services/emailService');

const router = express.Router();
const lecturerProfiles = require('../services/lecturers/profile');
const { sendError } = require('../utils/httpError');
const multer = require('multer');
const { normalizeAvatar } = require('../services/avatars');
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.post('/avatar', auth, photoUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Choose a photo to upload.', code: 'PHOTO_REQUIRED' });
    const avatarUrl = await normalizeAvatar(req.file.buffer);
    const user = await User.findByIdAndUpdate(req.user.userId, { $set: { avatarUrl } }, { new: true });
    res.json({ user: user.toPublicJSON() });
  } catch (error) { sendError(res, error); }
});

router.delete('/avatar', auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.user.userId, { $unset: { avatarUrl: '' } }, { new: true });
    res.json({ user: user.toPublicJSON() });
  } catch (error) { sendError(res, error); }
});

// Профіль лише поточного користувача; id власника не приймаємо з клієнта.
router.get('/profile/lecturer', auth, async (req, res) => {
  try {
    res.json(await lecturerProfiles.resolveProfile(req.user.userId));
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/profile/lecturer', auth, async (req, res) => {
  try {
    res.json({ message: 'Lecturer profile updated.', ...await lecturerProfiles.updateProfile(req.user.userId, req.body) });
  } catch (error) {
    sendError(res, error);
  }
});

// Update user settings
router.put('/settings', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { notifications, theme } = req.body;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Update user settings
    if (notifications !== undefined) user.settings.notifications = notifications;
  if (theme !== undefined) user.settings.theme = theme; // now accepts 'system'|'light'|'dark'
    
    await user.save();
    
    res.json({
      message: 'Settings updated',
      settings: user.settings
    });
    
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({
      message: 'Could not update settings'
    });
  }
});

// Change password
router.put('/change-password', auth, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('The new password must be at least 6 characters'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'The current password is incorrect' });
    }
    
  // Assign plain new password; pre-save hook will hash
  user.password = newPassword;
    
    await user.save();
    
    res.json({
      message: 'Password changed'
    });
    
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      message: 'Could not change the password'
    });
  }
});

// Delete user account
router.delete('/account', auth, [
  body('password').notEmpty().withMessage('Enter your password to confirm account deletion')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.userId;
    const { password } = req.body;
    
    // Verify user and password
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect password' });
    }

    // Не можна залишити систему без активного адміна
    if (await isLastActiveAdmin(user)) {
      return res.status(409).json({ message: 'The last active administrator cannot be deleted' });
    }

    // Каскад: файли, розмови й повідомлення, силабуси
    await deleteSyllabiCascade({ instructor: userId });

    // Delete user account
    await User.findByIdAndDelete(userId);

    // Send confirmation email (best-effort)
    try {
      await sendAccountDeletionEmail(user.email);
    } catch (e) {
      console.warn('Failed to send account deletion email:', e.message);
    }
    
    res.json({
      message: 'Account deleted'
    });
    
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({
      message: 'Could not delete the account'
    });
  }
});

// Request email change: store pendingEmail and send confirmation to the new address
router.post('/email-change/request', auth, [
  body('newEmail').isEmail().withMessage('Enter a valid email').normalizeEmail({ gmail_remove_dots: false })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { newEmail } = req.body;
    if (newEmail.toLowerCase() === user.email.toLowerCase()) {
      return res.status(400).json({ message: 'The new email is the same as the current one' });
    }

    // Ensure email is not used by another account
    const exists = await User.findOne({ email: newEmail.toLowerCase() });
    if (exists) return res.status(409).json({ message: 'This email is already in use' });

    const { raw, hash } = generateToken();
    user.pendingEmail = newEmail.toLowerCase();
    user.emailChangeToken = hash;
    user.emailChangeTokenExpires = Date.now() + 24 * 60 * 60 * 1000; // 24h
    await user.save();

    // Best-effort email to new address
    try {
      await sendEmailChangeConfirmation(user.pendingEmail, raw);
    } catch (e) {
      console.warn('Failed to send email change confirmation:', e.message);
    }

    return res.json({ message: 'Almost done! Check your new inbox to confirm the change.' });
  } catch (error) {
    console.error('Email change request error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Confirm email change via token sent to the new email address
router.post('/email-change/confirm', [
  body('token').notEmpty().withMessage('A confirmation token is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { token } = req.body;
    const user = await User.findOne({ emailChangeToken: hashToken(token), emailChangeTokenExpires: { $gt: Date.now() } });
    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    if (!user.pendingEmail) {
      return res.status(400).json({ message: 'There is no pending email change' });
    }

    // Final check that pendingEmail is still free
    const exists = await User.findOne({ email: user.pendingEmail });
    if (exists && exists._id.toString() !== user._id.toString()) {
      return res.status(409).json({ message: 'This email is already in use' });
    }

    user.email = user.pendingEmail;
    user.pendingEmail = undefined;
    user.emailChangeToken = undefined;
    user.emailChangeTokenExpires = undefined;

    await user.save();

    return res.json({ message: 'Email changed' });
  } catch (error) {
    console.error('Email change confirm error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
