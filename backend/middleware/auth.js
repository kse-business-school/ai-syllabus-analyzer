const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Роль і активність беремо з БД, а не з JWT: зміни діють одразу
    const user = await User.findById(decoded.userId).select('email role isActive');
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Access denied. The user was not found or is deactivated.' });
    }

    req.user = { userId: String(user._id), email: user.email, role: user.role };
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Access denied. Invalid token.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Access denied. The token has expired.' });
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({ message: 'Internal server error during authentication' });
  }
};

// Єдиний middleware перевірки ролі: requireRole('admin')
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Access denied. Authentication required.' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
  }
  next();
};

module.exports = { auth, requireRole };
