/**
 * Multi-Tier Caching Service
 * Manages L1 (memory), L2 (Redis), and L3 (database) cache layers
 */

import NodeCache from 'node-cache';
import { redisManager, RedisManager } from '../config/redis';
import { DatabaseManager } from '../config/database';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('CachingService');

export interface CacheOptions {
  ttl?: number;
  skipL1?: boolean;
  skipL2?: boolean;
  skipL3?: boolean;
  forceRefresh?: boolean;
}

export interface CacheMetrics {
  l1: {
    hits: number;
    misses: number;
    keys: number;
    memoryUsage: number;
  };
  l2: {
    hits: number;
    misses: number;
    connectionStatus: string;
    averageResponseTime: number;
  };
  l3: {
    hits: number;
    misses: number;
    queryTime: number;
  };
  overall: {
    totalRequests: number;
    hitRatio: number;
    averageLatency: number;
  };
}

export class CachingService {
  private static instance: CachingService;
  private l1Cache: NodeCache;
  private l2Cache: RedisManager;
  private db: DatabaseManager;
  private metrics: CacheMetrics;
  private readonly DEFAULT_TTL = 300; // 5 minutes
  private readonly L1_MAX_KEYS = 10000;

  constructor() {
    // L1 Cache - In-memory LRU cache
    this.l1Cache = new NodeCache({
      stdTTL: this.DEFAULT_TTL,
      maxKeys: this.L1_MAX_KEYS,
      useClones: false,
      deleteOnExpire: true,
      checkperiod: 60 // Check for expired keys every 60 seconds
    });

    // L2 Cache - Redis
    this.l2Cache = redisManager;

    // L3 Cache - Database with query caching
    this.db = DatabaseManager.getInstance();

    this.metrics = {
      l1: { hits: 0, misses: 0, keys: 0, memoryUsage: 0 },
      l2: { hits: 0, misses: 0, connectionStatus: 'disconnected', averageResponseTime: 0 },
      l3: { hits: 0, misses: 0, queryTime: 0 },
      overall: { totalRequests: 0, hitRatio: 0, averageLatency: 0 }
    };

    this.setupL1CacheEvents();
    this.startMetricsCollection();
  }

  static getInstance(): CachingService {
    if (!this.instance) {
      this.instance = new CachingService();
    }
    return this.instance;
  }

  private setupL1CacheEvents(): void {
    this.l1Cache.on('set', (key, value) => {
      logger.debug('L1 cache set', { key });
    });

    this.l1Cache.on('del', (key, value) => {
      logger.debug('L1 cache delete', { key });
    });

    this.l1Cache.on('expired', (key, value) => {
      logger.debug('L1 cache expired', { key });
    });
  }

  private startMetricsCollection(): void {
    setInterval(() => {
      this.updateMetrics();
    }, 30000); // Update metrics every 30 seconds
  }

  private updateMetrics(): void {
    // L1 metrics
    const l1Stats = this.l1Cache.getStats();
    this.metrics.l1.keys = l1Stats.keys;
    this.metrics.l1.hits = l1Stats.hits;
    this.metrics.l1.misses = l1Stats.misses;

    // L2 metrics
    const l2Stats = this.l2Cache.getMetrics();
    this.metrics.l2.hits = l2Stats.cacheHits;
    this.metrics.l2.misses = l2Stats.cacheMisses;
    this.metrics.l2.connectionStatus = l2Stats.connectionStatus;
    this.metrics.l2.averageResponseTime = l2Stats.averageResponseTime;

    // Overall metrics
    const totalHits = this.metrics.l1.hits + this.metrics.l2.hits + this.metrics.l3.hits;
    const totalMisses = this.metrics.l1.misses + this.metrics.l2.misses + this.metrics.l3.misses;
    this.metrics.overall.totalRequests = totalHits + totalMisses;
    this.metrics.overall.hitRatio = this.metrics.overall.totalRequests > 0 
      ? totalHits / this.metrics.overall.totalRequests 
      : 0;
  }

  /**
   * Get data from cache layers with automatic fallback
   */
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    const startTime = Date.now();
    this.metrics.overall.totalRequests++;

