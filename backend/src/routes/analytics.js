/**
 * Analytics Routes
 * GET /api/analytics/overview    - Dashboard overview stats
 * GET /api/analytics/bandwidth   - Bandwidth usage over time
 * GET /api/analytics/sessions    - Session analytics
 */

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { query } = require('../config/db');

router.use(authMiddleware);

/**
 * Overview analytics for the dashboard.
 * Returns combined stats for the current user.
 */
router.get('/overview', async (req, res) => {
    try {
        // Get user stats
        const userStats = await query(
            `SELECT
                u.credit_balance,
                u.trust_score,
                u.total_ratings,
                COALESCE(n.total_data_shared_gb, 0) as total_data_shared_gb,
                COALESCE(n.total_sessions, 0) as total_provider_sessions,
                COALESCE(n.current_connections, 0) as current_connections,
                COALESCE(n.status, 'offline') as node_status,
                COALESCE(n.bandwidth_mbps, 0) as bandwidth_mbps,
                COALESCE(n.is_sharing, false) as is_sharing
             FROM users u
             LEFT JOIN nodes n ON n.user_id = u.id
             WHERE u.id = $1`,
            [req.user.id]
        );

        // Consumer session stats
        const consumerStats = await query(
            `SELECT
                COUNT(*) as total_sessions,
                COALESCE(SUM(data_transferred_mb), 0) as total_data_mb,
                COALESCE(SUM(credits_charged), 0) as total_credits_spent,
                COALESCE(AVG(avg_bandwidth_mbps), 0) as avg_bandwidth,
                COALESCE(AVG(avg_latency_ms), 0) as avg_latency
             FROM sessions
             WHERE consumer_id = $1 AND status = 'disconnected'`,
            [req.user.id]
        );

        // Last 7 sessions
        const recentSessions = await query(
            `SELECT s.id, s.status, s.started_at, s.ended_at, s.data_transferred_mb,
                    s.credits_charged, s.avg_bandwidth_mbps,
                    CASE 
                        WHEN s.consumer_id = $1 THEN 'consumer'
                        ELSE 'provider'
                    END as role,
                    CASE
                        WHEN s.consumer_id = $1 THEN p.username
                        ELSE c.username
                    END as peer_username
             FROM sessions s
             JOIN users p ON s.provider_id = p.id
             JOIN users c ON s.consumer_id = c.id
             WHERE s.consumer_id = $1 OR s.provider_id = $1
             ORDER BY s.started_at DESC LIMIT 7`,
            [req.user.id]
        );

        res.json({
            userStats: userStats.rows[0],
            consumerStats: consumerStats.rows[0],
            recentSessions: recentSessions.rows
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get analytics overview' });
    }
});

/**
 * Bandwidth usage over time, grouped by day.
 * GET /api/analytics/bandwidth?days=7
 */
router.get('/bandwidth', async (req, res) => {
    try {
        const days = Math.min(parseInt(req.query.days) || 7, 30);

        const result = await query(
            `SELECT
                DATE(recorded_at) as date,
                COALESCE(AVG(bandwidth_mbps), 0) as avg_bandwidth,
                COALESCE(AVG(latency_ms), 0) as avg_latency,
                COALESCE(MAX(active_connections), 0) as max_connections,
                COUNT(*) as data_points
             FROM node_heartbeats nh
             JOIN nodes n ON nh.node_id = n.id
             WHERE n.user_id = $1 AND recorded_at >= NOW() - INTERVAL '${days} days'
             GROUP BY DATE(recorded_at)
             ORDER BY date ASC`,
            [req.user.id]
        );

        // Fill gaps with zeros for missing days
        const filled = fillDateGaps(result.rows, days);
        res.json({ bandwidthHistory: filled, days });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get bandwidth analytics' });
    }
});

/**
 * Session analytics over time.
 * GET /api/analytics/sessions?days=30
 */
router.get('/sessions', async (req, res) => {
    try {
        const days = Math.min(parseInt(req.query.days) || 30, 90);

        const result = await query(
            `SELECT
                DATE(started_at) as date,
                COUNT(*) as session_count,
                COALESCE(SUM(data_transferred_mb), 0) as total_data_mb,
                COALESCE(SUM(credits_charged), 0) as total_credits,
                COALESCE(AVG(avg_bandwidth_mbps), 0) as avg_bandwidth
             FROM sessions
             WHERE (consumer_id = $1 OR provider_id = $1)
               AND started_at >= NOW() - INTERVAL '${days} days'
             GROUP BY DATE(started_at)
             ORDER BY date ASC`,
            [req.user.id]
        );

        res.json({ sessionHistory: result.rows, days });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get session analytics' });
    }
});

/**
 * Fill date gaps in time series data with zero values.
 */
function fillDateGaps(rows, days) {
    const result = [];
    const dataMap = {};
    rows.forEach(r => { dataMap[r.date] = r; });

    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        result.push(dataMap[dateStr] || {
            date: dateStr,
            avg_bandwidth: 0,
            avg_latency: 0,
            max_connections: 0,
            data_points: 0
        });
    }
    return result;
}

module.exports = router;
