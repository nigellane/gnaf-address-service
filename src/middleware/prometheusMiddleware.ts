/**
 * Prometheus Metrics Collection Middleware
 * Automatically records HTTP request metrics and integrates with performance monitoring
 */

import { Request, Response, NextFunction } from 'express';
import { prometheusMetrics } from '../services/prometheusMetrics';
import { performanceMonitoringService } from '../services/performanceMonitoringService';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('PrometheusMiddleware');

interface MetricRequest extends Request {
  startTime?: number;
  routePattern?: string;
}

/**
 * Middleware to track request start time and route pattern
 */
export const requestTrackingMiddleware = (req: MetricRequest, res: Response, next: NextFunction): void => {
  req.startTime = Date.now();
  
  // Determine route pattern for consistent labeling
  req.routePattern = getRoutePattern(req.path);
  
  next();
};

/**
 * Middleware to record metrics after response is sent
 */
export const metricsRecordingMiddleware = (req: MetricRequest, res: Response, next: NextFunction): void => {
  // Override res.end to capture metrics when response is sent
  const originalEnd = res.end;
  const originalJson = res.json;
  
  let responseSize = 0;
  
  // Track response size
  res.json = function(obj?: any): Response {
    if (obj) {
      responseSize = Buffer.byteLength(JSON.stringify(obj), 'utf8');
    }
    return (originalJson as any).apply(this, [obj]);
  };
  
  res.end = function(chunk?: any, encoding?: string | (() => void), cb?: (() => void) | string): Response {
    if (chunk && !responseSize) {
      responseSize = Buffer.byteLength(chunk.toString(), 'utf8');
    }
    
    // Record metrics
    recordRequestMetrics(req, res, responseSize);
    
    // Call original end method
    return (originalEnd as any).apply(this, arguments);
  };
  
  next();
};

/**
 * Record comprehensive request metrics
 */
function recordRequestMetrics(req: MetricRequest, res: Response, responseSize: number): void {
  if (!req.startTime || !req.routePattern) {
    return; // Skip if tracking data is missing
  }
  
  const duration = Date.now() - req.startTime;
  const method = req.method;
  const statusCode = res.statusCode;
  const routePattern = req.routePattern;
  
  try {
    // Determine endpoint type
    const endpointType = getEndpointType(req.path);
    
    // Record Prometheus metrics
    prometheusMetrics.recordHttpRequest(
      method,
      routePattern,
      statusCode,
      duration,
      responseSize,
      endpointType
    );
    
    // Also record in performance monitoring service for compatibility
    performanceMonitoringService.recordMetrics({
      endpoint: routePattern,
      method,
      responseTime: duration,
      statusCode,
      cacheHit: res.getHeader('X-Cache-Hit') === 'true' || false,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 // MB
    });
    
    // Log slow requests
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        method,
        path: req.path,
        routePattern,
        duration: `${duration}ms`,
        statusCode
      });
    }
    
  } catch (error) {
    logger.error('Failed to record request metrics', {
      error: error instanceof Error ? error.message : 'Unknown error',
      method,
      path: req.path,
      statusCode
    });
  }
}

/**
 * Normalize route patterns for consistent labeling
 */
function getRoutePattern(path: string): string {
  // Health endpoints
  if (path.startsWith('/api/v1/health')) {
    if (path === '/api/v1/health') return '/api/v1/health';
    if (path === '/api/v1/health/detailed') return '/api/v1/health/detailed';
    if (path === '/api/v1/health/ready') return '/api/v1/health/ready';
    if (path === '/api/v1/health/live') return '/api/v1/health/live';
    if (path === '/api/v1/health/metrics') return '/api/v1/health/metrics';
    return '/api/v1/health/*';
  }
  
  // Address endpoints
  if (path.startsWith('/api/v1/addresses')) {
    if (path === '/api/v1/addresses/search') return '/api/v1/addresses/search';
    if (path === '/api/v1/addresses/validate') return '/api/v1/addresses/validate';
    if (path === '/api/v1/addresses/geocode') return '/api/v1/addresses/geocode';
    if (path === '/api/v1/addresses/reverse-geocode') return '/api/v1/addresses/reverse-geocode';
    if (path === '/api/v1/addresses/batch-validate') return '/api/v1/addresses/batch-validate';
    if (path.match(/\/api\/v1\/addresses\/[A-Z0-9]+$/)) return '/api/v1/addresses/:gnaf_pid';
    return '/api/v1/addresses/*';
  }
  
  // Spatial endpoints
  if (path.startsWith('/api/v1/spatial')) {
    if (path === '/api/v1/spatial/proximity') return '/api/v1/spatial/proximity';
    if (path === '/api/v1/spatial/boundaries') return '/api/v1/spatial/boundaries';
    if (path === '/api/v1/spatial/statistics') return '/api/v1/spatial/statistics';
    if (path === '/api/v1/spatial/coverage') return '/api/v1/spatial/coverage';
    return '/api/v1/spatial/*';
  }
  
  // Admin endpoints
  if (path.startsWith('/api/v1/admin')) {
    if (path === '/api/v1/admin/status') return '/api/v1/admin/status';
    if (path === '/api/v1/admin/cache/warm') return '/api/v1/admin/cache/warm';
    if (path === '/api/v1/admin/cache/clear') return '/api/v1/admin/cache/clear';
    if (path === '/api/v1/admin/dataset') return '/api/v1/admin/dataset';
    if (path === '/api/v1/admin/dataset-refresh') return '/api/v1/admin/dataset-refresh';
    return '/api/v1/admin/*';
  }
  
  // API documentation
  if (path.startsWith('/api/docs')) return '/api/docs';
  
  // Default fallback
  return path;
}

/**
 * Determine endpoint type for categorization
 */
function getEndpointType(path: string): 'api' | 'health' | 'admin' {
  if (path.startsWith('/api/v1/health')) return 'health';
  if (path.startsWith('/api/v1/admin')) return 'admin';
  return 'api';
}

/**
 * Express route handler for Prometheus metrics endpoint
 */
export const prometheusMetricsHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await prometheusMetrics.getMetrics();
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (error) {
    logger.error('Failed to generate Prometheus metrics', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    res.status(500).json({
      error: 'Failed to generate metrics',
      timestamp: new Date().toISOString()
    });
  }
};