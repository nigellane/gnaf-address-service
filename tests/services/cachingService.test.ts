/**
 * Caching Service Unit Tests
 * Tests for multi-tier caching functionality
 */

import { CachingService } from '../../src/services/cachingService';
import { redisManager } from '../../src/config/redis';

// Mock Redis manager
jest.mock('../../src/config/redis', () => ({
  redisManager: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    flushPattern: jest.fn(),
    healthCheck: jest.fn(),
    getMetrics: jest.fn(),
    getCacheHitRatio: jest.fn()
  }
}));

// Mock database manager
jest.mock('../../src/config/database', () => ({
  DatabaseManager: {
    getInstance: jest.fn(() => ({}))
  }
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    createServiceLogger: jest.fn(() => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }))
  }
}));

const mockRedisManager = redisManager as jest.Mocked<typeof redisManager>;

describe('CachingService', () => {
  let cachingService: CachingService;

  beforeEach(() => {
    jest.clearAllMocks();
    cachingService = new CachingService();
    
    // Mock Redis metrics
    mockRedisManager.getMetrics.mockReturnValue({
      connectionStatus: 'connected',
      totalConnections: 1,
      activeConnections: 1,
      commandsProcessed: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageResponseTime: 0,
      memoryUsage: 0
    });
  });

  describe('get', () => {
    it('should return data from L1 cache when available', async () => {
      const testKey = 'test:key';
      const testData = { id: 1, name: 'test' };
      
      // Store directly in L1 cache to simulate hit
      (cachingService as any).l1Cache.set(testKey, testData);
      
      const result = await cachingService.get(testKey);
      
      expect(result).toEqual(testData);
      expect(mockRedisManager.get).not.toHaveBeenCalled();
    });

    it('should fallback to L2 cache when L1 cache misses', async () => {
      const testKey = 'test:key';
      const testData = { id: 1, name: 'test' };
      
      mockRedisManager.get.mockResolvedValue(JSON.stringify(testData));
      
      const result = await cachingService.get(testKey);
      
      expect(result).toEqual(testData);
      expect(mockRedisManager.get).toHaveBeenCalledWith(testKey);
    });

    it('should return null when both L1 and L2 cache miss', async () => {
      const testKey = 'test:key';
      
      mockRedisManager.get.mockResolvedValue(null);
      
      const result = await cachingService.get(testKey);
      
      expect(result).toBeNull();
      expect(mockRedisManager.get).toHaveBeenCalledWith(testKey);
    });

    it('should handle Redis errors gracefully', async () => {
      const testKey = 'test:key';
      
      mockRedisManager.get.mockRejectedValue(new Error('Redis connection failed'));
      
      const result = await cachingService.get(testKey);
      
      expect(result).toBeNull();
    });

    it('should skip L1 cache when skipL1 option is true', async () => {
      const testKey = 'test:key';
      const testData = { id: 1, name: 'test' };
      
      // Store in L1 cache
      (cachingService as any).l1Cache.set(testKey, testData);
      
      mockRedisManager.get.mockResolvedValue(JSON.stringify(testData));
      
      const result = await cachingService.get(testKey, { skipL1: true });
      
      expect(result).toEqual(testData);
      expect(mockRedisManager.get).toHaveBeenCalledWith(testKey);
    });
  });

  describe('set', () => {
    it('should set data in both L1 and L2 caches', async () => {
      const testKey = 'test:key';
      const testData = { id: 1, name: 'test' };
      const ttl = 300;
      
      mockRedisManager.set.mockResolvedValue(true);
      
      const result = await cachingService.set(testKey, testData, { ttl });
      
      expect(result).toBe(true);
      expect(mockRedisManager.set).toHaveBeenCalledWith(
        testKey, 
        JSON.stringify(testData), 
        ttl
      );
      
      // Verify L1 cache was set
      const l1Result = (cachingService as any).l1Cache.get(testKey);
      expect(l1Result).toEqual(testData);
    });

    it('should skip L1 cache when skipL1 option is true', async () => {
      const testKey = 'test:key';
      const testData = { id: 1, name: 'test' };
      
      mockRedisManager.set.mockResolvedValue(true);
      
      const result = await cachingService.set(testKey, testData, { skipL1: true });
      
      expect(result).toBe(true);
      expect(mockRedisManager.set).toHaveBeenCalled();
      
      // Verify L1 cache was not set
      const l1Result = (cachingService as any).l1Cache.get(testKey);
      expect(l1Result).toBeUndefined();
    });

    it('should return false when Redis set fails', async () => {
      const testKey = 'test:key';
      const testData = { id: 1, name: 'test' };
      
      mockRedisManager.set.mockResolvedValue(false);
      
      const result = await cachingService.set(testKey, testData);
      
      expect(result).toBe(false);
    });
  });

  describe('getOrSet', () => {
    it('should return cached data when available', async () => {
      const testKey = 'test:key';
      const testData = { id: 1, name: 'test' };
      const fetchFunction = jest.fn().mockResolvedValue({ id: 2, name: 'new' });
      
      // Store in L1 cache
      (cachingService as any).l1Cache.set(testKey, testData);
      
      const result = await cachingService.getOrSet(testKey, fetchFunction);
      
      expect(result).toEqual(testData);
      expect(fetchFunction).not.toHaveBeenCalled();
    });

    it('should execute fetch function when cache misses', async () => {
      const testKey = 'test:key';
      const newData = { id: 2, name: 'new' };
      const fetchFunction = jest.fn().mockResolvedValue(newData);
      
      mockRedisManager.get.mockResolvedValue(null);
      mockRedisManager.set.mockResolvedValue(true);
      
      const result = await cachingService.getOrSet(testKey, fetchFunction);
      
      expect(result).toEqual(newData);
      expect(fetchFunction).toHaveBeenCalled();
      expect(mockRedisManager.set).toHaveBeenCalledWith(
        testKey, 
        JSON.stringify(newData), 
        300 // default TTL
      );
    });

    it('should force refresh when forceRefresh option is true', async () => {
      const testKey = 'test:key';
      const cachedData = { id: 1, name: 'cached' };
      const newData = { id: 2, name: 'new' };
      const fetchFunction = jest.fn().mockResolvedValue(newData);
      
      // Store in L1 cache
      (cachingService as any).l1Cache.set(testKey, cachedData);
      mockRedisManager.set.mockResolvedValue(true);
      
      const result = await cachingService.getOrSet(testKey, fetchFunction, { forceRefresh: true });
      
      expect(result).toEqual(newData);
      expect(fetchFunction).toHaveBeenCalled();
    });

    it('should handle fetch function errors gracefully', async () => {
      const testKey = 'test:key';
      const fetchFunction = jest.fn().mockRejectedValue(new Error('Fetch failed'));
      
      mockRedisManager.get.mockResolvedValue(null);
      
      const result = await cachingService.getOrSet(testKey, fetchFunction);
      
      expect(result).toBeNull();
      expect(fetchFunction).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete from both L1 and L2 caches', async () => {
      const testKey = 'test:key';
      
      // Store in L1 cache
      (cachingService as any).l1Cache.set(testKey, { test: 'data' });
      mockRedisManager.del.mockResolvedValue(1);
      
      const result = await cachingService.delete(testKey);
      
      expect(result).toBe(true);
      expect(mockRedisManager.del).toHaveBeenCalledWith(testKey);
      
      // Verify L1 cache was deleted
      const l1Result = (cachingService as any).l1Cache.get(testKey);
      expect(l1Result).toBeUndefined();
    });

    it('should return false when Redis delete fails', async () => {
      const testKey = 'test:key';
      
      mockRedisManager.del.mockResolvedValue(0);
      
      const result = await cachingService.delete(testKey);
      
      expect(result).toBe(false);
    });
  });

  describe('deletePattern', () => {
    it('should delete matching keys from both cache layers', async () => {
      const pattern = 'test:*';
      
      // Mock L1 cache keys
      (cachingService as any).l1Cache.set('test:1', { data: 1 });
      (cachingService as any).l1Cache.set('test:2', { data: 2 });
      (cachingService as any).l1Cache.set('other:3', { data: 3 });
      
      mockRedisManager.flushPattern.mockResolvedValue(5);
      
      const result = await cachingService.deletePattern(pattern);
      
      expect(result).toBe(7); // 2 from L1 + 5 from L2
      expect(mockRedisManager.flushPattern).toHaveBeenCalledWith(pattern);
      
      // Verify L1 pattern deletion
      expect((cachingService as any).l1Cache.get('test:1')).toBeUndefined();
      expect((cachingService as any).l1Cache.get('test:2')).toBeUndefined();
      expect((cachingService as any).l1Cache.get('other:3')).toBeDefined();
    });
  });

  describe('warmUp', () => {
    it('should warm up cache with provided queries', async () => {
      const queries = [
        { key: 'warm:1', fetchFunction: jest.fn().mockResolvedValue({ data: 1 }) },
        { key: 'warm:2', fetchFunction: jest.fn().mockResolvedValue({ data: 2 }) },
        { key: 'warm:3', fetchFunction: jest.fn().mockResolvedValue(null) }
      ];
      
      mockRedisManager.set.mockResolvedValue(true);
      
      const result = await cachingService.warmUp(queries);
      
      expect(result).toBe(2); // Only 2 successful, 1 returned null
      expect(queries[0]!.fetchFunction).toHaveBeenCalled();
      expect(queries[1]!.fetchFunction).toHaveBeenCalled();
      expect(queries[2]!.fetchFunction).toHaveBeenCalled();
      expect(mockRedisManager.set).toHaveBeenCalledTimes(2);
    });

    it('should handle warm up query errors gracefully', async () => {
      const queries = [
        { key: 'warm:1', fetchFunction: jest.fn().mockResolvedValue({ data: 1 }) },
        { key: 'warm:2', fetchFunction: jest.fn().mockRejectedValue(new Error('Fetch failed')) }
      ];
      
      mockRedisManager.set.mockResolvedValue(true);
      
      const result = await cachingService.warmUp(queries);
      
      expect(result).toBe(1); // Only 1 successful
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when Redis is available', async () => {
      mockRedisManager.healthCheck.mockResolvedValue({
        status: 'healthy',
        metrics: {
          connectionStatus: 'connected',
          totalConnections: 1,
          activeConnections: 1,
          commandsProcessed: 10,
          cacheHits: 8,
          cacheMisses: 2,
          averageResponseTime: 5,
          memoryUsage: 1024
        }
      });
      
      mockRedisManager.getCacheHitRatio.mockReturnValue(0.8);
      
      const result = await cachingService.healthCheck();
      
      expect(result.status).toBe('healthy');
      expect(result.details.l2.status).toBe('healthy');
      expect(result.details.l2.hitRate).toBe(0.8);
    });

    it('should return degraded status when Redis is unhealthy', async () => {
      mockRedisManager.healthCheck.mockResolvedValue({
        status: 'unhealthy',
        metrics: {
          connectionStatus: 'disconnected',
          totalConnections: 0,
          activeConnections: 0,
          commandsProcessed: 0,
          cacheHits: 0,
          cacheMisses: 0,
          averageResponseTime: 0,
          memoryUsage: 0
        }
      });
      
      const result = await cachingService.healthCheck();
      
      expect(result.status).toBe('degraded');
      expect(result.details.l2.status).toBe('unhealthy');
    });
  });

  describe('clear', () => {
    it('should clear all cache layers', async () => {
      // Add some data to L1
      (cachingService as any).l1Cache.set('test:1', { data: 1 });
      (cachingService as any).l1Cache.set('test:2', { data: 2 });
      
      mockRedisManager.flushPattern.mockResolvedValue(10);
      
      await cachingService.clear();
      
      expect(mockRedisManager.flushPattern).toHaveBeenCalledWith('*');
      
      // Verify L1 cache was cleared
      expect((cachingService as any).l1Cache.keys()).toHaveLength(0);
    });
  });
});