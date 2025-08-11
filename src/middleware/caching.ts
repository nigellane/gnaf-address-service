/**
 * HTTP Response Caching Middleware
 * Provides intelligent caching for API responses
 */

import { Request, Response, NextFunction } from 'express';
import { cachingService } from '../services/cachingService';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('CachingMiddleware');

export interface CachingConfig {
  ttl?: number;
  skipCache?: boolean;
  cacheKey?: (req: Request) => string;
  shouldCache?: (req: Request, res: Response) => boolean;
  vary?: string[];
}

/**
 * Default cache key generator
 */
function defaultCacheKey(req: Request): string {
  const method = req.method;
  const path = req.path;
  const query = JSON.stringify(req.query);
  const body = req.method === 'POST' ? JSON.stringify(req.body) : '';
  
  return `http:${method}:${path}:${Buffer.from(query + body).toString('base64')}`;
}

/**
 * Default cache condition checker
 */
function defaultShouldCache(req: Request, res: Response): boolean {
  // Cache successful GET requests by default
  if (req.method === 'GET' && res.statusCode >= 200 && res.statusCode < 300) {
    return true;
  }
  
  // Cache successful POST requests for search/validation endpoints
  if (req.method === 'POST' && res.statusCode === 200) {
    const path = req.path;
    return path.includes('/search') || 
           path.includes('/validate') || 
           path.includes('/geocode') ||
           path.includes('/spatial');
  }
  
  return false;
}

/**
 * Response caching middleware factory
 */
export function responseCache(config: CachingConfig = {}): (req: Request, res: Response, next: NextFunction) => void {
  const {
    ttl = 300, // 5 minutes default
    skipCache = false,
    cacheKey = defaultCacheKey,
    shouldCache = defaultShouldCache,
    vary = []
  } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (skipCache) {
      return next();
    }

    const key = cacheKey(req);
    const startTime = Date.now();

    try {
      // Check for cached response
      const cached = await cachingService.get(key);
      if (cached) {
        const { statusCode, headers, body, timestamp } = cached as any;
        
        // Set cached headers
        Object.entries(headers).forEach(([name, value]) => {
          res.set(name, value as string);
        });

        // Add cache headers
        res.set('X-Cache', 'HIT');
        res.set('X-Cache-Key', key);
        res.set('X-Cache-Age', String(Math.floor((Date.now() - timestamp) / 1000)));
        res.set('Cache-Control', `max-age=${ttl}`);

        // Add Vary headers
        if (vary.length > 0) {
          vary.forEach(header => res.vary(header));
        }

        logger.debug('Cache hit for HTTP response', { 
          key, 
          method: req.method, 
          path: req.path,
          responseTime: Date.now() - startTime 
        });

        return res.status(statusCode).json(body);
      }

      // No cache hit, proceed with request
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);

      // Override response methods to capture response data
      res.json = function(data: any) {
        if (shouldCache(req, res)) {
          cacheResponse(key, res.statusCode, res.getHeaders(), data, ttl);
        }
        
        // Add cache headers
        res.set('X-Cache', 'MISS');
        res.set('X-Cache-Key', key);
        res.set('Cache-Control', `max-age=${ttl}`);

        // Add Vary headers
        if (vary.length > 0) {
          vary.forEach(header => res.vary(header));
        }

        return originalJson(data);
      };

      res.send = function(data: any) {
        if (shouldCache(req, res) && typeof data === 'string') {
          try {
            const jsonData = JSON.parse(data);
            cacheResponse(key, res.statusCode, res.getHeaders(), jsonData, ttl);
          } catch (error) {
            // Not JSON, cache as string
            cacheResponse(key, res.statusCode, res.getHeaders(), data, ttl);
          }
        }

        // Add cache headers
        res.set('X-Cache', 'MISS');
        res.set('X-Cache-Key', key);
        res.set('Cache-Control', `max-age=${ttl}`);

        // Add Vary headers
        if (vary.length > 0) {
          vary.forEach(header => res.vary(header));
        }

        return originalSend(data);
      };

      next();

    } catch (error) {
      logger.error('Response caching middleware error', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      next();
    }
  };
}

/**
 * Cache the response data
 */
async function cacheResponse(key: string, statusCode: number, headers: any, body: any, ttl: number): Promise<void> {
  try {
    const cacheData = {
      statusCode,
      headers: sanitizeHeaders(headers),
      body,
      timestamp: Date.now()
    };

    await cachingService.set(key, cacheData, { ttl });
    
    logger.debug('Response cached', { 
      key, 
      statusCode, 
      ttl,
      bodySize: JSON.stringify(body).length 
    });
  } catch (error) {
    logger.error('Failed to cache response', { 
      key, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}

/**
 * Sanitize headers for caching (remove non-cacheable headers)
 */
function sanitizeHeaders(headers: any): any {
  const sanitized = { ...headers };
  
  // Remove headers that shouldn't be cached
  delete sanitized['set-cookie'];
  delete sanitized['authorization'];
  delete sanitized['x-request-id'];
  delete sanitized['x-response-time'];
  delete sanitized['date'];
  delete sanitized['server'];
  delete sanitized['connection'];
  
  return sanitized;
}

/**
 * Cache invalidation middleware for write operations
 */
export function cacheInvalidation(patterns: string[] = []): (req: Request, res: Response, next: NextFunction) => void {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Store original response methods
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    // Override to invalidate cache after successful writes
    res.json = function(data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        invalidateCache(req, patterns);
      }
      return originalJson(data);
    };

    res.send = function(data: any) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        invalidateCache(req, patterns);
      }
      return originalSend(data);
    };

    next();
  };
}

/**
 * Invalidate cache patterns
 */
async function invalidateCache(req: Request, patterns: string[]): Promise<void> {
  try {
    const defaultPatterns = [
      'http:GET:*', // Invalidate all GET requests
      `http:*:${req.baseUrl}*` // Invalidate all requests to the same base URL
    ];

    const allPatterns = [...defaultPatterns, ...patterns];
    
    for (const pattern of allPatterns) {
      const deletedCount = await cachingService.deletePattern(pattern);
      if (deletedCount > 0) {
        logger.info('Cache invalidated', { pattern, deletedCount });
      }
    }
  } catch (error) {
    logger.error('Cache invalidation error', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
}

/**
 * ETags middleware for conditional requests
 */
export function etags(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function(data: any) {
      // Generate ETag from response data
      const etag = `"${Buffer.from(JSON.stringify(data)).toString('base64').slice(0, 32)}"`;
      res.set('ETag', etag);

      // Check If-None-Match header
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === etag) {
        return res.status(304).end();
      }

      return originalJson(data);
    };

    next();
  };
}

/**
 * Conditional caching based on request headers
 */
export function conditionalCache(config: CachingConfig = {}): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip cache if client requests fresh data
    const cacheControl = req.headers['cache-control'];
    const skipCache = cacheControl?.includes('no-cache') || 
                     cacheControl?.includes('max-age=0') ||
                     config.skipCache;

    return responseCache({ ...config, skipCache })(req, res, next);
  };
}