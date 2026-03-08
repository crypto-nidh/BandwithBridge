/**
 * Bandwidth Bridge - Main Server Entry Point
 * 
 * This file bootstraps the Express HTTP server and Socket.IO WebSocket server.
 * The HTTP server handles REST API requests (auth, nodes, sessions, etc.)
 * The Socket.IO server handles real-time WebRTC signaling between peers.
 * 
 * Architecture:
 *   Client <-> REST API  (authentication, data retrieval)
 *   Client <-> Socket.IO (WebRTC signaling: SDP offer/answer, ICE candidates)
 *   Client <-> Client    (actual P2P traffic via WebRTC DataChannel - NOT through this server)
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
const { connectDB, runMigrations } = require('./config/db');
const signalingServer = require('./webrtc/signalingServer');

// ---- Import API Routes ----
const authRoutes = require('./routes/auth');
const nodeRoutes = require('./routes/nodes');
const sessionRoutes = require('./routes/sessions');
const reputationRoutes = require('./routes/reputation');
const creditsRoutes = require('./routes/credits');
const analyticsRoutes = require('./routes/analytics');

const app = express();
const httpServer = http.createServer(app);

// ---- Socket.IO Setup ----
// CORS allowed for frontend development and production
const io = new SocketIOServer(httpServer, {
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true
    },
    // Increase ping timeout for stable P2P connections
    pingTimeout: 60000,
    pingInterval: 25000
});

// ---- Express Middleware ----

// Security headers
app.use(helmet({
    contentSecurityPolicy: false // Disabled for API server
}));

// CORS for REST API
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Request body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Global rate limiter - prevents abuse
const globalLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});
app.use(globalLimiter);

// Request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, { ip: req.ip, userAgent: req.get('user-agent') });
    next();
});

// ---- API Routes ----
app.use('/api/auth', authRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/reputation', reputationRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api/analytics', analyticsRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0'
    });
});

// ICE/STUN server configuration endpoint
// Returns WebRTC ICE server config to authenticated clients
app.get('/api/webrtc/ice-servers', (req, res) => {
    res.json({
        iceServers: [
            { urls: process.env.STUN_SERVER_1 || 'stun:stun.l.google.com:19302' },
            { urls: process.env.STUN_SERVER_2 || 'stun:stun1.l.google.com:19302' },
            { urls: process.env.STUN_SERVER_3 || 'stun:stun.stunprotocol.org:3478' }
            // Add TURN servers here if needed:
            // { urls: process.env.TURN_SERVER, username: process.env.TURN_USERNAME, credential: process.env.TURN_PASSWORD }
        ]
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', details: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

// ---- Initialize Signaling Server ----
// Attaches Socket.IO event handlers for WebRTC signaling
signalingServer.initialize(io);

// ---- Start Server ----
async function startServer() {
    try {
        // Connect to PostgreSQL and run migrations
        await connectDB();
        logger.info('✅ Database connected successfully');
        
        await runMigrations();
        logger.info('✅ Database migrations completed');

        const PORT = process.env.PORT || 3001;
        httpServer.listen(PORT, '0.0.0.0', () => {
            logger.info(`🚀 Bandwidth Bridge Server running on port ${PORT}`);
            logger.info(`📡 WebRTC Signaling Server active on Socket.IO`);
            logger.info(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    } catch (error) {
        logger.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown handler
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully...');
    httpServer.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

startServer();

module.exports = { app, io };
