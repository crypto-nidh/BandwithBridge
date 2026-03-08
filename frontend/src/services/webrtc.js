/**
 * WebRTC Service
 * 
 * Manages the WebRTC peer connection lifecycle.
 * Uses the signaling server (via Socket.IO) to exchange SDP and ICE candidates,
 * then establishes a direct P2P DataChannel for traffic.
 * 
 * The DataChannel simulates VPN tunneling — in a real browser extension,
 * you would use a service worker or tun/tap interface.
 * 
 * Connection flow:
 *   1. Consumer calls connectToPeer(targetSocketId)
 *   2. Provider receives 'connection-request' → creates RTCPeerConnection
 *   3. Provider creates SDP offer → sends via socket 'webrtc-offer'
 *   4. Consumer receives offer → creates SDP answer → sends 'webrtc-answer'  
 *   5. Both sides exchange ICE candidates
 *   6. DataChannel opens → P2P connected!
 */

import { getSocket } from './socket';

class WebRTCService {
    constructor() {
        this.peerConnection = null;
        this.dataChannel = null;
        this.onStatusChange = null;  // Callback: (status, data) => void
        this.onMetricsUpdate = null; // Callback: (metrics) => void
        this.metricsInterval = null;
        this.iceServers = null;
        this.sessionId = null;
        this.remoteSocketId = null;
        
        // Traffic simulation (since browser can't create real VPN tunnels)
        this.bytesSimulated = { sent: 0, received: 0 };
        this.simulationInterval = null;
    }

    /**
     * Set the ICE server configuration (STUN/TURN servers).
     * Call this once after fetching from /api/webrtc/ice-servers
     */
    setIceServers(servers) {
        this.iceServers = servers;
    }

