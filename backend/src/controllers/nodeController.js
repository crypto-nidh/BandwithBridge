/**
 * Node Controller
 * 
 * Manages provider nodes: registration, status updates, and the peer discovery algorithm.
 * 
 * The discovery algorithm scores available nodes using:
 *   Score = (1/latency * 0.4) + (bandwidth * 0.3) + (trustScore * 0.3)
 * 
 * This ensures low-latency, high-bandwidth, trusted providers are preferred.
 */

const { query } = require('../config/db');
const peerDiscovery = require('../services/peerDiscovery');
const logger = require('../utils/logger');

/**
 * Register or update a provider node.
 * Called when a provider enables bandwidth sharing.
 * POST /api/nodes/register
 */
async function registerNode(req, res) {
    try {
        const {
            peer_id,
            country_code,
            country_name,
            city,
            latitude,
            longitude,
            max_connections,
            max_bandwidth_mbps,
            daily_data_limit_gb,
            allowed_hours
        } = req.body;

        // Only providers can register nodes
        if (!['provider', 'both'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Only providers can register nodes' });
        }

        // Check if node already exists for this user
        const existing = await query('SELECT id FROM nodes WHERE user_id = $1', [req.user.id]);

        let nodeId;
        if (existing.rows.length > 0) {
            // Update existing node
            const result = await query(
                `UPDATE nodes SET
                    peer_id = $1,
                    country_code = $2,
                    country_name = $3,
                    city = $4,
                    latitude = $5,
                    longitude = $6,
                    max_connections = $7,
                    max_bandwidth_mbps = $8,
                    daily_data_limit_gb = $9,
                    allowed_hours = $10,
                    status = 'online',
                    is_sharing = true,
                    last_heartbeat_at = NOW()
                WHERE user_id = $11
                RETURNING id`,
                [peer_id, country_code, country_name, city, latitude, longitude,
                 max_connections || 5, max_bandwidth_mbps || 10, daily_data_limit_gb || 10,
                 JSON.stringify(allowed_hours || Array.from({length: 24}, (_, i) => i)),
                 req.user.id]
            );
            nodeId = result.rows[0].id;
        } else {
            // Create new node
            const result = await query(
                `INSERT INTO nodes (
                    user_id, peer_id, country_code, country_name, city,
                    latitude, longitude, max_connections, max_bandwidth_mbps,
                    daily_data_limit_gb, allowed_hours, status, is_sharing,
                    trust_score, last_heartbeat_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'online', true, $12, NOW())
                RETURNING id`,
                [req.user.id, peer_id, country_code, country_name, city,
                 latitude, longitude, max_connections || 5, max_bandwidth_mbps || 10,
                 daily_data_limit_gb || 10,
                 JSON.stringify(allowed_hours || Array.from({length: 24}, (_, i) => i)),
                 req.user.trustScore]
            );
            nodeId = result.rows[0].id;
        }

        logger.info(`Node registered: ${nodeId} for user ${req.user.username}`);
        res.json({ message: 'Node registered successfully', nodeId });
    } catch (error) {
        logger.error('Register node error:', error);
        res.status(500).json({ error: 'Failed to register node' });
    }
}

/**
 * Update node status (online/offline, sharing toggle).
 * PATCH /api/nodes/status
 */
async function updateNodeStatus(req, res) {
    try {
        const { status, is_sharing, bandwidth_mbps, latency_ms } = req.body;

        await query(
            `UPDATE nodes SET
                status = COALESCE($1, status),
                is_sharing = COALESCE($2, is_sharing),
                bandwidth_mbps = COALESCE($3, bandwidth_mbps),
                latency_ms = COALESCE($4, latency_ms),
                last_heartbeat_at = NOW()
             WHERE user_id = $5`,
            [status, is_sharing, bandwidth_mbps, latency_ms, req.user.id]
        );

        res.json({ message: 'Node status updated' });
    } catch (error) {
        logger.error('Update node status error:', error);
        res.status(500).json({ error: 'Failed to update node status' });
    }
}

/**
 * Get available nodes for consumers using the peer discovery algorithm.
 * GET /api/nodes/discover
 * Query params: country_code, min_trust_score, min_bandwidth, limit
 */
async function discoverNodes(req, res) {
    try {
        const {
            country_code,
            min_trust_score = 0,     // allow any trust score by default
            min_bandwidth = 0,       // allow nodes with 0 reported bandwidth (freshly registered)
            limit = 20
        } = req.query;

        // Fetch all currently online, sharing nodes
        // COALESCE: if bandwidth_mbps = 0 (not yet measured), fall back to max_bandwidth_mbps
        let nodeQuery = `
            SELECT 
                n.id,
                n.peer_id,
                n.country_code,
                n.country_name,
                n.city,
                n.latitude,
                n.longitude,
                n.latency_ms,
                COALESCE(NULLIF(n.bandwidth_mbps, 0), n.max_bandwidth_mbps, 10) as bandwidth_mbps,
                n.max_connections,
                n.current_connections,
                n.max_bandwidth_mbps,
                n.daily_data_limit_gb,
                n.daily_data_used_gb,
                n.trust_score,
                n.total_sessions,
                n.uptime_hours,
                u.username,
                u.trust_score as user_trust_score,
                u.total_ratings
            FROM nodes n
            JOIN users u ON n.user_id = u.id
            WHERE n.status = 'online'
              AND n.is_sharing = true
              AND n.current_connections < n.max_connections
              AND n.daily_data_used_gb < n.daily_data_limit_gb
              AND n.trust_score >= $1
        `;

        const params = [parseFloat(min_trust_score)];
        let paramCount = 1;

        if (country_code) {
            paramCount++;
            nodeQuery += ` AND n.country_code = $${paramCount}`;
            params.push(country_code.toUpperCase());
        }

        nodeQuery += ' LIMIT $' + (paramCount + 1);
        params.push(Math.min(parseInt(limit), 50));

        const result = await query(nodeQuery, params);

        // Score and sort nodes using the discovery algorithm
        const scoredNodes = peerDiscovery.scoreAndRankNodes(result.rows);

        res.json({
            nodes: scoredNodes,
            count: scoredNodes.length
        });
    } catch (error) {
        logger.error('Discover nodes error:', error);
        res.status(500).json({ error: 'Failed to discover nodes' });
    }
}

/**
 * Get the current user's own node information.
 * GET /api/nodes/mine
 */
async function getMyNode(req, res) {
    try {
        const result = await query(
            `SELECT n.*, 
                    (SELECT COUNT(*) FROM sessions s WHERE s.provider_node_id = n.id AND s.status = 'active') as active_sessions,
                    (SELECT COALESCE(SUM(s.data_transferred_mb), 0) FROM sessions s WHERE s.provider_node_id = n.id) as total_data_mb
             FROM nodes n WHERE n.user_id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.json({ node: null, message: 'No node registered yet' });
        }

        res.json({ node: result.rows[0] });
    } catch (error) {
        logger.error('Get my node error:', error);
        res.status(500).json({ error: 'Failed to get node info' });
    }
}

/**
 * Node heartbeat - updated periodically by provider clients.
 * POST /api/nodes/heartbeat
 */
async function heartbeat(req, res) {
    try {
        const { latency_ms, bandwidth_mbps, cpu_usage, memory_usage } = req.body;

        // Update node metrics
        const nodeResult = await query(
            `UPDATE nodes SET
                latency_ms = COALESCE($1, latency_ms),
                bandwidth_mbps = COALESCE($2, bandwidth_mbps),
                last_heartbeat_at = NOW(),
                status = 'online'
             WHERE user_id = $3
             RETURNING id`,
            [latency_ms, bandwidth_mbps, req.user.id]
        );

        if (nodeResult.rows.length > 0) {
            // Record heartbeat for historical analytics
            await query(
                `INSERT INTO node_heartbeats (node_id, latency_ms, bandwidth_mbps, active_connections, cpu_usage_percent, memory_usage_percent)
                 VALUES ($1, $2, $3, 
                    (SELECT current_connections FROM nodes WHERE id = $1),
                    $4, $5)`,
                [nodeResult.rows[0].id, latency_ms, bandwidth_mbps, cpu_usage, memory_usage]
            );
        }

        res.json({ message: 'Heartbeat received', timestamp: new Date().toISOString() });
    } catch (error) {
        logger.error('Heartbeat error:', error);
        res.status(500).json({ error: 'Heartbeat failed' });
    }
}

/**
 * Get network statistics for the analytics dashboard.
 * GET /api/nodes/stats
 */
async function getNetworkStats(req, res) {
    try {
        const stats = await query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'online') as online_nodes,
                COUNT(*) FILTER (WHERE status = 'offline') as offline_nodes,
                COALESCE(AVG(latency_ms) FILTER (WHERE status = 'online'), 0) as avg_latency,
                COALESCE(SUM(bandwidth_mbps) FILTER (WHERE status = 'online'), 0) as total_bandwidth,
                COALESCE(SUM(current_connections), 0) as total_connections,
                COUNT(DISTINCT country_code) as countries_count
            FROM nodes
        `);

        const sessionStats = await query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'active') as active_sessions,
                COUNT(*) as total_sessions,
                COALESCE(SUM(data_transferred_mb), 0) as total_data_mb
            FROM sessions
        `);

        res.json({
            network: stats.rows[0],
            sessions: sessionStats.rows[0]
        });
    } catch (error) {
        logger.error('Get network stats error:', error);
        res.status(500).json({ error: 'Failed to get network statistics' });
    }
}

/**
 * Get all nodes for network visualization (D3.js graph).
 * GET /api/nodes/topology
 */
async function getTopology(req, res) {
    try {
        const nodes = await query(`
            SELECT 
                n.id, n.country_code, n.city, n.latitude, n.longitude,
                n.status, n.current_connections, n.trust_score, n.bandwidth_mbps,
                u.username
            FROM nodes n
            JOIN users u ON n.user_id = u.id
            WHERE n.status = 'online'
            LIMIT 100
        `);

        const connections = await query(`
            SELECT 
                s.consumer_node_id as source,
                s.provider_node_id as target,
                s.avg_bandwidth_mbps as bandwidth,
                s.avg_latency_ms as latency
            FROM sessions s
            WHERE s.status = 'active'
              AND s.consumer_node_id IS NOT NULL
            LIMIT 200
        `);

        res.json({
            nodes: nodes.rows,
            edges: connections.rows
        });
    } catch (error) {
        logger.error('Get topology error:', error);
        res.status(500).json({ error: 'Failed to get network topology' });
    }
}

module.exports = {
    registerNode,
    updateNodeStatus,
    discoverNodes,
    getMyNode,
    heartbeat,
    getNetworkStats,
    getTopology
};
