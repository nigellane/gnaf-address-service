/**
 * Prometheus Metrics Service Tests
 * Tests for metrics collection, export, and middleware integration
 */

import request from 'supertest';
import app from '../../src/app';
import { prometheusMetrics } from '../../src/services/prometheusMetrics';

describe('Prometheus Metrics Service', () => {
  beforeAll(async () => {
    // Allow some time for metrics collection to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  describe('Metrics Collection', () => {
    it('should collect and export system metrics', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/plain/);
      expect(response.text).toContain('gnaf_service_process_cpu_user_seconds_total');
      expect(response.text).toContain('gnaf_service_process_resident_memory_bytes');
      expect(response.text).toContain('gnaf_service_nodejs_version_info');
    });

    it('should export custom HTTP request metrics', async () => {
      // Make a test request to generate metrics
      await request(app).get('/api/v1/health');

      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.text).toContain('gnaf_http_requests_total');
      expect(response.text).toContain('gnaf_http_request_duration_seconds');
      expect(response.text).toContain('gnaf_http_response_size_bytes');
    });

    it('should export database connection metrics', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.text).toContain('gnaf_db_connections_active');
      expect(response.text).toContain('gnaf_db_connections_idle');
      expect(response.text).toContain('gnaf_db_connections_waiting');
    });

    it('should export cache metrics', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.text).toContain('gnaf_cache_hit_ratio');
      expect(response.text).toContain('gnaf_cache_memory_usage_bytes');
    });

    it('should export G-NAF dataset metrics', async () => {
      // Allow time for G-NAF metrics collection
      await new Promise(resolve => setTimeout(resolve, 2000));

      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.text).toContain('gnaf_dataset_records_total');
      expect(response.text).toContain('gnaf_dataset_health');
    });

    it('should export system resource metrics', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.text).toContain('gnaf_system_resource_usage');
    });
  });

  describe('HTTP Request Metrics', () => {
    it('should record metrics for API requests', async () => {
      // Make several requests to generate metrics
      const requests = [
        request(app).get('/api/v1/health'),
        request(app).get('/api/v1/health/detailed'),
        request(app).get('/api/v1/health/ready')
      ];

      await Promise.all(requests);

      const metricsResponse = await request(app)
        .get('/metrics')
        .expect(200);

      // Check for specific route patterns
      expect(metricsResponse.text).toMatch(/gnaf_http_requests_total.*route="\/api\/v1\/health"/);
      expect(metricsResponse.text).toMatch(/gnaf_http_requests_total.*route="\/api\/v1\/health\/detailed"/);
      expect(metricsResponse.text).toMatch(/gnaf_http_requests_total.*route="\/api\/v1\/health\/ready"/);
    });

    it('should categorize endpoints by type', async () => {
      await Promise.all([
        request(app).get('/api/v1/health'),
        request(app).get('/api/v1/addresses/search?q=test')
      ]);

      const metricsResponse = await request(app)
        .get('/metrics')
        .expect(200);

      // Health endpoints should be labeled as 'health' type
      expect(metricsResponse.text).toMatch(/gnaf_http_requests_total.*endpoint_type="health"/);
      
      // Address endpoints should be labeled as 'api' type
      expect(metricsResponse.text).toMatch(/gnaf_http_requests_total.*endpoint_type="api"/);
    });

    it('should record response times and sizes', async () => {
      await request(app).get('/api/v1/health/detailed');

      const metricsResponse = await request(app)
        .get('/metrics')
        .expect(200);

      // Should include duration buckets
      expect(metricsResponse.text).toMatch(/gnaf_http_request_duration_seconds_bucket.*le="0\.001"/);
      expect(metricsResponse.text).toMatch(/gnaf_http_request_duration_seconds_bucket.*le="0\.1"/);
      expect(metricsResponse.text).toMatch(/gnaf_http_request_duration_seconds_bucket.*le="1"/);

      // Should include response size buckets
      expect(metricsResponse.text).toMatch(/gnaf_http_response_size_bytes_bucket.*le="1000"/);
    });
  });

  describe('Business Metrics', () => {
    it('should provide counters for address validation', async () => {
      // Record some test business metrics
      prometheusMetrics.recordAddressValidation('standard', true, 'high');
      prometheusMetrics.recordAddressValidation('fuzzy', false, 'low');

      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.text).toContain('gnaf_address_validation_total');
      expect(response.text).toContain('gnaf_address_validation_success_total');
    });

    it('should provide counters for geocoding', async () => {
      // Record some test geocoding metrics
      prometheusMetrics.recordGeocoding('forward', true, 'property');
      prometheusMetrics.recordGeocoding('reverse', true, 'street');

      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.text).toContain('gnaf_geocoding_total');
      expect(response.text).toContain('gnaf_geocoding_success_total');
    });
  });

  describe('Metric Labels and Format', () => {
    it('should use consistent labeling format', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      // Check that metrics follow Prometheus naming conventions
      const lines = response.text.split('\n');
      const metricLines = lines.filter(line => line.startsWith('gnaf_'));

      metricLines.forEach(line => {
        if (!line.startsWith('#')) {
          // Should follow prometheus metric name format (letters, numbers, underscores, colons)
          expect(line).toMatch(/^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})?\s+[\d.]+(\s+\d+)?$/);
        }
      });
    });

    it('should include help text for custom metrics', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      // Check for HELP comments
      expect(response.text).toMatch(/# HELP gnaf_http_requests_total Total number of HTTP requests/);
      expect(response.text).toMatch(/# HELP gnaf_db_connections_active Number of active database connections/);
      expect(response.text).toMatch(/# HELP gnaf_cache_hit_ratio Cache hit ratio/);
    });

    it('should include metric types', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      // Check for TYPE comments
      expect(response.text).toMatch(/# TYPE gnaf_http_requests_total counter/);
      expect(response.text).toMatch(/# TYPE gnaf_http_request_duration_seconds histogram/);
      expect(response.text).toMatch(/# TYPE gnaf_db_connections_active gauge/);
    });
  });

  describe('Performance Impact', () => {
    it('should not significantly impact response times', async () => {
      // Test multiple concurrent requests to measure overhead
      const concurrentRequests = 20;
      const startTime = Date.now();

      const requests = Array.from({ length: concurrentRequests }, () =>
        request(app).get('/api/v1/health')
      );

      const responses = await Promise.all(requests);
      const totalTime = Date.now() - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Average response time should be reasonable even with metrics collection
      const avgResponseTime = totalTime / concurrentRequests;
      expect(avgResponseTime).toBeLessThan(500); // Should complete in <500ms on average

      // Metrics endpoint should still be responsive
      const metricsStartTime = Date.now();
      await request(app).get('/metrics').expect(200);
      const metricsResponseTime = Date.now() - metricsStartTime;

      expect(metricsResponseTime).toBeLessThan(1000); // Metrics should respond quickly
    });

    it('should maintain CPU usage within acceptable limits', async () => {
      // Get initial CPU usage
      const initialCpuUsage = process.cpuUsage();

      // Generate metrics load
      const requests = Array.from({ length: 50 }, () =>
        request(app).get('/api/v1/health/detailed')
      );

      await Promise.all(requests);

      // Check CPU usage increase
      const finalCpuUsage = process.cpuUsage(initialCpuUsage);
      const totalCpuTime = (finalCpuUsage.user + finalCpuUsage.system) / 1000000; // Convert to seconds

      // Should not consume excessive CPU (less than 1 second for 50 requests)
      expect(totalCpuTime).toBeLessThan(1.0);
    });
  });

  describe('Error Handling', () => {
    it('should handle metrics endpoint errors gracefully', async () => {
      // This would require mocking errors in the metrics service
      // For now, just ensure the endpoint is robust
      const response = await request(app)
        .get('/metrics');

      expect([200, 500]).toContain(response.status);

      if (response.status === 500) {
        expect(response.body).toHaveProperty('error');
        expect(response.body).toHaveProperty('timestamp');
      }
    });
  });
});