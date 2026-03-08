/**
 * Authentication Routes
 * POST /api/auth/register
 * POST /api/auth/login
 * GET  /api/auth/me
 * PUT  /api/auth/profile
 */

const express = require('express');
const router = express.Router();
const { register, login, getProfile, updateProfile } = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');

// Public routes (no auth required)
router.post('/register', register);
router.post('/login', login);

// Protected routes
router.get('/me', authMiddleware, getProfile);
router.put('/profile', authMiddleware, updateProfile);

module.exports = router;
