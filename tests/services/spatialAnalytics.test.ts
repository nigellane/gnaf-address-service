/**
 * Spatial Analytics Service Unit Tests
 * Tests for core spatial analytics business logic
 */

import { SpatialAnalyticsService } from '../../src/services/spatialAnalyticsService';
import { DatabaseManager } from '../../src/config/database';
import { geocodingService } from '../../src/services/geocodingService';
import { ProximityRequest, ProximityResponse, SPATIAL_CONSTANTS } from '../../src/types/spatial';

// Mock dependencies
jest.mock('../../src/config/database');
jest.mock('../../src/services/geocodingService');

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

const mockDb = {
  query: jest.fn()
} as unknown as jest.Mocked<DatabaseManager>;

const mockGeocodingService = geocodingService as jest.Mocked<typeof geocodingService>;

describe('SpatialAnalyticsService', () => {
  let spatialService: SpatialAnalyticsService;

  beforeAll(() => {
    // Mock DatabaseManager.getInstance
    (DatabaseManager.getInstance as jest.Mock).mockReturnValue(mockDb);
  });

  beforeEach(() => {
    spatialService = new SpatialAnalyticsService();
    jest.clearAllMocks();
    mockDb.query.mockClear();
  });

  describe('analyzeProximity', () => {
    const validMelbourneCoordinates = { latitude: -37.8136, longitude: 144.9631 };
    
    const mockProximityResults = [
      {
        gnaf_pid: 'GAVIC411711441',
        address: '123 Collins Street, Melbourne VIC 3000',
        latitude: '-37.8140',
        longitude: '144.9630',
        distance_meters: '50'
      },
      {
        gnaf_pid: 'GAVIC411711442', 
        address: '456 Swanston Street, Melbourne VIC 3000',
        latitude: '-37.8150',
        longitude: '144.9640',
        distance_meters: '150'
      }
    ];

    beforeEach(() => {
      // Mock successful optimization query
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // optimization query
        .mockResolvedValueOnce({ rows: mockProximityResults }); // proximity query
    });

    it('should successfully analyze proximity with coordinates', async () => {
      const request: ProximityRequest = {
        coordinates: validMelbourneCoordinates,
        radius: 1000,
        limit: 10,
        includeDistance: true,
        includeBearing: false
      };

      const result = await spatialService.analyzeProximity(request);

      // Verify database queries were called correctly
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      
      // Check optimization query
      expect(mockDb.query).toHaveBeenNthCalledWith(1, expect.stringContaining('SET enable_seqscan = off'));
      
      // Check proximity query with correct parameters
      expect(mockDb.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('ST_DWithin'),
        [validMelbourneCoordinates.latitude, validMelbourneCoordinates.longitude, 1000, 10]
      );

      // Verify response structure
      expect(result).toMatchObject({
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
          averageDistance: 100, // (50 + 150) / 2
          searchTime: expect.any(Number)
        }
      });
    });

    it('should successfully analyze proximity with bearings enabled', async () => {
      const request: ProximityRequest = {
        coordinates: validMelbourneCoordinates,
        radius: 500,
        includeBearing: true
      };

      const result = await spatialService.analyzeProximity(request);

      // Verify bearings are included in results
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toHaveProperty('bearing');
      expect(result.results[1]).toHaveProperty('bearing');
      
      const firstResult = result.results[0];
      if (firstResult && firstResult.bearing !== undefined) {
        expect(typeof firstResult.bearing).toBe('number');
        expect(firstResult.bearing).toBeGreaterThanOrEqual(0);
        expect(firstResult.bearing).toBeLessThan(360);
      }
    });

    it('should resolve coordinates from address via geocoding', async () => {
      // Mock successful geocoding
      mockGeocodingService.geocodeAddress.mockResolvedValueOnce({
        success: true,
        coordinates: {
          latitude: validMelbourneCoordinates.latitude,
          longitude: validMelbourneCoordinates.longitude,
          coordinateSystem: 'WGS84',
          precision: 'PROPERTY',
          reliability: 1
        },
        confidence: 95,
        gnafPid: 'GAVIC411711443',
        components: undefined
      });

      const request: ProximityRequest = {
        address: '123 Collins Street Melbourne VIC',
        radius: 1000
      };

      const result = await spatialService.analyzeProximity(request);

      // Verify geocoding was called
      expect(mockGeocodingService.geocodeAddress).toHaveBeenCalledWith({ address: '123 Collins Street Melbourne VIC' });
      
      // Verify proximity query used geocoded coordinates
      expect(mockDb.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('ST_DWithin'),
        [validMelbourneCoordinates.latitude, validMelbourneCoordinates.longitude, 1000, 10]
      );

      expect(result.center).toEqual(validMelbourneCoordinates);
    });

    it('should apply parameter normalization correctly', async () => {
      const request: ProximityRequest = {
        coordinates: validMelbourneCoordinates,
        radius: 10000, // Exceeds max, should be capped
        limit: 100,    // Exceeds max, should be capped
      };

      await spatialService.analyzeProximity(request);

      // Verify parameters were normalized to max values
      expect(mockDb.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('ST_DWithin'),
        [
          validMelbourneCoordinates.latitude, 
          validMelbourneCoordinates.longitude, 
          SPATIAL_CONSTANTS.MAX_RADIUS_METERS, // Should be capped to 5000
          SPATIAL_CONSTANTS.MAX_PROXIMITY_LIMIT // Should be capped to 50
        ]
      );
    });

    it('should reject coordinates outside Australian territory', async () => {
      const invalidCoordinates = { latitude: 51.5074, longitude: -0.1278 }; // London

      const request: ProximityRequest = {
        coordinates: invalidCoordinates,
        radius: 1000
      };

      await expect(spatialService.analyzeProximity(request))
        .rejects
        .toThrow('Coordinates must be within Australian territory');
    });

    it('should handle geocoding failure gracefully', async () => {
      mockGeocodingService.geocodeAddress.mockResolvedValueOnce({
        success: false,
        coordinates: {
          latitude: 0,
          longitude: 0,
          coordinateSystem: 'WGS84',
          precision: 'LOCALITY',
          reliability: 3
        },
        confidence: 0,
        gnafPid: '',
        components: undefined
      });

      const request: ProximityRequest = {
        address: 'Invalid Address That Does Not Exist',
        radius: 1000
      };

      await expect(spatialService.analyzeProximity(request))
        .rejects
        .toThrow('Unable to geocode address: Invalid Address That Does Not Exist');
    });

    it('should require either coordinates or address', async () => {
      const request: ProximityRequest = {
        radius: 1000
      };

      await expect(spatialService.analyzeProximity(request))
        .rejects
        .toThrow('Either coordinates or address must be provided');
    });

    it('should handle database errors properly', async () => {
      // Reset all mocks and setup fresh error condition
      mockDb.query.mockReset();
      mockDb.query.mockRejectedValue(new Error('Connection timeout'));

      const request: ProximityRequest = {
        coordinates: validMelbourneCoordinates,
        radius: 1000
      };

      await expect(spatialService.analyzeProximity(request))
        .rejects
        .toThrow('Connection timeout');
    });
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      mockDb.query.mockReset();
    });

    it('should return healthy status when all checks pass', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ postgis_available: true }] }) // PostGIS check
        .mockResolvedValueOnce({ rows: [{ indexname: 'idx_addresses_geometry' }] }); // Index check

      const result = await spatialService.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.spatialExtensions).toBe(true);
      expect(result.indexHealth).toBe('healthy');
    });

    it('should return degraded status when PostGIS is missing', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ postgis_available: false }] }) // PostGIS missing
        .mockResolvedValueOnce({ rows: [{ indexname: 'idx_addresses_geometry' }] }); // Index OK

      const result = await spatialService.healthCheck();

      expect(result).toEqual({
        status: 'degraded',
        spatialExtensions: false,
        indexHealth: 'healthy'
      });
    });

    it('should return degraded status when spatial indexes are missing', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ postgis_available: true }] }) // PostGIS OK
        .mockResolvedValueOnce({ rows: [] }); // No spatial indexes

      const result = await spatialService.healthCheck();

      expect(result.status).toBe('degraded');
      expect(result.spatialExtensions).toBe(true);
      expect(result.indexHealth).toBe('missing');
    });

    it('should return unhealthy status on database error', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Database unavailable'));

      const result = await spatialService.healthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.spatialExtensions).toBe(false);
      expect(result.indexHealth).toBe('unknown');
    });
  });

  describe('performance monitoring', () => {
    it('should return default stats when no queries have been executed', () => {
      const freshService = new SpatialAnalyticsService();
      const stats = freshService.getPerformanceStats();

      expect(stats.totalQueries).toBeGreaterThanOrEqual(0);
      expect(stats.slowQueries).toBeGreaterThanOrEqual(0);
      expect(stats.spatialIndexUsage).toBeGreaterThanOrEqual(0);
      expect(stats.averageExecutionTime).toBeGreaterThanOrEqual(0);
    });
  });
});