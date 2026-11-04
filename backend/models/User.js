const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');

// Локальна копія профілю до інтеграції Lecturers CRM; облікові дані залишаються окремими.
const lecturerProfileSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  position: { type: String, default: '' },
  email: { type: String, default: '' },
  officeHours: { type: String, default: '' },
  assistants: { type: String, default: '' },
  expertise: { type: [String], default: [] },
  education: { type: [String], default: [] },
  experience: { type: [String], default: [] },
  updatedAt: { type: Date, default: null },
  crmId: { type: String, default: null },
}, { _id: false });

const userSchema = new mongoose.Schema({
  lecturerProfile: { type: lecturerProfileSchema, default: undefined },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    validate: [(v) => validator.isEmail(v), 'Вкажіть коректний email']
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['instructor', 'manager', 'director', 'admin'],
    default: 'instructor'
  },
  avatarUrl: {
    type: String,
    trim: true
  },
  // Pending email change flow
  pendingEmail: {
    type: String,
    lowercase: true,
    trim: true,
    validate: [(v) => validator.isEmail(v), 'Вкажіть коректний email']
  },
  // SHA-256 хеші токенів; сирі токени надсилаються тільки на пошту
  emailChangeToken: String,
  emailChangeTokenExpires: Date,
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  lastLogin: Date,
  isActive: {
    type: Boolean,
    default: true
  },
  settings: {
    notifications: {
      type: Boolean,
      default: true
    },
    theme: {
      type: String,
  enum: ['system', 'light', 'dark'],
  default: 'system'
    }
  }
}, {
  timestamps: true
});

// Indexes
// 'email' already has a unique index via the schema field (unique: true) -> removing duplicate manual index
userSchema.index({ role: 1 });

// Pre-save middleware to hash password
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Method to get user public data
userSchema.methods.toPublicJSON = function() {
  return {
    id: this._id,
    email: this.email,
    firstName: this.firstName,
    lastName: this.lastName,
  avatarUrl: this.avatarUrl,
    role: this.role,
    lastLogin: this.lastLogin,
    createdAt: this.createdAt,
    // Налаштування користувача для клієнтського UI
    settings: {
      notifications: this.settings?.notifications,
      theme: this.settings?.theme
    }
  };
};

module.exports = mongoose.model('User', userSchema);
