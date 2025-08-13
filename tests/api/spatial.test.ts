/**
 * Spatial Analytics API Endpoint Tests
 * Tests for spatial analytics REST API endpoints
 */

import request from 'supertest';
import app from '../../src/app';
import { spatialAnalyticsService } from '../../src/services/spatialAnalyticsService';
import { ProximityResponse } from '../../src/types/spatial';

// Mock the spatial analytics service
jest.mock('../../src/services/spatialAnalyticsService');
jest.mock('../../src/middleware/auth');
jest.mock('../../src/middleware/rateLimiting');
jest.mock('../../src/utils/logger');

const mockSpatialService = spatialAnalyticsService as jest.Mocked<typeof spatialAnalyticsService>;

// Mock auth and rate limiting middleware to pass through
jest.mock('../../src/middleware/auth', () => ({
  authenticateApiKey: (req: any, res: any, next: any) => next()
}));

jest.mock('../../src/middleware/rateLimiting', () => ({
  rateLimiting: (req: any, res: any, next: any) => next()
}));

describe('Spatial Analytics API Endpoints', () => {
  const validApiKey = 'test-api-key';
  const validMelbourneCoordinates = { latitude: -37.8136, longitude: 144.9631 };
  
  const mockProximityResponse: ProximityResponse = {
    center: validMelbourneCoordinates,
    radius: 1000,
    results: [
      {
        gnafPid: 'GAVIC411711441',
        address: '123 Collins Street, Melbourne VIC 3000',
        coordinates: { latitude: -37.8140, longitude: 144.9630 },
        distance: { meters: 50, kilometers: 0.05 }
      },
      {
        gnafPid: 'GAVIC411711442',
        address: '456 Swanston Street, Melbourne VIC 3000',
        coordinates: { latitude: -37.8150, longitude: 144.9640 },
        distance: { meters: 150, kilometers: 0.15 }
      }
    ],
    summary: {
      total: 2,
      averageDistance: 100,
      searchTime: 125
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/spatial/proximity', () => {
    it('should successfully analyze proximity with coordinates', async () => {
      mockSpatialService.analyzeProximity.mockResolvedValueOnce(mockProximityResponse);

      const requestBody = {
        coordinates: validMelbourneCoordinates,
        radius: 1000,
        limit: 10,
        includeDistance: true,
        includeBearing: false
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(200);

      // Verify service was called with correct parameters
      expect(mockSpatialService.analyzeProximity).toHaveBeenCalledWith(
        expect.objectContaining(requestBody)
      );

      // Verify response structure
      expect(response.body).toMatchObject({
        success: true,
        data: mockProximityResponse,
        meta: {
          requestId: expect.any(String),
          responseTime: expect.any(Number),
          timestamp: expect.any(String)
        }
      });

      // Verify headers
      expect(response.headers['x-response-time']).toBeDefined();
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('should successfully analyze proximity with address', async () => {
      mockSpatialService.analyzeProximity.mockResolvedValueOnce(mockProximityResponse);

      const requestBody = {
        address: '123 Collins Street Melbourne VIC',
        radius: 500,
        includeBearing: true
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(200);

      expect(mockSpatialService.analyzeProximity).toHaveBeenCalledWith(
        expect.objectContaining(requestBody)
      );

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockProximityResponse);
    });

    it('should return 400 for missing location (no coordinates or address)', async () => {
      const requestBody = {
        radius: 1000
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(400);

      expect(response.body.error.code).toBe('MISSING_LOCATION');
      expect(response.body.error.message).toContain('Either coordinates or address must be provided');
    });

    it('should return 400 for invalid coordinates', async () => {
      const requestBody = {
        coordinates: { latitude: 'invalid', longitude: 144.9631 },
        radius: 1000
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_COORDINATES');
      expect(response.body.error.message).toContain('Coordinates must be valid numbers');
    });

    it('should return 400 for coordinates outside Australian territory', async () => {
      const requestBody = {
        coordinates: { latitude: 51.5074, longitude: -0.1278 }, // London
        radius: 1000
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(400);

      expect(response.body.error.code).toBe('COORDINATES_OUT_OF_BOUNDS');
      expect(response.body.error.message).toContain('Australian territory');
    });

    it('should return 400 for invalid radius', async () => {
      const requestBody = {
        coordinates: validMelbourneCoordinates,
        radius: 10000 // Exceeds max of 5000
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_RADIUS');
      expect(response.body.error.message).toContain('between 1 and 5000 meters');
    });

    it('should return 400 for invalid limit', async () => {
      const requestBody = {
        coordinates: validMelbourneCoordinates,
        radius: 1000,
        limit: 100 // Exceeds max of 50
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_LIMIT');
      expect(response.body.error.message).toContain('between 1 and 50');
    });

    it('should return 400 for invalid address format', async () => {
      const requestBody = {
        address: 'xy', // Too short
        radius: 1000
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_ADDRESS');
      expect(response.body.error.message).toContain('at least 3 characters');
    });

    it('should return 400 for invalid property types', async () => {
      const requestBody = {
        coordinates: validMelbourneCoordinates,
        radius: 1000,
        propertyTypes: ['valid', 123] // Mixed types
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_PROPERTY_TYPES');
      expect(response.body.error.message).toContain('array of strings');
    });

    it('should return 400 for invalid boolean flags', async () => {
      const requestBody = {
        coordinates: validMelbourneCoordinates,
        radius: 1000,
        includeDistance: 'yes' // Should be boolean
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_INCLUDE_DISTANCE');
    });

    it('should handle service errors appropriately', async () => {
      mockSpatialService.analyzeProximity.mockRejectedValueOnce(
        new Error('Unable to geocode address: Invalid Address')
      );

      const requestBody = {
        address: 'Invalid Address That Does Not Exist',
        radius: 1000
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(400);

      expect(response.body.error.code).toBe('GEOCODING_FAILED');
      expect(response.body.error.message).toContain('Unable to geocode address');
    });

    it('should handle coordinate validation errors', async () => {
      mockSpatialService.analyzeProximity.mockRejectedValueOnce(
        new Error('Coordinates must be within Australian territory')
      );

      const requestBody = {
        coordinates: validMelbourneCoordinates,
        radius: 1000
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_COORDINATES');
    });

    it('should handle internal server errors', async () => {
      mockSpatialService.analyzeProximity.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const requestBody = {
        coordinates: validMelbourneCoordinates,
        radius: 1000
      };

      const response = await request(app)
        .post('/api/v1/spatial/proximity')
        .set('X-API-Key', validApiKey)
        .send(requestBody)
        .expect(500);

      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(response.headers['x-response-time']).toBeDefined();
    });
  });

  describe('GET /api/v1/spatial/health', () => {
    it('should return healthy status when service is operational', async () => {
      const mockHealthStatus = {
        status: 'healthy',
        spatialExtensions: true,
        indexHealth: 'healthy'
      };

      const mockPerformanceStats = {
        averageExecutionTime: 125,
        slowQueries: 2,
        totalQueries: 100,
        spatialIndexUsage: 95
      };

      mockSpatialService.healthCheck.mockResolvedValueOnce(mockHealthStatus);
      mockSpatialService.getPerformanceStats.mockReturnValueOnce(mockPerformanceStats);

      const response = await request(app)
        .get('/api/v1/spatial/health')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        version: expect.any(String),
        checks: {
          spatialAnalytics: mockHealthStatus,
          performance: mockPerformanceStats
        },
        meta: {
          requestId: expect.any(String),
          responseTime: expect.any(Number)
        }
      });
    });

    it('should return 503 for unhealthy service', async () => {
      const mockHealthStatus = {
        status: 'unhealthy',
        spatialExtensions: false,
        indexHealth: 'unknown'
      };

      mockSpatialService.healthCheck.mockResolvedValueOnce(mockHealthStatus);
      mockSpatialService.getPerformanceStats.mockReturnValueOnce({
        averageExecutionTime: 0,
        slowQueries: 0,
        totalQueries: 0,
        spatialIndexUsage: 0
      });

      const response = await request(app)
        .get('/api/v1/spatial/health')
        .set('X-API-Key', validApiKey)
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
    });

    it('should handle health check failures', async () => {
      mockSpatialService.healthCheck.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get('/api/v1/spatial/health')
        .set('X-API-Key', validApiKey)
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
      expect(response.body.error.code).toBe('HEALTH_CHECK_FAILED');
    });
  });

  describe('Not Implemented Endpoints', () => {
    it('should return 501 for boundaries endpoint (Task 2)', async () => {
      const response = await request(app)
        .post('/api/v1/spatial/boundaries')
        .set('X-API-Key', validApiKey)
        .send({ coordinates: validMelbourneCoordinates })
        .expect(501);

      expect(response.body.error.code).toBe('NOT_IMPLEMENTED');
      expect(response.body.error.message).toContain('Task 2');
    });

    it('should return 501 for statistical-areas endpoint (Task 3)', async () => {
      const response = await request(app)
        .post('/api/v1/spatial/statistical-areas')
        .set('X-API-Key', validApiKey)
        .send({ coordinates: validMelbourneCoordinates })
        .expect(501);

      expect(response.body.error.code).toBe('NOT_IMPLEMENTED');
      expect(response.body.error.message).toContain('Task 3');
    });

    it('should return 501 for batch/analyze endpoint (Task 4)', async () => {
      const response = await request(app)
        .post('/api/v1/spatial/batch/analyze')
        .set('X-API-Key', validApiKey)
        .send({ operations: [] })
        .expect(501);

      expect(response.body.error.code).toBe('NOT_IMPLEMENTED');
      expect(response.body.error.message).toContain('Task 4');
    });
  });
});