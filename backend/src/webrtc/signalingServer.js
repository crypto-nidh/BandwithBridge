/**
 * WebRTC Signaling Server
 * 
 * This is the CORE of the P2P coordination layer.
 * 
 * Responsibilities:
 *   1. Authenticate peers (via JWT token in socket handshake)
 *   2. Maintain a registry of connected peers
 *   3. Exchange WebRTC signaling messages (SDP offer/answer, ICE candidates)
 *   4. Notify peers of network events (peer connected, disconnected, etc.)
 * 
 * IMPORTANT: This server NEVER sees VPN traffic.
 * After signaling completes, peers communicate DIRECTLY via WebRTC DataChannel.
 * 
 * Message flow for P2P connection establishment:
 * 
 *   Consumer                  Signaling Server              Provider
 *      |                           |                           |
 *      |--- join-network -------->|                           |
 *      |                           |<-- join-network ---------|
 *      |                           |                           |
 *      |--- connect-to-peer ----->|                           |
 *      |                           |--- connection-request -->|
 *      |                           |                           |
 *      |                           |<-- webrtc-offer ---------|
 *      |<-- webrtc-offer ----------|                           |
 *      |                           |                           |
 *      |--- webrtc-answer ------->|                           |
 *      |                           |--- webrtc-answer ------->|
 *      |                           |                           |
 *      |<-- ice-candidate -------->| (forwarded both ways)   |
 *      |                           |                           |
 *      |<=================== WebRTC DataChannel =============>|
 *      |    (P2P direct — signaling server not involved!)     |
 */

const jwt = require('jsonwebtoken');
const peerRegistry = require('./peerRegistry');
const logger = require('../utils/logger');

/**
 * Initialize signaling server and attach Socket.IO event handlers.
 * Call this once with the Socket.IO server instance.
 * 
 * @param {import('socket.io').Server} io - Socket.IO server instance
 */
