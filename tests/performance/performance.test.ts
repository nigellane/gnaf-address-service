import request from 'supertest';
import app from '../../src/app';

const shouldSkip = process.env.NODE_ENV !== 'test' || !process.env.RUN_PERFORMANCE_TESTS;

describe.skip('Performance Tests', () => {
  const validApiKey = process.env.TEST_API_KEY || 'dev-key-1';

  describe('Search Performance', () => {
    it('should complete simple search within 500ms', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/v1/addresses/search?q=George Street&limit=10')
        .set('X-API-Key', validApiKey);

      const duration = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(500);
      
      console.log(`Search completed in ${duration}ms`);
    });

    it('should complete complex search within 500ms', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/v1/addresses/search?q=123 Collins Street Melbourne Victoria&state=VIC&limit=50')
        .set('X-API-Key', validApiKey);

      const duration = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(500);
      
      console.log(`Complex search completed in ${duration}ms`);
    });

    it('should handle partial matches efficiently', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/v1/addresses/search?q=Main Street&limit=25')
        .set('X-API-Key', validApiKey);

      const duration = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(500);
      
      console.log(`Partial match search completed in ${duration}ms`);
    });
  });

  describe('Validation Performance', () => {
    it('should complete validation within 300ms', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({ address: '123 Collins Street, Melbourne VIC 3000' });

      const duration = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(300);
      
      console.log(`Validation completed in ${duration}ms`);
    });

    it('should complete validation with suggestions within 300ms', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({ 
          address: '123 Collins St Melbourne',
          includeSuggestions: true,
          includeComponents: true
        });

      const duration = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(300);
      
      console.log(`Validation with suggestions completed in ${duration}ms`);
    });

    it('should handle invalid address validation efficiently', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({ 
          address: 'This is not a valid address',
          includeSuggestions: true
        });

      const duration = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(300);
      
      console.log(`Invalid address validation completed in ${duration}ms`);
    });
  });

  describe('Concurrent Load Tests', () => {
    it('should handle 50 concurrent search requests', async () => {
      const concurrentRequests = 50;
      const promises = [];
      const startTime = Date.now();

      for (let i = 0; i < concurrentRequests; i++) {
        const promise = request(app)
          .get(`/api/v1/addresses/search?q=Street ${i % 10}&limit=5`)
          .set('X-API-Key', validApiKey);
        promises.push(promise);
      }

      const responses = await Promise.all(promises);
      const totalDuration = Date.now() - startTime;
      
      let successCount = 0;
      let totalResponseTime = 0;
      
      responses.forEach(response => {
        if (response.status === 200) {
          successCount++;
          const responseTime = parseInt(response.headers['x-response-time']?.replace('ms', '') || '0');
          totalResponseTime += responseTime;
        }
      });

      expect(successCount).toBeGreaterThanOrEqual(concurrentRequests * 0.95); // 95% success rate
      expect(totalDuration).toBeLessThan(5000); // All requests within 5 seconds
      
      const avgResponseTime = totalResponseTime / successCount;
      expect(avgResponseTime).toBeLessThan(1000); // Average response time under 1 second
      
      console.log(`${successCount}/${concurrentRequests} requests succeeded in ${totalDuration}ms`);
      console.log(`Average response time: ${avgResponseTime.toFixed(2)}ms`);
    });

    it('should handle 20 concurrent validation requests', async () => {
      const concurrentRequests = 20;
      const promises = [];
      const startTime = Date.now();
      
      const addresses = [
        '1 Collins Street Melbourne VIC 3000',
        '123 George Street Sydney NSW 2000',
        '456 Queen Street Brisbane QLD 4000',
        '789 King William Street Adelaide SA 5000',
        '321 Hay Street Perth WA 6000'
      ];

      for (let i = 0; i < concurrentRequests; i++) {
        const promise = request(app)
          .post('/api/v1/addresses/validate')
          .set('X-API-Key', validApiKey)
          .send({ 
            address: addresses[i % addresses.length],
            includeComponents: true
          });
        promises.push(promise);
      }

      const responses = await Promise.all(promises);
      const totalDuration = Date.now() - startTime;
      
      let successCount = 0;
      let totalResponseTime = 0;
      
      responses.forEach(response => {
        if (response.status === 200) {
          successCount++;
          const responseTime = parseInt(response.headers['x-response-time']?.replace('ms', '') || '0');
          totalResponseTime += responseTime;
        }
      });

      expect(successCount).toBeGreaterThanOrEqual(concurrentRequests * 0.95);
      expect(totalDuration).toBeLessThan(3000); // All validations within 3 seconds
      
      const avgResponseTime = totalResponseTime / successCount;
      expect(avgResponseTime).toBeLessThan(500);
      
      console.log(`${successCount}/${concurrentRequests} validations succeeded in ${totalDuration}ms`);
      console.log(`Average validation time: ${avgResponseTime.toFixed(2)}ms`);
    });
  });

  describe('Memory and Resource Tests', () => {
    it('should handle large result sets efficiently', async () => {
      const startTime = Date.now();
      const initialMemory = process.memoryUsage().heapUsed;
      
      const response = await request(app)
        .get('/api/v1/addresses/search?q=Street&limit=50')
        .set('X-API-Key', validApiKey);

      const duration = Date.now() - startTime;
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(800);
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // Less than 10MB increase
      
      console.log(`Large result set: ${duration}ms, memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
    });

    it('should handle multiple sequential requests without memory leaks', async () => {
      const requestCount = 100;
      const initialMemory = process.memoryUsage().heapUsed;
      
      for (let i = 0; i < requestCount; i++) {
        await request(app)
          .get(`/api/v1/addresses/search?q=Street ${i % 10}`)
          .set('X-API-Key', validApiKey);
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      const memoryPerRequest = memoryIncrease / requestCount;
      
      expect(memoryPerRequest).toBeLessThan(100 * 1024); // Less than 100KB per request
      
      console.log(`${requestCount} requests: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB total, ${(memoryPerRequest / 1024).toFixed(2)}KB per request`);
    });
  });

  describe('Rate Limiting Performance', () => {
    it('should enforce rate limits efficiently', async () => {
      const requestCount = 20;
      const promises = [];
      const startTime = Date.now();

      for (let i = 0; i < requestCount; i++) {
        const promise = request(app)
          .get(`/api/v1/addresses/search?q=test${i}`)
          .set('X-API-Key', validApiKey);
        promises.push(promise);
      }

      const responses = await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(2000); // Rate limiting check should be fast
      
      responses.forEach(response => {
        expect(response.headers['x-ratelimit-limit']).toBe('1000');
        expect(response.headers['x-ratelimit-remaining']).toBeDefined();
        expect(response.headers['x-ratelimit-reset']).toBeDefined();
      });
      
      console.log(`Rate limiting handled ${requestCount} requests in ${duration}ms`);
    });
  });
});