/**
 * Reputation Controller
 * 
 * Manages the peer reputation system:
 * - Submit ratings after sessions
 * - Calculate aggregate trust scores
 * - Automatic reputation scoring from metrics
 * - Suspicious node flagging
 */

const { query } = require('../config/db');
const { detectSuspiciousNode } = require('../services/peerDiscovery');
const logger = require('../utils/logger');

/**
 * Submit a reputation rating after a VPN session.
 * POST /api/reputation/rate
 */
async function submitRating(req, res) {
    try {
        const {
            session_id,
            overall_rating,
            connection_stability,
            speed_rating,
            comment
        } = req.body;

        if (!session_id || !overall_rating) {
            return res.status(400).json({ error: 'session_id and overall_rating are required' });
        }

        if (overall_rating < 1 || overall_rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }

        // Verify the session exists and the user participated
        const sessionResult = await query(
            `SELECT s.*, c.username as consumer_name, p.username as provider_name
             FROM sessions s
             JOIN users c ON s.consumer_id = c.id
             JOIN users p ON s.provider_id = p.id
             WHERE s.id = $1 AND (s.consumer_id = $2 OR s.provider_id = $2)
             AND s.status = 'disconnected'`,
            [session_id, req.user.id]
        );

        if (sessionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found or still active' });
        }

        const session = sessionResult.rows[0];

        // Determine who is being rated (you rate the other party)
        const ratedUserId = session.consumer_id === req.user.id
            ? session.provider_id
            : session.consumer_id;

        // Insert the rating
        await query(
            `INSERT INTO reputation_ratings (
                session_id, rater_id, rated_user_id,
                overall_rating, connection_stability, speed_rating,
                comment, measured_latency_ms, measured_packet_loss, measured_bandwidth_mbps
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (session_id, rater_id) DO UPDATE SET
                overall_rating = EXCLUDED.overall_rating,
                connection_stability = EXCLUDED.connection_stability,
                speed_rating = EXCLUDED.speed_rating,
                comment = EXCLUDED.comment`,
            [
                session_id, req.user.id, ratedUserId,
                overall_rating, connection_stability || overall_rating,
                speed_rating || overall_rating,
                comment || null,
                session.avg_latency_ms, session.packet_loss_percent, session.avg_bandwidth_mbps
            ]
        );

        // Recalculate and update the rated user's trust score
        await recalculateTrustScore(ratedUserId);

        res.json({ message: 'Rating submitted successfully' });
    } catch (error) {
        if (error.code === '23505') { // Unique constraint violation
            return res.status(409).json({ error: 'You have already rated this session' });
        }
        logger.error('Submit rating error:', error);
        res.status(500).json({ error: 'Failed to submit rating' });
    }
}

/**
 * Get reputation information for a specific user.
 * GET /api/reputation/:userId
 */
async function getUserReputation(req, res) {
    try {
        const { userId } = req.params;

        const userResult = await query(
            'SELECT id, username, trust_score, total_ratings FROM users WHERE id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get recent ratings
        const ratings = await query(
            `SELECT 
                r.overall_rating, r.connection_stability, r.speed_rating, r.comment,
                r.created_at, u.username as rater_username,
                r.measured_latency_ms, r.measured_bandwidth_mbps
             FROM reputation_ratings r
             JOIN users u ON r.rater_id = u.id
             WHERE r.rated_user_id = $1
             ORDER BY r.created_at DESC
             LIMIT 10`,
            [userId]
        );

        // Rating distribution
        const distribution = await query(
            `SELECT overall_rating, COUNT(*) as count
             FROM reputation_ratings
             WHERE rated_user_id = $1
             GROUP BY overall_rating
             ORDER BY overall_rating`,
            [userId]
        );

        res.json({
            user: userResult.rows[0],
            recentRatings: ratings.rows,
            ratingDistribution: distribution.rows
        });
    } catch (error) {
        logger.error('Get reputation error:', error);
        res.status(500).json({ error: 'Failed to get reputation' });
    }
}

/**
 * Recalculates and saves the trust score for a user.
 * Called automatically after each rating submission.
 * 
 * Formula: 
 *   trust_score = 0.7 * avg_user_ratings + 0.3 * avg_performance_metrics
 *   Performance = 1 - (packet_loss/100) - (latency_ms/1000) + (bandwidth/100)
 * 
 * @param {string} userId - UUID of the user to recalculate
 */
async function recalculateTrustScore(userId) {
    try {
        const result = await query(
            `SELECT 
                AVG(overall_rating) as avg_rating,
                COUNT(*) as rating_count,
                AVG(measured_latency_ms) as avg_latency,
                AVG(measured_packet_loss) as avg_packet_loss,
                AVG(measured_bandwidth_mbps) as avg_bandwidth
             FROM reputation_ratings
             WHERE rated_user_id = $1 AND is_flagged = false`,
            [userId]
        );

        if (result.rows[0].rating_count === '0') return;

        const row = result.rows[0];
        
        // Normalize ratings from 1-5 scale to 0-10 scale
        const userRatingScore = (parseFloat(row.avg_rating) / 5.0) * 10.0;

        // Performance score based on network metrics (0-10)
        const latencyPenalty = Math.min(3, (parseFloat(row.avg_latency) || 0) / 200);
        const packetLossPenalty = Math.min(3, (parseFloat(row.avg_packet_loss) || 0) / 5);
        const bandwidthBonus = Math.min(2, (parseFloat(row.avg_bandwidth) || 0) / 50);
        const perfScore = Math.max(0, 5 - latencyPenalty - packetLossPenalty + bandwidthBonus);

        // Combined trust score (70% user ratings, 30% performance)
        const trustScore = Math.min(10, Math.max(0,
            (userRatingScore * 0.7) + (perfScore * 0.3)
        ));

        // Update user and their nodes' trust scores
        await query(
            'UPDATE users SET trust_score = $1, total_ratings = $2 WHERE id = $3',
            [trustScore.toFixed(2), parseInt(row.rating_count), userId]
        );

        await query(
            'UPDATE nodes SET trust_score = $1 WHERE user_id = $2',
            [trustScore.toFixed(2), userId]
        );

        logger.info(`Trust score updated for user ${userId}: ${trustScore.toFixed(2)}`);
    } catch (error) {
        logger.error('Recalculate trust score error:', error);
    }
}

/**
 * Flag a node as suspicious (admin action or automatic).
 * POST /api/reputation/flag
 */
async function flagRating(req, res) {
    try {
        const { rating_id, reason } = req.body;

        await query(
            'UPDATE reputation_ratings SET is_flagged = true, flag_reason = $1 WHERE id = $2',
            [reason, rating_id]
        );

        res.json({ message: 'Rating flagged for review' });
    } catch (error) {
        logger.error('Flag rating error:', error);
        res.status(500).json({ error: 'Failed to flag rating' });
    }
}

module.exports = { submitRating, getUserReputation, flagRating, recalculateTrustScore };
