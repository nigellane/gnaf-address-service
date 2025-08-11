import dotenv from 'dotenv';

// Load environment variables before any other imports
dotenv.config();

import winston from 'winston';
import app from './app';
import { getDatabase } from './config/database';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}] Server: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
  try {
    const db = getDatabase();
    const health = await db.healthCheck();
    
    if (!health.healthy) {
      throw new Error(`Database connection failed: ${health.error}`);
    }
    
    logger.info('Database connection verified', {
      latency: health.latency
    });

    const server = app.listen(PORT, HOST, () => {
      logger.info('G-NAF Address Service started successfully', {
        port: PORT,
        host: HOST,
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '0.1.0'
      });
    });

    server.keepAliveTimeout = 30000;
    server.headersTimeout = 35000;

    const gracefulShutdown = (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown`);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        try {
          await db.close();
          logger.info('Database connections closed');
          process.exit(0);
        } catch (error) {
          logger.error('Error during database shutdown', {
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          process.exit(1);
        }
      });
      
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    process.exit(1);
  }
}

startServer();