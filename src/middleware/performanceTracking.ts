/**
 * Performance Tracking Middleware
 * Tracks request/response metrics and integrates with performance monitoring
 */

import { Request, Response, NextFunction } from 'express';
import { performanceMonitoringService } from '../services/performanceMonitoringService';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('PerformanceTracking');

export interface RequestMetrics {
  startTime: number;
  dbQueryCount: number;
  dbQueryTime: number;
  cacheHit: boolean;
}

/**
 * Performance tracking middleware
 */
export function performanceTracker() {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    // Initialize request metrics
    const metrics: RequestMetrics = {
      startTime,
      dbQueryCount: 0,
      dbQueryTime: 0,
      cacheHit: false
    };
    
    // Attach metrics to request for other middleware/handlers to update
    (req as any).metrics = metrics;
    
    // Generate request ID if not exists
    const requestId = req.headers['x-request-id'] || `req_${startTime}_${Math.random().toString(36).substring(2, 15)}`;
    req.headers['x-request-id'] = requestId as string;
    
    // Override res.end to capture final metrics
    const originalEnd = res.end;
    const originalJson = res.json;
    
    let responseEnded = false;
    
    const captureMetrics = () => {
      if (responseEnded) return;
      responseEnded = true;
      
      const responseTime = Date.now() - startTime;
      
      // Extract cache hit information from headers
      const cacheStatus = res.get('X-Cache');
      const cacheHit = cacheStatus === 'HIT';
      
      // Record performance metrics
      performanceMonitoringService.recordMetrics({
        endpoint: `${req.method} ${req.route?.path || req.path}`,
        method: req.method,
        responseTime,
        statusCode: res.statusCode,
        cacheHit,
        dbQueryTime: metrics.dbQueryTime,
        dbQueryCount: metrics.dbQueryCount
      });
      
      // Add performance headers
      res.set('X-Response-Time', `${responseTime}ms`);
      res.set('X-Request-ID', requestId as string);
      
      logger.debug('Request completed', {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        responseTime: `${responseTime}ms`,
        cacheHit,
        dbQueries: metrics.dbQueryCount,
        dbTime: `${metrics.dbQueryTime}ms`
      });
    };
    
    // Override response methods
    res.end = function(this: Response, ...args: any[]) {
      captureMetrics();
      return (originalEnd as any).apply(this, args);
    };
    
    res.json = function(this: Response, body?: any) {
      const result = originalJson.call(this, body);
      captureMetrics();
      return result;
    };
    
    next();
  };
}

/**
 * Database query tracking decorator for database managers
 */
export function trackDatabaseQuery<T extends (...args: any[]) => Promise<any>>(
  originalMethod: T,
  context: any
): T {
  return (async function(this: any, ...args: any[]) {
    const startTime = Date.now();
    
    try {
      const result = await originalMethod.apply(this, args);
      const queryTime = Date.now() - startTime;
      
      // Update request metrics if available
      const req = getCurrentRequest();
      if (req && (req as any).metrics) {
        const metrics = (req as any).metrics as RequestMetrics;
        metrics.dbQueryCount++;
        metrics.dbQueryTime += queryTime;
      }
      
      // Log slow queries
      if (queryTime > 1000) {
        logger.warn('Slow database query detected', {
          queryTime: `${queryTime}ms`,
          query: typeof args[0] === 'string' ? args[0].substring(0, 100) : 'Unknown'
        });
      }
      
      return result;
    } catch (error) {
      const queryTime = Date.now() - startTime;
      
      logger.error('Database query failed', {
        queryTime: `${queryTime}ms`,
        error: error instanceof Error ? error.message : 'Unknown error',
        query: typeof args[0] === 'string' ? args[0].substring(0, 100) : 'Unknown'
      });
      
      throw error;
    }
  }) as T;
}

/**
 * Cache operation tracking for cache services
 */
