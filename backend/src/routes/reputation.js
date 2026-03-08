/**
 * Reputation Routes
 * POST /api/reputation/rate       - Submit a rating for a session
 * GET  /api/reputation/:userId    - Get reputation for a user
 * POST /api/reputation/flag       - Flag a suspicious rating
 */

const express = require('express');
const router = express.Router();
const { submitRating, getUserReputation, flagRating } = require('../controllers/reputationController');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.post('/rate', submitRating);
router.get('/:userId', getUserReputation);
router.post('/flag', flagRating);

module.exports = router;
