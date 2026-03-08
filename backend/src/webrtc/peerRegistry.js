/**
 * Peer Registry
 * 
 * In-memory store for currently connected WebSocket peers.
 * Maps socket IDs and peer IDs to peer metadata.
 * 
 * In production, this should be backed by Redis for multi-node deployments.
 */

// Map: socketId -> peer data
const peersBySocket = new Map();

// Map: peerId -> socketId
const socketByPeerId = new Map();

/**
 * Register a new peer when they join the network.
 */
function registerPeer({ socketId, userId, peerId, role, metadata }) {
    const peer = {
        socketId,
        userId,
        peerId,
        role,
        metadata,
        joinedAt: new Date().toISOString(),
        metrics: { bandwidth: 0, latency: 0 }
    };

    peersBySocket.set(socketId, peer);
    socketByPeerId.set(peerId, { socketId, role });
}

/**
 * Remove a peer from the registry when they disconnect.
 */
function removePeer(socketId) {
    const peer = peersBySocket.get(socketId);
    if (peer) {
        socketByPeerId.delete(peer.peerId);
        peersBySocket.delete(socketId);
    }
}

/**
 * Get a peer's socket info by their peerId.
 */
function getSocketByPeerId(peerId) {
    return socketByPeerId.get(peerId) || null;
}

/**
 * Get an online peer's peerId by their socketId.
 */
function getPeerIdBySocket(socketId) {
    const peer = peersBySocket.get(socketId);
    return peer ? peer.peerId : null;
}

/**
 * Update real-time metrics for a peer.
 */
function updatePeerMetrics(socketId, metrics) {
    const peer = peersBySocket.get(socketId);
    if (peer) {
        peer.metrics = { ...peer.metrics, ...metrics };
    }
}

/**
 * Get all online peers (for debugging/admin).
 */
function getAllPeers() {
    return Array.from(peersBySocket.values());
}

/**
 * Count of all currently connected peers.
 */
function getOnlinePeerCount() {
    return peersBySocket.size;
}

/**
 * Count of provider peers currently sharing.
 */
function getProviderCount() {
    let count = 0;
    for (const peer of peersBySocket.values()) {
        if ((peer.role === 'provider' || peer.role === 'both') && peer.metadata?.isSharing) {
            count++;
        }
    }
    return count;
}

module.exports = {
    registerPeer,
    removePeer,
    getSocketByPeerId,
    getPeerIdBySocket,
    updatePeerMetrics,
    getAllPeers,
    getOnlinePeerCount,
    getProviderCount
};
