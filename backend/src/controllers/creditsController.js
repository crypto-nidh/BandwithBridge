/**
 * Credits Controller
 * 
 * Manages the bandwidth marketplace credit system.
 * Credits are earned by providers sharing bandwidth and
 * spent by consumers accessing the network.
 */

const { query } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Get current credit balance and recent transactions.
 * GET /api/credits/balance
 */
async function getBalance(req, res) {
    try {
        const userResult = await query(
            'SELECT credit_balance FROM users WHERE id = $1',
            [req.user.id]
        );

        const transactions = await query(
            `SELECT type, amount, balance_after, description, created_at, session_id
             FROM credit_transactions
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 20`,
            [req.user.id]
        );

        // Aggregate stats
        const stats = await query(
            `SELECT
                COALESCE(SUM(amount) FILTER (WHERE type = 'earn'), 0) as total_earned,
                COALESCE(SUM(ABS(amount)) FILTER (WHERE type = 'spend'), 0) as total_spent
             FROM credit_transactions
             WHERE user_id = $1`,
            [req.user.id]
        );

        res.json({
            balance: userResult.rows[0].credit_balance,
            stats: stats.rows[0],
            transactions: transactions.rows
        });
    } catch (error) {
        logger.error('Get balance error:', error);
        res.status(500).json({ error: 'Failed to get balance' });
    }
}

/**
 * Get marketplace statistics.
 * GET /api/credits/marketplace
 */
async function getMarketplaceStats(req, res) {
    try {
        const result = await query(`
            SELECT
                AVG(credit_balance) as avg_balance,
                COUNT(*) FILTER (WHERE role = 'provider' OR role = 'both') as provider_count,
                COUNT(*) FILTER (WHERE role = 'consumer' OR role = 'both') as consumer_count,
                SUM(credit_balance) as total_credits_in_circulation
            FROM users
            WHERE is_active = true
        `);

        const topProviders = await query(`
            SELECT u.username, u.credit_balance, u.trust_score, n.total_data_shared_gb, n.total_sessions
            FROM users u
            LEFT JOIN nodes n ON n.user_id = u.id
            WHERE u.role IN ('provider', 'both')
            ORDER BY n.total_data_shared_gb DESC NULLS LAST
            LIMIT 10
        `);

        res.json({
            marketStats: result.rows[0],
            topProviders: topProviders.rows,
            creditRate: { perMb: 0.1, description: '0.1 credits per MB transferred' }
        });
    } catch (error) {
        logger.error('Get marketplace stats error:', error);
        res.status(500).json({ error: 'Failed to get marketplace stats' });
    }
}

module.exports = { getBalance, getMarketplaceStats };
