/**
 * Session Controller
 * 
 * Manages P2P VPN session lifecycle:
 *   - Creating sessions when a consumer connects to a provider
 *   - Updating session metrics during connection
 *   - Ending sessions and triggering credits/reputation updates
 */

const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Create a new VPN session when consumer connects to a provider.
 * POST /api/sessions/create
 */
async function createSession(req, res) {
    try {
        const { provider_node_id, routing_path, hop_count } = req.body;

        if (!provider_node_id) {
            return res.status(400).json({ error: 'provider_node_id is required' });
        }

        // Verify provider node exists and is available
        const nodeResult = await query(
            'SELECT id, user_id, current_connections, max_connections, daily_data_used_gb, daily_data_limit_gb FROM nodes WHERE id = $1 AND status = $2',
            [provider_node_id, 'online']
        );

        if (nodeResult.rows.length === 0) {
            return res.status(404).json({ error: 'Provider node not found or offline' });
        }

        const node = nodeResult.rows[0];

        if (node.current_connections >= node.max_connections) {
            return res.status(429).json({ error: 'Provider node is at full capacity' });
        }

        // Check consumer has enough credits (min 10 credits to start)
        if (req.user.creditBalance < 10) {
            return res.status(402).json({ error: 'Insufficient credits. Minimum 10 credits required.' });
        }

        const sessionToken = uuidv4();

        // Create session record
        const sessionResult = await query(
            `INSERT INTO sessions (
                consumer_id, provider_id, provider_node_id,
                session_token, routing_path, hop_count, status
             ) VALUES ($1, $2, $3, $4, $5, $6, 'active')
             RETURNING id, session_token, started_at`,
            [
                req.user.id,
                node.user_id,
                provider_node_id,
                sessionToken,
                JSON.stringify(routing_path || [provider_node_id]),
                hop_count || 1
            ]
        );

        const session = sessionResult.rows[0];

        // Increment provider's connection count
        await query(
            'UPDATE nodes SET current_connections = current_connections + 1 WHERE id = $1',
            [provider_node_id]
        );

        logger.info(`Session created: ${session.id} (consumer: ${req.user.username})`);

        res.status(201).json({
            sessionId: session.id,
            sessionToken: session.session_token,
            startedAt: session.started_at
        });
    } catch (error) {
        logger.error('Create session error:', error);
        res.status(500).json({ error: 'Failed to create session' });
    }
}

/**
 * Update session metrics (bandwidth, bytes transferred, latency).
 * Called periodically by consumer client during active connection.
 * PATCH /api/sessions/:sessionId/metrics
 */
async function updateSessionMetrics(req, res) {
    try {
        const { sessionId } = req.params;
        const { bytes_sent, bytes_received, avg_latency_ms, avg_bandwidth_mbps, packet_loss_percent } = req.body;

        const dataMb = ((bytes_sent || 0) + (bytes_received || 0)) / (1024 * 1024);
        const creditsCharged = Math.floor(dataMb * 0.1); // 0.1 credits per MB

        await query(
            `UPDATE sessions SET
                bytes_sent = COALESCE($1, bytes_sent),
                bytes_received = COALESCE($2, bytes_received),
                data_transferred_mb = $3,
                avg_latency_ms = COALESCE($4, avg_latency_ms),
                avg_bandwidth_mbps = COALESCE($5, avg_bandwidth_mbps),
                packet_loss_percent = COALESCE($6, packet_loss_percent),
                credits_charged = $7,
                last_activity_at = NOW()
             WHERE id = $8 AND consumer_id = $9`,
            [bytes_sent, bytes_received, dataMb, avg_latency_ms, avg_bandwidth_mbps,
             packet_loss_percent, creditsCharged, sessionId, req.user.id]
        );

        res.json({ message: 'Metrics updated', creditsCharged });
    } catch (error) {
        logger.error('Update session metrics error:', error);
        res.status(500).json({ error: 'Failed to update metrics' });
    }
}

/**
 * End an active session and process credits + reputation.
 * POST /api/sessions/:sessionId/end
 */
