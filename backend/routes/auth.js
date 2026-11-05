const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { generateToken, hashToken } = require('../utils/tokens');
const { sendPasswordResetEmail } = require('../services/emailService');

const router = express.Router();

function validationFailed(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  return true;
}

// Login user
router.post('/login', [
  body('email')
    .isEmail()
    .normalizeEmail({ gmail_remove_dots: false })
    .withMessage('Enter a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const { email, password } = req.body;

    const user = await User.findOne({ email, isActive: true });
    if (!user) {
      return res.status(401).json({ message: 'Incorrect email or password' });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Incorrect email or password' });
    }

    user.lastLogin = new Date();
    await user.save();

    // Роль у токен не кладемо як джерело істини: middleware auth бере її з БД
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: 'Signed in',
      token,
      user: user.toPublicJSON()
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error during sign-in' });
  }
});

// Get current user profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user: user.toPublicJSON() });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update user profile. Email змінюється лише через /api/users/email-change/*.
router.put('/profile', auth, [
  body('firstName')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('First name cannot be empty'),
  body('lastName')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Last name cannot be empty'),
  body('avatarUrl')
    .optional()
    .trim(),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const { firstName, lastName, avatarUrl } = req.body;

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;

    await user.save();

    res.json({
      message: 'Profile updated',
      user: user.toPublicJSON()
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

const RESET_GENERIC_MESSAGE = 'If this address exists, you will receive password reset instructions';

// Request password reset
router.post('/forgot-password', [
  body('email')
    .isEmail()
    .normalizeEmail({ gmail_remove_dots: false })
    .withMessage('Enter a valid email')
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const { email } = req.body;
    const user = await User.findOne({ email, isActive: true });
    if (!user) {
      // Не розкриваємо, чи існує обліковий запис
      return res.json({ message: RESET_GENERIC_MESSAGE });
    }

    const { raw, hash } = generateToken();
    user.resetPasswordToken = hash;
    user.resetPasswordExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 години
    await user.save();

    try {
      await sendPasswordResetEmail(user.email, raw);
    } catch (e) {
      console.warn('Failed to send password reset email:', e.message);
    }

    res.json({ message: RESET_GENERIC_MESSAGE });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Reset password (також використовується для встановлення пароля за інвайтом)
router.post('/reset-password', [
  body('token')
    .isString()
    .notEmpty()
    .withMessage('A reset token is required'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('The password must be at least 6 characters')
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const { token, password } = req.body;

    const user = await User.findOne({
      resetPasswordToken: hashToken(token),
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password updated' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Logout (client-side token invalidation)
router.post('/logout', auth, (req, res) => {
  res.json({ message: 'Signed out' });
});

module.exports = router;