function initialize(io) {
    // Middleware: authenticate socket connections using JWT
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
            
            if (!token) {
                logger.warn(`Socket connection rejected: no token (${socket.id})`);
                return next(new Error('Authentication required'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.userId;
            socket.userEmail = decoded.email;
            socket.userRole = decoded.role;
            
            logger.info(`Socket authenticated: ${decoded.email} (${socket.id})`);
            next();
        } catch (err) {
            logger.warn(`Socket auth failed: ${err.message}`);
            next(new Error('Invalid authentication token'));
        }
    });

    io.on('connection', (socket) => {
        logger.info(`🔌 Peer connected: ${socket.userEmail} [${socket.id}]`);

        // ==========================================
        // EVENT: join-network
        // Peer announces itself as available.
        // Provider or Consumer joins the peer registry.
        // ==========================================
        socket.on('join-network', (data) => {
            const peerId = data?.peerId || socket.id;
            
            peerRegistry.registerPeer({
                socketId: socket.id,
                userId: socket.userId,
                peerId,
                role: socket.userRole,
                metadata: {
                    country: data?.country || 'Unknown',
                    bandwidth: data?.bandwidth || 0,
                    isSharing: data?.isSharing || false,
                    latitude: data?.latitude,
                    longitude: data?.longitude
                }
            });

            // Confirm registration to peer
            socket.emit('network-joined', { 
                peerId, 
                onlinePeers: peerRegistry.getOnlinePeerCount()
            });

            // Broadcast updated peer count to all
            io.emit('network-stats-update', { 
                onlinePeers: peerRegistry.getOnlinePeerCount(),
                providers: peerRegistry.getProviderCount()
            });

            logger.info(`Peer joined network: ${socket.userEmail} as ${socket.userRole}`);
        });

        // ==========================================
        // EVENT: connect-to-peer
        // Consumer requests to connect to a specific provider node.
        // Triggers WebRTC offer/answer exchange.
        // ==========================================
        socket.on('connect-to-peer', ({ targetPeerId, sessionInfo }) => {
            const targetSocket = peerRegistry.getSocketByPeerId(targetPeerId);
            
            if (!targetSocket) {
                socket.emit('connection-error', { 
                    error: 'Target peer is not available',
                    targetPeerId
                });
                return;
            }

            const targetSocketInstance = io.sockets.sockets.get(targetSocket.socketId);
            
            if (!targetSocketInstance) {
                socket.emit('connection-error', { 
                    error: 'Target peer disconnected',
                    targetPeerId
                });
                return;
            }

            // Notify provider of incoming connection request
            targetSocketInstance.emit('connection-request', {
                from: {
                    socketId: socket.id,
                    userId: socket.userId,
                    peerId: peerRegistry.getPeerIdBySocket(socket.id)
                },
                sessionInfo
            });

            logger.info(`Connection request: ${socket.userEmail} → ${targetPeerId}`);
        });

        // ==========================================
        // EVENT: webrtc-offer
        // Provider sends SDP offer to consumer.
        // Server forwards it without modification.
        // ==========================================
        socket.on('webrtc-offer', ({ targetSocketId, offer, sessionId }) => {
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            
            if (!targetSocket) {
                socket.emit('signaling-error', { error: 'Target peer not found', sessionId });
                return;
            }

            // Forward SDP offer to the target peer
            targetSocket.emit('webrtc-offer', {
                offer,
                fromSocketId: socket.id,
                fromPeerId: peerRegistry.getPeerIdBySocket(socket.id),
                sessionId
            });

            logger.debug(`SDP offer forwarded: ${socket.id} → ${targetSocketId}`);
        });

        // ==========================================
        // EVENT: webrtc-answer
        // Consumer sends SDP answer back to provider.
        // ==========================================
        socket.on('webrtc-answer', ({ targetSocketId, answer, sessionId }) => {
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            
            if (!targetSocket) {
                socket.emit('signaling-error', { error: 'Target peer not found', sessionId });
                return;
            }

            targetSocket.emit('webrtc-answer', {
                answer,
                fromSocketId: socket.id,
                sessionId
            });

            logger.debug(`SDP answer forwarded: ${socket.id} → ${targetSocketId}`);
        });

        // ==========================================
        // EVENT: ice-candidate
        // Either side sends ICE candidates for NAT traversal.
        // Server forwards them to the other peer.
        // ICE candidates are needed to find the best network path.
        // ==========================================
        socket.on('ice-candidate', ({ targetSocketId, candidate, sessionId }) => {
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            
            if (targetSocket) {
                targetSocket.emit('ice-candidate', {
                    candidate,
                    fromSocketId: socket.id,
                    sessionId
                });
            }
        });

        // ==========================================
        // EVENT: peer-metrics-update
        // Provider sends bandwidth/latency updates.
        // Forwarded to connected consumers for real-time monitoring.
        // ==========================================
        socket.on('peer-metrics-update', ({ metrics }) => {
            peerRegistry.updatePeerMetrics(socket.id, metrics);
            
            // Broadcast updated stats to all connected clients
            socket.broadcast.emit('network-metrics-changed', {
                peerId: peerRegistry.getPeerIdBySocket(socket.id),
                metrics
            });
        });

        // ==========================================
        // EVENT: session-ended
        // Either peer signals that the session is over.
        // ==========================================
        socket.on('session-ended', ({ targetSocketId, reason, sessionId }) => {
            const targetSocket = io.sockets.sockets.get(targetSocketId);
            
            if (targetSocket) {
                targetSocket.emit('peer-disconnected', {
                    fromSocketId: socket.id,
                    reason: reason || 'peer_closed',
                    sessionId
                });
            }

            logger.info(`Session ended via signaling: ${sessionId} (reason: ${reason})`);
        });

        // ==========================================
        // EVENT: disconnect
        // Handle unexpected disconnections.
        // ==========================================
        socket.on('disconnect', (reason) => {
            const peerId = peerRegistry.getPeerIdBySocket(socket.id);
            peerRegistry.removePeer(socket.id);

            // Notify all peers that this node went offline
            if (peerId) {
                socket.broadcast.emit('peer-went-offline', { 
                    peerId, 
                    socketId: socket.id,
                    reason
                });
            }

            io.emit('network-stats-update', { 
                onlinePeers: peerRegistry.getOnlinePeerCount(),
                providers: peerRegistry.getProviderCount()
            });

            logger.info(`🔌 Peer disconnected: ${socket.userEmail} [${socket.id}] reason: ${reason}`);
        });
    });

    logger.info('📡 WebRTC Signaling Server initialized');
}

module.exports = { initialize };
