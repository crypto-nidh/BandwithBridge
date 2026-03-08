/**
 * Winston Logger Configuration
 * 
 * Provides structured logging with different transports for
 * development (console) and production (file).
 */

const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, colorize, errors } = format;

// Custom log format: [TIMESTAMP] LEVEL: message
const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (stack) log += `\n${stack}`;
    if (Object.keys(meta).length > 0) {
        log += ` ${JSON.stringify(meta)}`;
    }
    return log;
});

const logger = createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
    ),
    transports: [
        // Console output (with colors in development)
        new transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: 'HH:mm:ss' }),
                logFormat
            )
        })
    ]
});

module.exports = logger;