    /**
     * Initialize event listeners on the Socket.IO connection.
     * Must be called once the socket is established.
     */
    initSignalingListeners() {
        const socket = getSocket();

        // Provider receives incoming connection request from consumer
        socket.on('connection-request', async ({ from, sessionInfo }) => {
            console.log('[WebRTC] Incoming connection request from:', from.peerId);
            this.remoteSocketId = from.socketId;
            
            if (this.onStatusChange) {
                this.onStatusChange('incoming-request', { from, sessionInfo });
            }
        });

        // Consumer receives SDP offer from provider
        socket.on('webrtc-offer', async ({ offer, fromSocketId, sessionId }) => {
            console.log('[WebRTC] Received offer from:', fromSocketId);
            this.remoteSocketId = fromSocketId;
            this.sessionId = sessionId;
            
            try {
                await this._handleOffer(offer, fromSocketId, sessionId);
            } catch (err) {
                console.error('Error handling offer:', err);
            }
        });

        // Provider receives SDP answer from consumer
        socket.on('webrtc-answer', async ({ answer, fromSocketId }) => {
            console.log('[WebRTC] Received answer from:', fromSocketId);
            try {
                await this.peerConnection?.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (err) {
                console.error('Error setting remote description:', err);
            }
        });

        // Both sides receive ICE candidates
        socket.on('ice-candidate', async ({ candidate }) => {
            try {
                if (candidate && this.peerConnection) {
                    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            } catch (err) {
                console.error('Error adding ICE candidate:', err);
            }
        });

        // Peer closed the connection
        socket.on('peer-disconnected', ({ reason }) => {
            console.warn('Peer disconnected:', reason);
            this._notifyStatus('disconnected', { reason });
            this.disconnect();
        });
    }

    /**
     * PROVIDER SIDE: Accept a connection request and create an SDP offer.
     * Called by the provider side after receiving 'incoming-request'.
     * 
     * @param {string} consumerSocketId - Socket ID of the consumer
     * @param {string} sessionId - Session ID from database
     */
    async acceptConnectionRequest(consumerSocketId, sessionId) {
        this.remoteSocketId = consumerSocketId;
        this.sessionId = sessionId;
        
        try {
            this._createPeerConnection();
            
            // Create a DataChannel BEFORE creating the offer (provider creates it)
            this.dataChannel = this.peerConnection.createDataChannel('vpn-channel', {
                ordered: true,
                maxRetransmits: 3
            });
            this._setupDataChannelListeners(this.dataChannel);

            // Create SDP offer
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            // Send offer to consumer via signaling server
            const socket = getSocket();
            socket.emit('webrtc-offer', {
                targetSocketId: consumerSocketId,
                offer: this.peerConnection.localDescription,
                sessionId
            });

            console.log('[WebRTC] Sent offer to consumer');
            this._notifyStatus('connecting', { role: 'provider' });
        } catch (err) {
            console.error('Error creating offer:', err);
            this._notifyStatus('error', { error: err.message });
        }
    }

    /**
     * CONSUMER SIDE: Connect to a provider node.
     * 
     * @param {string} targetPeerId - Provider's peer ID
     * @param {string} sessionId - Created session ID from database
     * @param {Object} sessionInfo - Session metadata
     */
    async connectToPeer(targetPeerId, sessionId, sessionInfo) {
        this.sessionId = sessionId;
        
        const socket = getSocket();
        socket.emit('connect-to-peer', { targetPeerId, sessionInfo });
        
        this._notifyStatus('connecting', { role: 'consumer', targetPeerId });
        console.log('[WebRTC] Requesting connection to peer:', targetPeerId);
    }

    /**
     * Handle incoming SDP offer (consumer side).
     * Creates an answer and sends it back via signaling.
     */
    async _handleOffer(offer, fromSocketId, sessionId) {
        this._createPeerConnection();

        // Consumer waits for DataChannel from provider
        this.peerConnection.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            this._setupDataChannelListeners(this.dataChannel);
        };

        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        const socket = getSocket();
        socket.emit('webrtc-answer', {
            targetSocketId: fromSocketId,
            answer: this.peerConnection.localDescription,
            sessionId
        });

        console.log('[WebRTC] Sent answer to provider');
    }

    /**
     * Create the RTCPeerConnection with STUN/TURN config.
     */
    _createPeerConnection() {
        const config = {
            iceServers: this.iceServers || [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.peerConnection = new RTCPeerConnection(config);

        // Send ICE candidates to the remote peer via signaling
        this.peerConnection.onicecandidate = ({ candidate }) => {
            if (candidate && this.remoteSocketId) {
                const socket = getSocket();
                socket.emit('ice-candidate', {
                    targetSocketId: this.remoteSocketId,
                    candidate,
                    sessionId: this.sessionId
                });
            }
        };

        // Track connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('[WebRTC] Connection state:', state);
            
            if (state === 'connected') {
                this._notifyStatus('connected', {});
                this._startMetricsCollection();
                this._startTrafficSimulation();
            } else if (['failed', 'closed', 'disconnected'].includes(state)) {
                this._notifyStatus(state, {});
                this._stopMetricsCollection();
                this._stopTrafficSimulation();
            }
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('[WebRTC] ICE state:', this.peerConnection.iceConnectionState);
        };
    }

    /**
     * Set up DataChannel event handlers.
     */
    _setupDataChannelListeners(channel) {
        channel.onopen = () => {
            console.log('[WebRTC] DataChannel opened — P2P tunnel active!');
            this._notifyStatus('connected', { channelOpen: true });
        };

        channel.onclose = () => {
            console.log('DataChannel closed');
        };

        channel.onerror = (err) => {
            console.error('DataChannel error:', err);
        };

        // In a real VPN, incoming data would be forwarded to the OS network stack.
        // Here we just log it and update our byte counter.
        channel.onmessage = (event) => {
            this.bytesSimulated.received += event.data.byteLength || event.data.length || 0;
        };
    }

    /**
     * Simulate bandwidth traffic over the DataChannel.
     * In a real browser VPN extension, this would be actual network packets.
     */
    _startTrafficSimulation() {
        this.simulationInterval = setInterval(() => {
            if (this.dataChannel?.readyState === 'open') {
                // Simulate sending 50-200 KB/s of data
                const chunkSize = Math.floor(Math.random() * 150000) + 50000;
                const data = new Uint8Array(Math.min(chunkSize, 65536)); // Max 64KB per message
                try {
                    this.dataChannel.send(data);
                    this.bytesSimulated.sent += data.byteLength;
                } catch (e) { /* Buffer full, skip */ }
            }
        }, 1000);
    }

    _stopTrafficSimulation() {
        if (this.simulationInterval) {
            clearInterval(this.simulationInterval);
            this.simulationInterval = null;
        }
    }

    /**
     * Collect WebRTC stats periodically for real-time monitoring.
     */
    _startMetricsCollection() {
        this.metricsInterval = setInterval(async () => {
            if (!this.peerConnection) return;

            try {
                const stats = await this.peerConnection.getStats();
                const metrics = { latency: 0, bandwidth: 0, packetLoss: 0 };

                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        metrics.latency = report.currentRoundTripTime ? report.currentRoundTripTime * 1000 : 0;
                    }
                    if (report.type === 'outbound-rtp') {
                        const bytesSent = report.bytesSent + this.bytesSimulated.sent;
                        metrics.bandwidth = Math.round((bytesSent / 1024 / 1024) * 8); // Mbps estimate
                    }
                });

                metrics.bytesTotal = this.bytesSimulated.sent + this.bytesSimulated.received;

                if (this.onMetricsUpdate) {
                    this.onMetricsUpdate(metrics);
                }
            } catch (e) { /* Ignore stats errors */ }
        }, 2000);
    }

    _stopMetricsCollection() {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }
    }

    /**
     * Disconnect and clean up all WebRTC resources.
     */
    disconnect() {
        this._stopMetricsCollection();
        this._stopTrafficSimulation();

        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        const socket = getSocket();
        if (this.remoteSocketId && socket) {
            socket.emit('session-ended', {
                targetSocketId: this.remoteSocketId,
                reason: 'user_disconnect',
                sessionId: this.sessionId
            });
        }

        this.remoteSocketId = null;
        this.sessionId = null;
        this.bytesSimulated = { sent: 0, received: 0 };
        
        console.log('[WebRTC] Connection closed');
    }

    _notifyStatus(status, data) {
        if (this.onStatusChange) {
            this.onStatusChange(status, data);
        }
    }

    getConnectionState() {
        return this.peerConnection?.connectionState || 'disconnected';
    }

    getDataChannelState() {
        return this.dataChannel?.readyState || 'closed';
    }

    getBytesTransferred() {
        return this.bytesSimulated;
    }
}

// Export singleton instance
const webrtcService = new WebRTCService();
export default webrtcService;
