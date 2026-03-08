/**
 * JWT Authentication Middleware
 * 
 * Verifies the JWT token sent in the Authorization header.
 * Attaches the decoded user payload to req.user for downstream handlers.
 * 
 * Usage: router.get('/protected', authMiddleware, handler)
 */

const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Main authentication middleware.
 * Expects: Authorization: Bearer <token>
 */
async function authMiddleware(req, res, next) {
    try {
        // Extract token from Authorization header
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No authentication token provided' });
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify and decode the JWT
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (jwtError) {
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'Token has expired, please login again' });
            }
            return res.status(401).json({ error: 'Invalid authentication token' });
        }

        // Verify the user still exists and is not banned
        const result = await query(
            'SELECT id, email, username, role, is_active, is_banned, trust_score, credit_balance FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User account not found' });
        }

        const user = result.rows[0];

        if (!user.is_active || user.is_banned) {
            return res.status(403).json({ error: 'Account is suspended or banned' });
        }

        // Attach user to request object for downstream use
        req.user = {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            trustScore: parseFloat(user.trust_score),
            creditBalance: user.credit_balance
        };

        next();
    } catch (error) {
        logger.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Authentication check failed' });
    }
}

/**
 * Role-based access control middleware factory.
 * @param {...string} roles - Allowed roles (e.g., 'provider', 'consumer', 'both')
 */
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        // 'both' role has access to all role-restricted routes
        const userRole = req.user.role;
        const hasAccess = roles.includes(userRole) || userRole === 'both';
        
        if (!hasAccess) {
            return res.status(403).json({ 
                error: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${userRole}` 
            });
        }
        
        next();
    };
}

module.exports = { authMiddleware, requireRole };
