/**
 * Credits Routes
 * GET /api/credits/balance        - Get balance and transactions
 * GET /api/credits/marketplace    - Marketplace stats and top providers
 */

const express = require('express');
const router = express.Router();
const { getBalance, getMarketplaceStats } = require('../controllers/creditsController');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/balance', getBalance);
router.get('/marketplace', getMarketplaceStats);

module.exports = router;