async function endSession(req, res) {
    try {
        const { sessionId } = req.params;
        const { disconnect_reason } = req.body;

        // Get session details
        const sessionResult = await query(
            'SELECT * FROM sessions WHERE id = $1 AND (consumer_id = $2 OR provider_id = $2)',
            [sessionId, req.user.id]
        );

        if (sessionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const session = sessionResult.rows[0];

        if (session.status !== 'active') {
            return res.status(400).json({ error: 'Session is not active' });
        }

        // Calculate duration and final credits
        const durationMs = Date.now() - new Date(session.started_at).getTime();
        const durationMinutes = durationMs / 60000;
        const finalCredits = Math.max(1, Math.floor(session.credits_charged));

        // End the session
        await query(
            `UPDATE sessions SET
                status = 'disconnected',
                ended_at = NOW(),
                disconnect_reason = $1,
                credits_charged = $2
             WHERE id = $3`,
            [disconnect_reason || 'user_disconnect', finalCredits, sessionId]
        );

        // Decrement provider connection count
        await query(
            'UPDATE nodes SET current_connections = GREATEST(0, current_connections - 1) WHERE id = $1',
            [session.provider_node_id]
        );

        // Update provider's total data shared
        await query(
            'UPDATE nodes SET total_data_shared_gb = total_data_shared_gb + $1 / 1024, total_sessions = total_sessions + 1 WHERE id = $2',
            [session.data_transferred_mb, session.provider_node_id]
        );

        // Deduct credits from consumer
        await query(
            'UPDATE users SET credit_balance = GREATEST(0, credit_balance - $1) WHERE id = $2',
            [finalCredits, session.consumer_id]
        );

        // Add credits to provider
        await query(
            'UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2',
            [finalCredits, session.provider_id]
        );

        // Record credit transactions
        await query(
            `INSERT INTO credit_transactions (user_id, type, amount, balance_after, session_id, description)
             SELECT $1, 'spend', -$2, credit_balance, $3, 'VPN session payment'
             FROM users WHERE id = $1`,
            [session.consumer_id, finalCredits, sessionId]
        );

        await query(
            `INSERT INTO credit_transactions (user_id, type, amount, balance_after, session_id, description)
             SELECT $1, 'earn', $2, credit_balance, $3, 'Bandwidth sharing reward'
             FROM users WHERE id = $1`,
            [session.provider_id, finalCredits, sessionId]
        );

        logger.info(`Session ended: ${sessionId}, duration: ${durationMinutes.toFixed(1)}min, credits: ${finalCredits}`);

        res.json({
            message: 'Session ended successfully',
            summary: {
                sessionId,
                durationMinutes: parseFloat(durationMinutes.toFixed(1)),
                dataMb: parseFloat(session.data_transferred_mb || 0),
                creditsCharged: finalCredits
            }
        });
    } catch (error) {
        logger.error('End session error:', error);
        res.status(500).json({ error: 'Failed to end session' });
    }
}

/**
 * Get session history for the current user.
 * GET /api/sessions/history
 */
async function getSessionHistory(req, res) {
    try {
        const { limit = 20, offset = 0 } = req.query;

        const result = await query(
            `SELECT 
                s.id, s.status, s.started_at, s.ended_at,
                s.data_transferred_mb, s.credits_charged,
                s.avg_latency_ms, s.avg_bandwidth_mbps, s.hop_count,
                s.disconnect_reason,
                provider.username as provider_username,
                consumer.username as consumer_username,
                n.country_name, n.city
             FROM sessions s
             JOIN users provider ON s.provider_id = provider.id
             JOIN users consumer ON s.consumer_id = consumer.id
             LEFT JOIN nodes n ON s.provider_node_id = n.id
             WHERE s.consumer_id = $1 OR s.provider_id = $1
             ORDER BY s.started_at DESC
             LIMIT $2 OFFSET $3`,
            [req.user.id, parseInt(limit), parseInt(offset)]
        );

        res.json({ sessions: result.rows });
    } catch (error) {
        logger.error('Get session history error:', error);
        res.status(500).json({ error: 'Failed to get session history' });
    }
}

/**
 * Get currently active sessions for the provider dashboard.
 * GET /api/sessions/active
 */
async function getActiveSessions(req, res) {
    try {
        const result = await query(
            `SELECT 
                s.id, s.started_at, s.bytes_sent, s.bytes_received,
                s.data_transferred_mb, s.avg_bandwidth_mbps, s.avg_latency_ms,
                s.credits_charged, s.hop_count,
                u.username as consumer_username,
                u.trust_score as consumer_trust_score
             FROM sessions s
             JOIN users u ON s.consumer_id = u.id
             WHERE s.provider_id = $1 AND s.status = 'active'
             ORDER BY s.started_at DESC`,
            [req.user.id]
        );

        res.json({ sessions: result.rows });
    } catch (error) {
        logger.error('Get active sessions error:', error);
        res.status(500).json({ error: 'Failed to get active sessions' });
    }
}

module.exports = { createSession, updateSessionMetrics, endSession, getSessionHistory, getActiveSessions };
