/**
 * Authentication Controller
 * 
 * Handles user registration and login.
 * 
 * Security measures:
 * - Passwords hashed with bcrypt (12 rounds)
 * - JWT tokens with 24h expiry
 * - Input validation via express-validator
 * - Rate limiting applied at route level
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Register a new user account.
 * POST /api/auth/register
 * 
 * Body: { email, password, username, role, country_code? }
 */
async function register(req, res) {
    try {
        const { email, password, username, role, country_code } = req.body;

        // Validate required fields
        if (!email || !password || !username || !role) {
            return res.status(400).json({ error: 'Email, password, username, and role are required' });
        }

        if (!['provider', 'consumer', 'both'].includes(role)) {
            return res.status(400).json({ error: 'Role must be provider, consumer, or both' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        // Check if email or username already exists
        const existingUser = await query(
            'SELECT id FROM users WHERE email = $1 OR username = $2',
            [email.toLowerCase(), username]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Email or username already registered' });
        }

        // Hash password with bcrypt (12 rounds = strong security)
        const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Create user record
        const result = await query(
            `INSERT INTO users (email, password_hash, username, role, country_code, credit_balance)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, email, username, role, trust_score, credit_balance, created_at`,
            [email.toLowerCase(), passwordHash, username, role, country_code || null, 100]
        );

        const newUser = result.rows[0];

        // Record initial credit transaction
        await query(
            `INSERT INTO credit_transactions (user_id, type, amount, balance_after, description)
             VALUES ($1, 'initial', 100, 100, 'Welcome bonus credits')`,
            [newUser.id]
        );

        // Generate JWT token
        const token = generateToken(newUser);

        logger.info(`New user registered: ${email} (${role})`);

        res.status(201).json({
            message: 'Account created successfully',
            token,
            user: {
                id: newUser.id,
                email: newUser.email,
                username: newUser.username,
                role: newUser.role,
                trustScore: parseFloat(newUser.trust_score),
                creditBalance: newUser.credit_balance,
                createdAt: newUser.created_at
            }
        });

    } catch (error) {
        logger.error('Register error:', error);
        res.status(500).json({ error: 'Registration failed, please try again' });
    }
}

/**
 * Login with email and password.
 * POST /api/auth/login
 * 
 * Body: { email, password }
 */
async function login(req, res) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Find user by email
        const result = await query(
            `SELECT id, email, username, role, password_hash, is_active, is_banned, 
                    ban_reason, trust_score, credit_balance 
             FROM users WHERE email = $1`,
            [email.toLowerCase()]
        );

        if (result.rows.length === 0) {
            // Don't reveal whether email exists (security best practice)
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = result.rows[0];

        // Check account status
        if (user.is_banned) {
            return res.status(403).json({ error: `Account banned: ${user.ban_reason || 'Policy violation'}` });
        }

        if (!user.is_active) {
            return res.status(403).json({ error: 'Account is deactivated' });
        }

        // Verify password against bcrypt hash
        const passwordValid = await bcrypt.compare(password, user.password_hash);
        if (!passwordValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Update last seen timestamp
        await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [user.id]);

        // Generate JWT
        const token = generateToken(user);

        logger.info(`User logged in: ${email}`);

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                role: user.role,
                trustScore: parseFloat(user.trust_score),
                creditBalance: user.credit_balance
            }
        });

    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({ error: 'Login failed, please try again' });
    }
}

/**
 * Get the current user's profile.
 * GET /api/auth/me (requires auth)
 */
async function getProfile(req, res) {
    try {
        const result = await query(
            `SELECT id, email, username, role, country_code, trust_score, total_ratings,
                    credit_balance, created_at, last_seen_at
             FROM users WHERE id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user: result.rows[0] });
    } catch (error) {
        logger.error('Get profile error:', error);
        res.status(500).json({ error: 'Failed to get profile' });
    }
}

/**
 * Update user profile settings.
 * PUT /api/auth/profile (requires auth)
 */
async function updateProfile(req, res) {
    try {
        const { country_code, timezone } = req.body;
        
        await query(
            'UPDATE users SET country_code = $1, timezone = $2 WHERE id = $3',
            [country_code, timezone, req.user.id]
        );

        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        logger.error('Update profile error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
}

/**
 * Generates a signed JWT token for the given user.
 * Token payload includes userId, email, and role for quick access.
 * 
 * @param {Object} user - User record from database
 * @returns {string} Signed JWT token
 */
function generateToken(user) {
    return jwt.sign(
        {
            userId: user.id,
            email: user.email,
            role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRY || '24h' }
    );
}

module.exports = { register, login, getProfile, updateProfile };
