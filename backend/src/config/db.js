/**
 * Database Configuration and Connection Pool
 * 
 * Uses the `pg` library to create a PostgreSQL connection pool.
 * The pool manages multiple concurrent database connections efficiently.
 * Includes automatic migration runner to set up schema on first start.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Create connection pool using environment variables
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'bandwidth_bridge',
    user: process.env.DB_USER || 'bbuser',
    password: process.env.DB_PASSWORD || 'bbpassword123',
    
    // Pool configuration
    max: 20,                    // Maximum number of connections in pool
    idleTimeoutMillis: 30000,   // Close idle connections after 30s
    connectionTimeoutMillis: 10000, // Timeout if connection takes >10s
});

// Log pool errors
pool.on('error', (err) => {
    logger.error('Unexpected database pool error:', err);
});

/**
 * Connects to the database and verifies the connection is working.
 * Called once on server startup.
 */
async function connectDB() {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT NOW() as current_time');
        logger.info(`Database connected at: ${result.rows[0].current_time}`);
    } finally {
        client.release();
    }
}

/**
 * Runs SQL migration files in order.
 * Looks for .sql files in the /database/migrations directory.
 * In production, use a proper migration tool like Flyway or node-pg-migrate.
 */
async function runMigrations() {
    const migrationsDir = path.join(__dirname, '../../../database/migrations');
    
    if (!fs.existsSync(migrationsDir)) {
        logger.warn('Migrations directory not found, skipping migrations');
        return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort(); // Run in alphabetical order (001_, 002_, etc.)

    for (const file of migrationFiles) {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf8');
        
        try {
            await pool.query(sql);
            logger.info(`✅ Migration applied: ${file}`);
        } catch (error) {
            // Ignore "already exists" errors from re-running migrations
            if (error.code === '42P07' || error.message.includes('already exists')) {
                logger.info(`ℹ️  Migration already applied: ${file}`);
            } else {
                logger.error(`❌ Migration failed: ${file}`, error.message);
                throw error;
            }
        }
    }
}

/**
 * Execute a database query with optional parameters.
 * Wraps pool.query for consistent error handling.
 * 
 * @param {string} text - SQL query string
 * @param {Array} params - Query parameters (prevents SQL injection)
 * @returns {Promise<pg.QueryResult>}
 */
async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        
        if (duration > 1000) {
            logger.warn(`Slow query (${duration}ms): ${text.substring(0, 100)}`);
        }
        
        return result;
    } catch (error) {
        logger.error('Database query error:', { text: text.substring(0, 200), error: error.message });
        throw error;
    }
}

/**
 * Get a client from the pool for transactions.
 * Remember to call client.release() after use.
 */
async function getClient() {
    return pool.connect();
}

module.exports = { pool, query, getClient, connectDB, runMigrations };
