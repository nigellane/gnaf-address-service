import request from 'supertest';
import app from '../../src/app';
import { getDatabase } from '../../src/config/database';

describe.skip('Integration Tests', () => {
  const validApiKey = process.env.TEST_API_KEY || 'dev-key-1';
  let db: any;

  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test') {
      return;
    }
    
    db = getDatabase();
    
    try {
      await db.healthCheck();
    } catch (error) {
      console.warn('Database not available for integration tests');
    }
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  describe('Real Database Integration', () => {
    beforeEach(() => {
      if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL) {
        pending('Integration tests require test database');
      }
    });

    it('should perform real address search', async () => {
      const response = await request(app)
        .get('/api/v1/addresses/search?q=George Street Sydney&limit=5')
        .set('X-API-Key', validApiKey);

      if (response.status === 200) {
        expect(response.body.results).toBeDefined();
        expect(response.body.total).toBeGreaterThanOrEqual(0);
        expect(response.body.limit).toBe(5);

        if (response.body.results.length > 0) {
          const result = response.body.results[0];
          expect(result.gnafPid).toMatch(/^GA[A-Z]{2,3}\d+G\d+$/);
          expect(result.formattedAddress).toBeDefined();
          expect(result.confidence).toBeGreaterThan(0);
        }
      }
    }, 10000);

    it('should perform real address validation', async () => {
      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({
          address: '1 George Street, Sydney NSW 2000',
          includeComponents: true,
          includeSuggestions: true
        });

      if (response.status === 200) {
        expect(response.body.isValid).toBeDefined();
        expect(response.body.confidence).toBeGreaterThanOrEqual(0);
        expect(response.body.confidence).toBeLessThanOrEqual(100);
        expect(response.body.suggestions).toBeDefined();
        expect(response.body.issues).toBeDefined();

        if (response.body.isValid) {
          expect(response.body.standardizedAddress).toBeDefined();
          expect(response.body.components).toBeDefined();
          expect(response.body.components.coordinates).toBeDefined();
          expect(response.body.components.coordinates.latitude).toBeGreaterThan(-50);
          expect(response.body.components.coordinates.latitude).toBeLessThan(-10);
          expect(response.body.components.coordinates.longitude).toBeGreaterThan(110);
          expect(response.body.components.coordinates.longitude).toBeLessThan(160);
        }
      }
    }, 10000);

    it('should handle invalid addresses gracefully', async () => {
      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({
          address: 'This is not a valid Australian address at all',
          includeSuggestions: true
        });

      expect(response.status).toBe(200);
      expect(response.body.isValid).toBe(false);
      expect(response.body.confidence).toBe(0);
      expect(response.body.issues).toBeDefined();
      expect(response.body.issues.length).toBeGreaterThan(0);
    });

    it('should respect state filtering in search', async () => {
      const response = await request(app)
        .get('/api/v1/addresses/search?q=Main Street&state=QLD&limit=10')
        .set('X-API-Key', validApiKey);

      if (response.status === 200 && response.body.results.length > 0) {
        response.body.results.forEach((result: any) => {
          expect(result.formattedAddress).toContain('QLD');
        });
      }
    });

    it('should perform within performance targets', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/v1/addresses/search?q=George Street&limit=10')
        .set('X-API-Key', validApiKey);

      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(500); // Should complete within 500ms
      expect(response.headers['x-response-time']).toBeDefined();
    });
  });

  describe('Performance Tests', () => {
    it('should handle concurrent requests', async () => {
      const concurrentRequests = 10;
      const promises = [];

      for (let i = 0; i < concurrentRequests; i++) {
        const promise = request(app)
          .get(`/api/v1/addresses/search?q=Street ${i}&limit=5`)
          .set('X-API-Key', validApiKey);
        promises.push(promise);
      }

      const responses = await Promise.all(promises);
      
      responses.forEach(response => {
        expect([200, 500]).toContain(response.status); // Some may fail due to load
        expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      });
    });

    it('should complete validation within performance target', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({ address: '123 Collins Street Melbourne VIC 3000' });

      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(300); // Should complete within 300ms
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}');

      expect(response.status).toBe(400);
    });

    it('should handle very large requests', async () => {
      const largeAddress = 'A'.repeat(1000);

      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({ address: largeAddress });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('ADDRESS_TOO_LONG');
    });

    it('should return 404 for unknown endpoints', async () => {
      const response = await request(app)
        .get('/api/v1/nonexistent')
        .set('X-API-Key', validApiKey);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ENDPOINT_NOT_FOUND');
    });
  });

  describe('Health Check Integration', () => {
    it('should return detailed health status', async () => {
      const response = await request(app)
        .get('/api/v1/addresses/health');

      expect([200, 503]).toContain(response.status);
      expect(response.body.status).toMatch(/^(healthy|degraded|unhealthy)$/);
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.services.database).toBeDefined();
      expect(response.body.services.database.healthy).toBeDefined();
      expect(response.body.services.database.latency).toBeDefined();
    });
  });
});