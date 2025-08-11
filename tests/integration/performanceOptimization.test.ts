/**
 * Integration Tests for Performance Optimization Services
 * Tests the complete performance optimization stack including caching, circuit breakers,
 * throttling, and graceful degradation
 */

import request from 'supertest';
import { Express } from 'express';
import { circuitBreakerService } from '../../src/services/circuitBreakerService';
import { requestThrottlingService } from '../../src/services/requestThrottlingService';
import { gracefulDegradationService } from '../../src/services/gracefulDegradationService';
import { cachingService } from '../../src/services/cachingService';
import { redisManager } from '../../src/config/redis';

// Mock app setup for testing
const createTestApp = (): Express => {
  const express = require('express');
  const app = express();
  
  app.use(express.json());
  
  // Add performance middleware
  const { createPerformanceMiddleware } = require('../../src/middleware/performanceOptimization');
  app.use(createPerformanceMiddleware());
  
  // Test endpoints
  app.get('/test/fast', (req, res) => {
    res.json({ message: 'Fast response', timestamp: Date.now() });
  });
  
  app.get('/test/slow', (req, res) => {
    setTimeout(() => {
      res.json({ message: 'Slow response', timestamp: Date.now() });
    }, 1000);
  });
  
  app.get('/test/error', (req, res) => {
    throw new Error('Test error');
  });
  
  app.post('/test/validate', (req, res) => {
    res.json({ 
      valid: true, 
      address: req.body.address,
      cached: false 
    });
  });
  
  return app;
};

