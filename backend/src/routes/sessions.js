/**
 * Session Routes
 * POST  /api/sessions/create              - Start a new P2P session
 * PATCH /api/sessions/:id/metrics        - Update session metrics
 * POST  /api/sessions/:id/end            - End a session
 * GET   /api/sessions/history            - Session history
 * GET   /api/sessions/active             - Active sessions (provider view)
 */

const express = require('express');
const router = express.Router();
const { createSession, updateSessionMetrics, endSession, getSessionHistory, getActiveSessions } = require('../controllers/sessionController');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.post('/create', createSession);
router.patch('/:sessionId/metrics', updateSessionMetrics);
router.post('/:sessionId/end', endSession);
router.get('/history', getSessionHistory);
router.get('/active', getActiveSessions);

module.exports = router;