export function trackCacheOperation(operationType: 'get' | 'set' | 'delete') {
  return function<T extends (...args: any[]) => Promise<any>>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ) {
    const originalMethod = descriptor.value;
    
    if (!originalMethod) return descriptor;
    
    descriptor.value = (async function(this: any, ...args: any[]) {
      const startTime = Date.now();
      const key = args[0]; // First argument is typically the cache key
      
      try {
        const result = await originalMethod.apply(this, args);
        const operationTime = Date.now() - startTime;
        
        // Update request metrics for cache hits
        if (operationType === 'get' && result !== null && result !== undefined) {
          const req = getCurrentRequest();
          if (req && (req as any).metrics) {
            (req as any).metrics.cacheHit = true;
          }
        }
        
        logger.debug('Cache operation completed', {
          operation: operationType,
          key: typeof key === 'string' ? key.substring(0, 50) : 'Unknown',
          hit: operationType === 'get' ? result !== null : undefined,
          operationTime: `${operationTime}ms`
        });
        
        return result;
      } catch (error) {
        const operationTime = Date.now() - startTime;
        
        logger.error('Cache operation failed', {
          operation: operationType,
          key: typeof key === 'string' ? key.substring(0, 50) : 'Unknown',
          operationTime: `${operationTime}ms`,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        throw error;
      }
    }) as T;
    
    return descriptor;
  };
}

/**
 * Performance timing utility for manual instrumentation
 */
export class PerformanceTimer {
  private startTime: number;
  private name: string;
  
  constructor(name: string) {
    this.name = name;
    this.startTime = Date.now();
  }
  
  end(): number {
    const duration = Date.now() - this.startTime;
    
    logger.debug('Performance timer completed', {
      name: this.name,
      duration: `${duration}ms`
    });
    
    return duration;
  }
  
  static time<T>(name: string, fn: () => T | Promise<T>): T | Promise<T> {
    const timer = new PerformanceTimer(name);
    
    try {
      const result = fn();
      
      if (result instanceof Promise) {
        return result.finally(() => timer.end());
      } else {
        timer.end();
        return result;
      }
    } catch (error) {
      timer.end();
      throw error;
    }
  }
}

/**
 * Get current request from async local storage (simplified version)
 * In production, you might want to use AsyncLocalStorage for proper context tracking
 */
function getCurrentRequest(): Request | null {
  // This is a simplified implementation
  // In a real application, you'd use AsyncLocalStorage or similar
  // to track the current request context across async operations
  return null;
}

/**
 * Response time tracking for specific operations
 */
export function trackOperationTime(operationName: string) {
  return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args: any[]) {
      const startTime = Date.now();
      
      try {
        const result = await originalMethod.apply(this, args);
        const operationTime = Date.now() - startTime;
        
        logger.info('Operation completed', {
          operation: operationName,
          operationTime: `${operationTime}ms`,
          success: true
        });
        
        return result;
      } catch (error) {
        const operationTime = Date.now() - startTime;
        
        logger.error('Operation failed', {
          operation: operationName,
          operationTime: `${operationTime}ms`,
          error: error instanceof Error ? error.message : 'Unknown error',
          success: false
        });
        
        throw error;
      }
    };
    
    return descriptor;
  };
}

/**
 * Memory usage tracking middleware
 */
export function memoryTracker() {
  return (req: Request, res: Response, next: NextFunction) => {
    const memoryBefore = process.memoryUsage();
    
    const originalEnd = res.end;
    res.end = function(this: Response, ...args: any[]) {
      const memoryAfter = process.memoryUsage();
      const memoryDiff = memoryAfter.heapUsed - memoryBefore.heapUsed;
      
      if (memoryDiff > 10 * 1024 * 1024) { // Log if memory increased by more than 10MB
        logger.warn('High memory usage detected', {
          requestId: req.headers['x-request-id'],
          path: req.path,
          method: req.method,
          memoryIncrease: `${Math.round(memoryDiff / 1024 / 1024 * 100) / 100}MB`,
          totalHeap: `${Math.round(memoryAfter.heapUsed / 1024 / 1024 * 100) / 100}MB`
        });
      }
      
      return (originalEnd as any).apply(this, args);
    };
    
    next();
  };
}

/**
 * Request size tracking
 */
export function requestSizeTracker() {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestSize = req.get('content-length');
    
    if (requestSize && parseInt(requestSize) > 1024 * 1024) { // > 1MB
      logger.warn('Large request detected', {
        requestId: req.headers['x-request-id'],
        path: req.path,
        method: req.method,
        size: `${Math.round(parseInt(requestSize) / 1024 / 1024 * 100) / 100}MB`
      });
    }
    
    next();
  };
}