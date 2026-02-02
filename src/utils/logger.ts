import winston from 'winston';
import path from 'path';

const logDir = path.join(__dirname, '../../logs');

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      if (stack) {
        return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`;
      }
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    // Console output with colors
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} [${level}]: ${message}`;
        })
      ),
    }),
    // File output for errors
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
    }),
    // File output for all logs
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
    }),
  ],
});

// Helper functions for structured logging
export const logJobSearch = (query: string, resultsCount: number) => {
  logger.info(`Job search: "${query}" - Found ${resultsCount} results`);
};

export const logApplication = (jobId: string, company: string, status: string) => {
  logger.info(`Application [${jobId}] ${company}: ${status}`);
};

export const logError = (context: string, error: Error | string) => {
  if (error instanceof Error) {
    logger.error(`${context}: ${error.message}`, { stack: error.stack });
  } else {
    logger.error(`${context}: ${error}`);
  }
};

export const logRateLimit = (platform: string, nextAllowedTime: Date) => {
  logger.warn(`Rate limit reached for ${platform}. Next application allowed at ${nextAllowedTime.toISOString()}`);
};
