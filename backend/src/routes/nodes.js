/**
 * Node Routes
 * POST   /api/nodes/register       - Register/update as a provider node
 * PATCH  /api/nodes/status         - Update node status
 * GET    /api/nodes/discover       - Get available nodes (consumers)
 * GET    /api/nodes/mine           - Get my own node
 * POST   /api/nodes/heartbeat      - Keep-alive heartbeat
 * GET    /api/nodes/stats          - Network-wide stats
 * GET    /api/nodes/topology       - D3.js topology data
 */

const express = require('express');
const router = express.Router();
const {
    registerNode, updateNodeStatus, discoverNodes,
    getMyNode, heartbeat, getNetworkStats, getTopology
} = require('../controllers/nodeController');
const { authMiddleware, requireRole } = require('../middleware/auth');

// All node routes require authentication
router.use(authMiddleware);

router.post('/register', requireRole('provider', 'both'), registerNode);
router.patch('/status', requireRole('provider', 'both'), updateNodeStatus);
router.post('/heartbeat', requireRole('provider', 'both'), heartbeat);
router.get('/mine', requireRole('provider', 'both'), getMyNode);
router.get('/discover', discoverNodes); // All authenticated users can discover
router.get('/stats', getNetworkStats);
router.get('/topology', getTopology);

module.exports = router;
