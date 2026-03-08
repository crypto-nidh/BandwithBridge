/**
 * Socket.IO Service
 * 
 * Manages the WebSocket connection to the signaling server.
 * Provides a singleton socket instance shared across the frontend.
 * The token is obtained from localStorage on connection.
 */

import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

let socket = null;

/**
 * Get or create the Socket.IO connection.
 * Call this after the user has logged in (token must be in localStorage).
 * 
 * @returns {import('socket.io-client').Socket}
 */
export function getSocket() {
    if (!socket || !socket.connected) {
        const token = localStorage.getItem('bb_token');
        
        socket = io(SOCKET_URL, {
            auth: { token },
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionAttempts: 10,
            timeout: 20000
        });

        socket.on('connect', () => {
            console.log('[SOCKET] Connected to signaling server:', socket.id);
        });

        socket.on('connect_error', (err) => {
            console.error('[SOCKET] Connection error:', err.message);
        });

        socket.on('disconnect', (reason) => {
            console.warn('[SOCKET] Disconnected:', reason);
        });
    }

    return socket;
}

/**
 * Disconnect and clean up the socket.
 * Call this on logout.
 */
export function disconnectSocket() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}

export default { getSocket, disconnectSocket };
