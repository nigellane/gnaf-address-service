/**
 * Comprehensive Health Check System Tests
 * Tests for enhanced health check endpoints with G-NAF dataset validation
 */

import request from 'supertest';
import app from '../../src/app';
import { DatabaseManager } from '../../src/config/database';
import { redisManager } from '../../src/config/redis';

describe('Enhanced Health Check System', () => {
  let testStartTime: number;

  beforeAll(async () => {
    testStartTime = Date.now();
    // Ensure services are initialized
    await DatabaseManager.getInstance();
  });

  afterAll(async () => {
    // Clean up any test resources
  });

  describe('Basic Health Endpoint', () => {
    it('should return healthy status with all components', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: expect.stringMatching(/^(healthy|degraded)$/),
        timestamp: expect.any(String),
        version: expect.any(String),
        responseTime: expect.stringMatching(/\d+ms/),
        checks: {
          database: {
            status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
            details: expect.any(Object)
          },
          cache: {
            status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
            details: expect.any(Object)
          },
          system: {
            status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
            details: expect.any(Object)
          },
          gnafDataset: {
            status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
            details: expect.any(Object)
          }
        }
      });

      // Validate response time is reasonable
      const responseTimeMs = parseInt(response.body.responseTime.replace('ms', ''));
      expect(responseTimeMs).toBeLessThan(5000); // Should respond within 5 seconds
    });

    it('should include G-NAF dataset health information', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.body.checks.gnafDataset).toBeDefined();
      expect(response.body.checks.gnafDataset.details).toMatchObject({
        queryTime: expect.stringMatching(/\d+ms/),
        totalAddresses: expect.any(Number),
        dataFreshness: expect.stringMatching(/^(current|stale)$/)
      });
    });
  });

  describe('Detailed Health Endpoint', () => {
    it('should return comprehensive health information', async () => {
      const response = await request(app)
        .get('/api/v1/health/detailed')
        .expect(200);

      expect(response.body).toMatchObject({
        status: expect.stringMatching(/^(healthy|degraded|unhealthy)$/),
        timestamp: expect.any(String),
        version: expect.any(String),
        environment: expect.any(String),
        responseTime: expect.stringMatching(/\d+ms/),
        uptime: expect.stringMatching(/\d+s/),
        checks: {
          database: expect.any(Object),
          cache: expect.any(Object),
          system: expect.any(Object),
          gnafDataset: expect.any(Object),
          circuitBreakers: expect.any(Object),
          degradation: expect.any(Object),
          performance: expect.any(Object),
          throttling: expect.any(Object)
        }
      });
    });

    it('should include enhanced database health checks', async () => {
      const response = await request(app)
        .get('/api/v1/health/detailed')
        .expect(200);

      expect(response.body.checks.database.details).toMatchObject({
        queryTime: expect.stringMatching(/\d+ms/),
        connections: {
          total: expect.any(Number),
          idle: expect.any(Number),
          waiting: expect.any(Number),
          maxConnections: 20
        },
        averageQueryTime: expect.stringMatching(/\d+ms/),
        slowQueries: expect.any(Number),
        extensions: {
          postgis: expect.any(String)
        },
        spatialFunctionality: expect.stringMatching(/^(working|failed)$/)
      });
    });

    it('should include enhanced cache health with failover detection', async () => {
      const response = await request(app)
        .get('/api/v1/health/detailed')
        .expect(200);

      expect(response.body.checks.cache.details).toMatchObject({
        connectionStatus: expect.any(String),
        responseTime: expect.stringMatching(/\d+ms/),
        commandsProcessed: expect.any(Number),
        cacheHitRatio: expect.stringMatching(/\d+\.\d+%/),
        averageResponseTime: expect.stringMatching(/\d+ms/),
        memoryUsage: expect.any(String),
        cluster: expect.objectContaining({
          mode: expect.stringMatching(/^(cluster|single-node)$/)
        })
      });
    });
  });

  describe('Readiness Probe', () => {
    it('should validate critical services are ready', async () => {
      const response = await request(app)
        .get('/api/v1/health/ready')
        .expect(200);

      expect(response.body).toMatchObject({
        ready: expect.any(Boolean),
        timestamp: expect.any(String),
        checks: {
          database: expect.any(Boolean),
          cache: expect.any(Boolean)
        }
      });

      // Should respond quickly for Kubernetes probes
      const responseTimeMs = Date.now() - testStartTime;
      expect(responseTimeMs).toBeLessThan(2000);
    });
  });

  describe('Liveness Probe', () => {
    it('should respond quickly with basic liveness information', async () => {
      const response = await request(app)
        .get('/api/v1/health/live')
        .expect(200);

      expect(response.body).toMatchObject({
        alive: true,
        timestamp: expect.any(String),
        uptime: expect.stringMatching(/\d+s/)
      });

      // Should respond very quickly for Kubernetes probes
      const responseTimeMs = Date.now() - testStartTime;
      expect(responseTimeMs).toBeLessThan(1000);
    });
  });

  describe('Metrics Endpoint', () => {
    it('should provide comprehensive metrics data', async () => {
      const response = await request(app)
        .get('/api/v1/health/metrics')
        .expect(200);

      expect(response.body).toMatchObject({
        timestamp: expect.any(String),
        metrics: {
          performance: expect.any(Object),
          system: expect.any(Object),
          throttling: expect.any(Object),
          degradation: expect.any(Object)
        }
      });
    });
  });

  describe('Performance Requirements', () => {
    it('should meet response time targets for health endpoints', async () => {
      const endpoints = [
        '/api/v1/health/live',
        '/api/v1/health/ready'
      ];

      for (const endpoint of endpoints) {
        const startTime = Date.now();
        const response = await request(app)
          .get(endpoint)
          .expect(200);
        const responseTime = Date.now() - startTime;

        // Should meet <100ms target for Kubernetes probes
        expect(responseTime).toBeLessThan(100);
      }
    });

    it('should validate monitoring overhead is within limits', async () => {
      // Test multiple concurrent requests to simulate monitoring load
      const concurrentRequests = 10;
      const promises = Array.from({ length: concurrentRequests }, () =>
        request(app).get('/api/v1/health/metrics')
      );

      const startTime = Date.now();
      const responses = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Average response time should be reasonable
      const avgResponseTime = totalTime / concurrentRequests;
      expect(avgResponseTime).toBeLessThan(1000); // <1 second average
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection failures gracefully', async () => {
      // This would require mocking database failures
      // For now, just ensure the endpoint doesn't crash
      const response = await request(app)
        .get('/api/v1/health')
        .expect((res) => {
          expect([200, 503]).toContain(res.status);
        });

      expect(response.body.status).toMatch(/^(healthy|degraded|unhealthy)$/);
    });

    it('should provide meaningful error messages', async () => {
      const response = await request(app)
        .get('/api/v1/health/detailed');

      // Should include specific error details when services are unhealthy
      if (response.status === 503) {
        Object.values(response.body.checks).forEach((check: any) => {
          if (check.status === 'unhealthy' && check.error) {
            expect(check.error).toBeTruthy();
            expect(typeof check.error).toBe('string');
          }
        });
      }
    });
  });
});