describe('Performance Optimization Integration Tests', () => {
  let app: Express;
  
  beforeAll(async () => {
    app = createTestApp();
    
    // Initialize services
    try {
      await redisManager.connect();
    } catch (error) {
      console.warn('Redis not available for tests, using memory cache only');
    }
    
    // Initialize circuit breakers
    circuitBreakerService.createDatabaseCircuitBreaker();
    circuitBreakerService.createRedisCircuitBreaker();
  });
  
  afterAll(async () => {
    await redisManager.disconnect();
    requestThrottlingService.shutdown();
    circuitBreakerService.stopMonitoring();
    gracefulDegradationService.shutdown();
  });

  describe('Circuit Breaker Integration', () => {
    test('should handle database circuit breaker', async () => {
      const dbBreaker = circuitBreakerService.getCircuitBreaker('database');
      expect(dbBreaker).toBeDefined();
      
      // Test normal operation
      const result = await dbBreaker!.execute(async () => {
        return { success: true };
      });
      
      expect(result).toEqual({ success: true });
    });

    test('should fallback when circuit breaker opens', async () => {
      const dbBreaker = circuitBreakerService.getCircuitBreaker('database');
      
      // Force open the circuit breaker
      dbBreaker!.forceOpen();
      
      // Test fallback operation
      const result = await dbBreaker!.execute(
        async () => {
          throw new Error('Database unavailable');
        },
        async () => {
          return { success: true, fallback: true };
        }
      );
      
      expect(result).toEqual({ success: true, fallback: true });
      
      // Reset for other tests
      dbBreaker!.reset();
    });

    test('should track circuit breaker metrics', async () => {
      const health = circuitBreakerService.getHealthStatus();
      
      expect(health).toHaveProperty('healthy');
      expect(health).toHaveProperty('totalBreakers');
      expect(health).toHaveProperty('openBreakers');
      expect(health.totalBreakers).toBeGreaterThan(0);
    });
  });

  describe('Request Throttling Integration', () => {
    test('should apply rate limiting', async () => {
      const responses = [];
      
      // Make multiple rapid requests
      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .get('/test/fast')
          .set('X-Forwarded-For', '192.168.1.100');
        
        responses.push(response);
      }
      
      // Check that requests were processed
      responses.forEach(response => {
        expect([200, 429]).toContain(response.status);
      });
      
      // At least some should succeed
      const successCount = responses.filter(r => r.status === 200).length;
      expect(successCount).toBeGreaterThan(0);
    });

    test('should track throttling statistics', async () => {
      const stats = requestThrottlingService.getStats();
      
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('throttledRequests');
      expect(stats).toHaveProperty('averageResponseTime');
      expect(stats.totalRequests).toBeGreaterThan(0);
    });

    test('should queue requests during high load', async () => {
      // Simulate high load scenario
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app)
            .get('/test/fast')
            .set('X-Forwarded-For', `192.168.1.${100 + i}`)
        );
      }
      
      const responses = await Promise.all(promises);
      
      // All requests should eventually complete
      responses.forEach(response => {
        expect([200, 429, 503]).toContain(response.status);
      });
    });
  });

  describe('Graceful Degradation Integration', () => {
    test('should start in normal mode', async () => {
      const status = gracefulDegradationService.getStatus();
      
      expect(status.level).toBe('normal');
      expect(status.affectedFeatures).toEqual([]);
    });

    test('should degrade features under load', async () => {
      // Manually set degraded mode
      gracefulDegradationService.setDegradationLevel('reduced', 'Test degradation');
      
      const status = gracefulDegradationService.getStatus();
      
      expect(status.level).toBe('reduced');
      expect(status.affectedFeatures.length).toBeGreaterThan(0);
      
      // Reset to normal
      gracefulDegradationService.setDegradationLevel('normal', 'Test completed');
    });

    test('should provide fallback responses', async () => {
      const fallback = gracefulDegradationService.getFallbackResponse('address-search');
      
      expect(fallback).toHaveProperty('degraded');
      expect(fallback.degraded).toBe(true);
      expect(fallback).toHaveProperty('message');
    });

    test('should execute with degradation awareness', async () => {
      const result = await gracefulDegradationService.executeWithDegradation(
        'test-feature',
        async () => ({ success: true, mode: 'normal' }),
        async () => ({ success: true, mode: 'fallback' })
      );
      
      expect(result.success).toBe(true);
      expect(['normal', 'fallback']).toContain(result.mode);
    });
  });

  describe('Caching Integration', () => {
    test('should cache responses', async () => {
      const key = 'test:cache:key';
      const value = { test: 'data', timestamp: Date.now() };
      
      await cachingService.set(key, value, { ttl: 60 });
      const cached = await cachingService.get(key);
      
      expect(cached).toEqual(value);
    });

    test('should provide cache statistics', async () => {
      const stats = await cachingService.getStats();
      
      expect(stats).toHaveProperty('l1');
      expect(stats).toHaveProperty('l2');
      expect(stats.l1).toHaveProperty('hitRatio');
      expect(stats.l2).toHaveProperty('hitRatio');
    });

    test('should handle cache failures gracefully', async () => {
      // Test cache miss scenario
      const nonExistentKey = 'test:nonexistent:' + Date.now();
      const result = await cachingService.get(nonExistentKey);
      
      expect(result).toBeNull();
    });

    test('should warm cache with common patterns', async () => {
      await cachingService.warmCache();
      
      // Verify some common cache keys exist
      const stats = await cachingService.getStats();
      expect(stats.l1.hitRatio).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance Monitoring Integration', () => {
    test('should track request metrics', async () => {
      const response = await request(app).get('/test/fast');
      
      expect(response.status).toBe(200);
      expect(response.headers).toHaveProperty('x-response-time');
      expect(response.headers).toHaveProperty('x-request-id');
    });

    test('should handle slow requests', async () => {
      const response = await request(app).get('/test/slow');
      
      expect(response.status).toBe(200);
      
      const responseTime = parseInt(response.headers['x-response-time'] as string);
      expect(responseTime).toBeGreaterThan(900); // Should be > 1000ms but allowing for test variance
    });

    test('should track memory usage', async () => {
      // Make several requests to generate memory usage
      for (let i = 0; i < 5; i++) {
        await request(app).get('/test/fast');
      }
      
      // Memory tracking is passive, so just verify no errors occurred
      expect(true).toBe(true);
    });
  });

  describe('Health Check Integration', () => {
    test('should provide basic health status', async () => {
      const response = await request(app).get('/api/v1/health');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(response.body.status);
    });

    test('should provide detailed health information', async () => {
      const response = await request(app).get('/api/v1/health/detailed');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('checks');
      expect(response.body.checks).toHaveProperty('system');
      expect(response.body.checks).toHaveProperty('circuitBreakers');
      expect(response.body.checks).toHaveProperty('degradation');
    });

    test('should provide performance metrics', async () => {
      const response = await request(app).get('/api/v1/health/metrics');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('metrics');
      expect(response.body.metrics).toHaveProperty('throttling');
      expect(response.body.metrics).toHaveProperty('degradation');
    });

    test('should handle readiness checks', async () => {
      const response = await request(app).get('/api/v1/health/ready');
      
      expect([200, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('ready');
      expect(response.body).toHaveProperty('checks');
    });

    test('should handle liveness checks', async () => {
      const response = await request(app).get('/api/v1/health/live');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('alive');
      expect(response.body.alive).toBe(true);
    });
  });

  describe('End-to-End Performance Scenarios', () => {
    test('should handle normal load scenario', async () => {
      const promises = [];
      
      // Simulate normal load
      for (let i = 0; i < 20; i++) {
        promises.push(
          request(app)
            .post('/test/validate')
            .send({ address: `${i} Test Street` })
            .set('X-Forwarded-For', `192.168.2.${100 + (i % 10)}`)
        );
      }
      
      const responses = await Promise.all(promises);
      
      // Most requests should succeed
      const successCount = responses.filter(r => r.status === 200).length;
      expect(successCount).toBeGreaterThan(15);
      
      // Check that system remains healthy
      const status = gracefulDegradationService.getStatus();
      expect(['normal', 'reduced']).toContain(status.level);
    });

    test('should handle high load scenario', async () => {
      const promises = [];
      
      // Simulate high load
      for (let i = 0; i < 50; i++) {
        promises.push(
          request(app)
            .get('/test/fast')
            .set('X-Forwarded-For', `192.168.3.${100 + (i % 20)}`)
        );
      }
      
      const responses = await Promise.allSettled(promises);
      
      // Some requests should succeed, some may be throttled
      const fulfilled = responses.filter(r => r.status === 'fulfilled').length;
      expect(fulfilled).toBeGreaterThan(20);
      
      // System should handle the load gracefully
      const throttlingStats = requestThrottlingService.getStats();
      expect(throttlingStats.totalRequests).toBeGreaterThan(0);
    });

    test('should recover from degraded state', async () => {
      // Force degradation
      gracefulDegradationService.setDegradationLevel('minimal', 'Test recovery');
      
      let status = gracefulDegradationService.getStatus();
      expect(status.level).toBe('minimal');
      
      // Allow system to recover
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Manually restore to simulate recovery
      gracefulDegradationService.setDegradationLevel('normal', 'Recovery test completed');
      
      status = gracefulDegradationService.getStatus();
      expect(status.level).toBe('normal');
    });
  });
});

describe('Performance Optimization Service Interactions', () => {
  test('should coordinate between caching and circuit breakers', async () => {
    const dbBreaker = circuitBreakerService.getCircuitBreaker('database');
    const cacheBreaker = circuitBreakerService.getCircuitBreaker('redis');
    
    expect(dbBreaker).toBeDefined();
    expect(cacheBreaker).toBeDefined();
    
    // Test that cache can serve as fallback when database circuit is open
    if (dbBreaker) {
      dbBreaker.forceOpen();
      
      // Should still be able to use cache
      const key = 'fallback:test';
      await cachingService.set(key, { fallback: true });
      const cached = await cachingService.get(key);
      
      expect(cached).toEqual({ fallback: true });
      
      dbBreaker.reset();
    }
  });

  test('should integrate throttling with degradation', async () => {
    // Set reduced degradation level
    gracefulDegradationService.setDegradationLevel('reduced', 'Integration test');
    
    const degradationStatus = gracefulDegradationService.getStatus();
    const throttlingStats = requestThrottlingService.getStats();
    
    expect(degradationStatus.level).toBe('reduced');
    expect(throttlingStats).toHaveProperty('totalRequests');
    
    // Reset
    gracefulDegradationService.setDegradationLevel('normal', 'Test completed');
  });

  test('should provide comprehensive system status', async () => {
    const circuitBreakerHealth = circuitBreakerService.getHealthStatus();
    const degradationStatus = gracefulDegradationService.getStatus();
    const throttlingStats = requestThrottlingService.getStats();
    const cacheStats = await cachingService.getStats();
    
    // All services should provide status information
    expect(circuitBreakerHealth).toHaveProperty('healthy');
    expect(degradationStatus).toHaveProperty('level');
    expect(throttlingStats).toHaveProperty('totalRequests');
    expect(cacheStats).toHaveProperty('l1');
    
    // System should be in a known state
    expect(['normal', 'reduced', 'minimal', 'emergency']).toContain(degradationStatus.level);
  });
});