    try {
      // L1 Cache check
      if (!options.skipL1) {
        const l1Result = this.l1Cache.get<T>(key);
        if (l1Result !== undefined) {
          this.metrics.l1.hits++;
          logger.debug('Cache hit L1', { key, latency: Date.now() - startTime });
          return l1Result;
        }
        this.metrics.l1.misses++;
      }

      // L2 Cache check
      if (!options.skipL2) {
        const l2Result = await this.l2Cache.get(key);
        if (l2Result) {
          const parsedResult = JSON.parse(l2Result);
          // Populate L1 cache with L2 result
          if (!options.skipL1) {
            this.l1Cache.set(key, parsedResult, options.ttl || this.DEFAULT_TTL);
          }
          this.metrics.l2.hits++;
          logger.debug('Cache hit L2', { key, latency: Date.now() - startTime });
          return parsedResult;
        }
        this.metrics.l2.misses++;
      }

      logger.debug('Cache miss all layers', { key, latency: Date.now() - startTime });
      return null;

    } catch (error) {
      logger.error('Cache get error', { key, error: error instanceof Error ? error.message : 'Unknown error' });
      return null;
    } finally {
      this.metrics.overall.averageLatency = 
        (this.metrics.overall.averageLatency + (Date.now() - startTime)) / 2;
    }
  }

  /**
   * Set data in cache layers
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<boolean> {
    const ttl = options.ttl || this.DEFAULT_TTL;
    let success = true;

    try {
      // Set in L1 cache
      if (!options.skipL1) {
        this.l1Cache.set(key, value, ttl);
        logger.debug('Set L1 cache', { key, ttl });
      }

      // Set in L2 cache
      if (!options.skipL2) {
        const serialized = JSON.stringify(value);
        const l2Success = await this.l2Cache.set(key, serialized, ttl);
        if (!l2Success) {
          logger.warn('Failed to set L2 cache', { key });
          success = false;
        } else {
          logger.debug('Set L2 cache', { key, ttl });
        }
      }

      return success;
    } catch (error) {
      logger.error('Cache set error', { key, error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    }
  }

  /**
   * Get or set pattern - retrieve from cache or execute function and cache result
   */
  async getOrSet<T>(
    key: string, 
    fetchFunction: () => Promise<T>, 
    options: CacheOptions = {}
  ): Promise<T | null> {
    // Check cache first unless force refresh is requested
    if (!options.forceRefresh) {
      const cached = await this.get<T>(key, options);
      if (cached !== null) {
        return cached;
      }
    }

    try {
      // Execute fetch function
      const result = await fetchFunction();
      
      if (result !== null && result !== undefined) {
        // Cache the result
        await this.set(key, result, options);
        return result;
      }

      return null;
    } catch (error) {
      logger.error('Cache getOrSet fetchFunction error', { 
        key, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return null;
    }
  }

  /**
   * Delete from all cache layers
   */
  async delete(key: string): Promise<boolean> {
    let success = true;

    try {
      // Delete from L1
      this.l1Cache.del(key);

      // Delete from L2
      const l2Result = await this.l2Cache.del(key);
      if (l2Result === 0) {
        success = false;
      }

      logger.debug('Cache delete', { key, success });
      return success;
    } catch (error) {
      logger.error('Cache delete error', { key, error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    }
  }

  /**
   * Delete multiple keys with pattern matching
   */
  async deletePattern(pattern: string): Promise<number> {
    let deletedCount = 0;

    try {
      // Clear L1 cache keys matching pattern
      const l1Keys = this.l1Cache.keys().filter(key => key.includes(pattern.replace('*', '')));
      this.l1Cache.del(l1Keys);
      deletedCount += l1Keys.length;

      // Clear L2 cache keys matching pattern
      const l2DeletedCount = await this.l2Cache.flushPattern(pattern);
      deletedCount += l2DeletedCount;

      logger.info('Cache pattern delete', { pattern, deletedCount });
      return deletedCount;
    } catch (error) {
      logger.error('Cache pattern delete error', { 
        pattern, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return deletedCount;
    }
  }

  /**
   * Warm up cache with common queries
   */
  async warmUp(queries: Array<{ key: string; fetchFunction: () => Promise<any>; ttl?: number }>): Promise<number> {
    let warmedCount = 0;

    logger.info('Starting cache warm-up', { queryCount: queries.length });

    for (const query of queries) {
      try {
        const result = await query.fetchFunction();
        if (result !== null) {
          await this.set(query.key, result, { ttl: query.ttl });
          warmedCount++;
        }
      } catch (error) {
        logger.warn('Cache warm-up query failed', { 
          key: query.key, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }

    logger.info('Cache warm-up completed', { warmedCount, totalQueries: queries.length });
    return warmedCount;
  }

  /**
   * Clear all cache layers
   */
  async clear(): Promise<void> {
    try {
      this.l1Cache.flushAll();
      await this.l2Cache.flushPattern('*');
      logger.info('All cache layers cleared');
    } catch (error) {
      logger.error('Cache clear error', { error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  /**
   * Get comprehensive cache metrics
   */
  getMetrics(): CacheMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get cache health status
   */
  async healthCheck(): Promise<{ status: string; details: any }> {
    try {
      const l1Stats = this.l1Cache.getStats();
      const l2Health = await this.l2Cache.healthCheck();
      
      const isHealthy = l2Health.status === 'healthy';

      return {
        status: isHealthy ? 'healthy' : 'degraded',
        details: {
          l1: {
            status: 'healthy',
            keys: l1Stats.keys,
            hitRate: l1Stats.hits / (l1Stats.hits + l1Stats.misses) || 0
          },
          l2: {
            status: l2Health.status,
            hitRate: this.l2Cache.getCacheHitRatio(),
            connectionStatus: l2Health.metrics.connectionStatus
          },
          overall: {
            hitRatio: this.metrics.overall.hitRatio,
            averageLatency: this.metrics.overall.averageLatency
          }
        }
      };
    } catch (error) {
      logger.error('Cache health check error', { error: error instanceof Error ? error.message : 'Unknown error' });
      return {
        status: 'unhealthy',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      };
    }
  }
}

export const cachingService = CachingService.getInstance();