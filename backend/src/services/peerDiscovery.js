/**
 * Peer Discovery Service
 * 
 * Implements the node scoring algorithm that matches consumers with optimal providers.
 * 
 * Scoring Formula:
 *   Score = (latencyScore * 0.40) + (bandwidthScore * 0.30) + (trustScore * 0.30)
 * 
 * Where:
 *   - latencyScore = max(0, 1 - latency_ms / 500) → penalizes high latency
 *   - bandwidthScore = min(1, bandwidth_mbps / 100) → rewards higher bandwidth
 *   - trustScore = trust_score / 10 → normalized 0-1 from 0-10 scale
 */

/**
 * Score and rank a list of candidate provider nodes.
 * 
 * @param {Array} nodes - Raw node records from database
 * @returns {Array} Sorted nodes with computed discovery_score
 */
function scoreAndRankNodes(nodes) {
    return nodes
        .map(node => {
            const score = computeNodeScore(node);
            return { ...node, discovery_score: score };
        })
        .filter(node => node.discovery_score > 0)
        .sort((a, b) => b.discovery_score - a.discovery_score);
}

/**
 * Compute a discovery score for a single node.
 * 
 * @param {Object} node - Node data from database
 * @returns {number} Score between 0.0 and 1.0
 */
function computeNodeScore(node) {
    const latency = parseFloat(node.latency_ms) || 100;
    const bandwidth = parseFloat(node.bandwidth_mbps) || 1;
    const trust = parseFloat(node.trust_score) || 5.0;
    const currentConns = parseInt(node.current_connections) || 0;
    const maxConns = parseInt(node.max_connections) || 5;

    // Latency score: 0ms → 1.0, 500ms → 0.0 (linear decay)
    const latencyScore = Math.max(0, 1 - latency / 500);

    // Bandwidth score: 100+ Mbps → 1.0 (capped)
    const bandwidthScore = Math.min(1, bandwidth / 100);

    // Trust score: normalize from 0-10 to 0-1
    const trustScore = trust / 10;

    // Capacity factor: penalize nodes that are nearly full
    const capacityFactor = maxConns > 0 ? 1 - (currentConns / maxConns) * 0.5 : 1;

    // Weighted combination
    const rawScore = (latencyScore * 0.40) + (bandwidthScore * 0.30) + (trustScore * 0.30);

    // Apply capacity factor
    return rawScore * capacityFactor;
}

/**
 * Find optimal multi-hop route through a list of nodes.
 * Uses a greedy algorithm to select the best intermediate hops.
 * 
 * @param {Array} availableNodes - Available provider nodes
 * @param {number} maxHops - Maximum number of hops (default 3)
 * @returns {Array} Ordered list of node IDs forming the routing path
 */
function computeMultiHopRoute(availableNodes, maxHops = 3) {
    if (!availableNodes || availableNodes.length === 0) return [];

    // Sort by score (best first)
    const scored = scoreAndRankNodes(availableNodes);
    
    if (scored.length === 0) return [];

    // For simplicity, select up to maxHops best nodes for the route
    // In production, this would use a path optimization algorithm (e.g., Dijkstra)
    const hops = scored.slice(0, Math.min(maxHops, scored.length));
    
    return hops.map(node => ({
        nodeId: node.id,
        peerId: node.peer_id,
        country: node.country_name,
        score: node.discovery_score
    }));
}

/**
 * Detect suspicious node behavior based on recent metrics.
 * Flags nodes that may be performing attack or low-quality service.
 * 
 * @param {Object} node - Node metrics snapshot
 * @returns {{ suspicious: boolean, reasons: string[] }}
 */
function detectSuspiciousNode(node) {
    const reasons = [];

    // Very low latency could indicate fake metrics
    if (node.latency_ms < 1 && node.bandwidth_mbps > 500) {
        reasons.push('Unrealistic performance metrics');
    }

    // Trust score suddenly dropped (could indicate review bombing or bad actor)
    if (parseFloat(node.trust_score) < 2.0) {
        reasons.push('Very low trust score');
    }

    // Extremely high packet loss
    if (node.avg_packet_loss > 20) {
        reasons.push('High packet loss detected');
    }

    return {
        suspicious: reasons.length > 0,
        reasons
    };
}

module.exports = { scoreAndRankNodes, computeNodeScore, computeMultiHopRoute, detectSuspiciousNode };
