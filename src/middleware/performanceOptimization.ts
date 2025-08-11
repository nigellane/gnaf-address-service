/**
 * Performance Optimization Middleware
 * Integrates all performance optimization services into Express middleware stack
 */

import { Request, Response, NextFunction } from 'express';
import { circuitBreakerService } from '../services/circuitBreakerService';
import { requestThrottlingService, RequestThrottlingService } from '../services/requestThrottlingService';
import { gracefulDegradationService } from '../services/gracefulDegradationService';
import { performanceMonitoringService } from '../services/performanceMonitoringService';
import { performanceTracker, memoryTracker, requestSizeTracker } from './performanceTracking';
import { responseCache } from './caching';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('PerformanceOptimization');

/**
 * Initialize all performance optimization services
 */
export function initializePerformanceServices(): void {
  logger.info('Initializing performance optimization services');

  // Create default circuit breakers
  try {
    circuitBreakerService.createDatabaseCircuitBreaker();
    circuitBreakerService.createRedisCircuitBreaker();
    circuitBreakerService.startMonitoring();
    logger.info('Circuit breakers initialized');
  } catch (error) {
    logger.warn('Circuit breakers already initialized or failed to initialize');
  }

  // Initialize graceful degradation
  gracefulDegradationService.initialize({
    enabled: process.env.GRACEFUL_DEGRADATION_ENABLED !== 'false',
    autoMode: process.env.GRACEFUL_DEGRADATION_AUTO_MODE !== 'false'
  });

  logger.info('Performance optimization services initialized successfully');
}

/**
 * Complete performance middleware stack
 */
export function createPerformanceMiddleware() {
  const rateLimitConfig = requestThrottlingService.createRateLimitMiddleware(
    RequestThrottlingService.getDefaultRateLimitConfig()
  );

  const priorityQueueConfig = requestThrottlingService.createPriorityQueueMiddleware(
    RequestThrottlingService.getDefaultPriorityConfig(),
    RequestThrottlingService.getDefaultLoadSheddingConfig()
  );

  const loadSheddingConfig = requestThrottlingService.createLoadSheddingMiddleware(
    RequestThrottlingService.getDefaultLoadSheddingConfig()
  );

  return [
    // Request size tracking (must be early in the stack)
    requestSizeTracker(),
    
    // Performance tracking (must be early to capture full request lifecycle)
    performanceTracker(),
    
    // Memory tracking
    memoryTracker(),
    
    // Rate limiting (before load shedding to count requests)
    rateLimitConfig,
    
    // Load shedding (reject requests if system overloaded)
    loadSheddingConfig,
    
    // Priority queuing (queue requests during high load)
    priorityQueueConfig,
    
    // Response caching (after request processing)
    responseCache({ ttl: 300 }),
    
    // Request completion tracking
    requestCompletionMiddleware()
  ];
}

/**
 * Middleware to track request completion for throttling service
 */
function requestCompletionMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalEnd = res.end;
    
    res.end = function(this: Response, ...args: any[]) {
      requestThrottlingService.trackRequestEnd(req, this.statusCode);
      return (originalEnd as any).apply(this, args);
    };
    
    next();
  };
}

/**
 * Database operation wrapper with circuit breaker
 */
export function withDatabaseCircuitBreaker<T>(
  operation: () => Promise<T>,
  fallback?: () => Promise<T>
): Promise<T> {
  const circuitBreaker = circuitBreakerService.getCircuitBreaker('database');
  
  if (!circuitBreaker) {
    logger.warn('Database circuit breaker not found, executing operation directly');
    return operation();
  }
  
  return circuitBreaker.execute(operation, fallback);
}

/**
 * Redis operation wrapper with circuit breaker
 */
export function withRedisCircuitBreaker<T>(
  operation: () => Promise<T>,
  fallback?: () => Promise<T>
): Promise<T> {
  const circuitBreaker = circuitBreakerService.getCircuitBreaker('redis');
  
  if (!circuitBreaker) {
    logger.warn('Redis circuit breaker not found, executing operation directly');
    return operation();
  }
  
  return circuitBreaker.execute(operation, fallback);
}

/**
 * Feature degradation wrapper
 */
export function withGracefulDegradation<T>(
  featureName: string,
  normalOperation: () => Promise<T>,
  fallbackOperation?: () => Promise<T>
): Promise<T> {
  return gracefulDegradationService.executeWithDegradation(
    featureName,
    normalOperation,
    fallbackOperation
  );
}

/**
 * Cache-only fallback wrapper
 */
export function withCacheOnlyFallback<T>(
  cacheKey: string,
  databaseOperation: () => Promise<T>,
  fallbackValue?: T
): Promise<T> {
  return gracefulDegradationService.executeCacheOnlyFallback(
    cacheKey,
    databaseOperation,
    fallbackValue
  );
}

/**
 * Performance metrics collection wrapper
 */
export function withPerformanceTracking<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  
  return operation().then(
    (result) => {
      const duration = Date.now() - startTime;
      performanceMonitoringService.recordMetrics({
        endpoint: operationName,
        method: 'INTERNAL',
        responseTime: duration,
        statusCode: 200,
        cacheHit: false,
        dbQueryTime: 0,
        dbQueryCount: 0
      });
      return result;
    },
    (error) => {
      const duration = Date.now() - startTime;
      performanceMonitoringService.recordMetrics({
        endpoint: operationName,
        method: 'INTERNAL',
        responseTime: duration,
        statusCode: 500,
        cacheHit: false,
        dbQueryTime: 0,
        dbQueryCount: 0
      });
      throw error;
    }
  );
}

/**
 * Error handler with degradation awareness
 */
export function performanceAwareErrorHandler() {
  return (err: Error, req: Request, res: Response, next: NextFunction) => {
    // Log error with performance context
    logger.error('Request failed', {
      error: err.message,
      path: req.path,
      method: req.method,
      statusCode: res.statusCode,
      degradationLevel: gracefulDegradationService.getStatus().level
    });

    // Check if we should provide a degraded response
    const degradationStatus = gracefulDegradationService.getStatus();
    
    if (degradationStatus.level !== 'normal') {
      const fallbackResponse = gracefulDegradationService.getFallbackResponse('error-handling');
      
      res.status(503).json({
        error: 'Service temporarily degraded',
        message: 'We are experiencing technical difficulties. Please try again later.',
        degraded: true,
        degradationLevel: degradationStatus.level,
        retryAfter: 30
      });
      return;
    }

    // Standard error handling
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred',
        requestId: req.headers['x-request-id']
      });
    }
  };
}

/**
 * Graceful shutdown handler
 */
export function setupGracefulShutdown(): void {
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

async function gracefulShutdown(): Promise<void> {
  logger.info('Graceful shutdown initiated');

  try {
    // Stop accepting new requests
    requestThrottlingService.shutdown();
    circuitBreakerService.stopMonitoring();
    gracefulDegradationService.shutdown();

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    process.exit(1);
  }
}