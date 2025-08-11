/**
 * Boundary Service Unit Tests
 * Tests for administrative boundary lookup functionality
 */

import { BoundaryService } from '../../src/services/boundaryService';
import { DatabaseManager } from '../../src/config/database';
import { BoundaryLookupParams, BoundaryResponse, SPATIAL_CONSTANTS } from '../../src/types/spatial';

// Mock dependencies
jest.mock('../../src/config/database');

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

describe('BoundaryService', () => {
  let boundaryService: BoundaryService;

  beforeAll(() => {
    // Mock DatabaseManager.getInstance
    (DatabaseManager.getInstance as jest.Mock).mockReturnValue(mockDb);
  });

  beforeEach(() => {
    boundaryService = new BoundaryService();
    jest.clearAllMocks();
    mockDb.query.mockClear();
  });

  describe('lookupBoundaries', () => {
    const validMelbourneCoordinates = { latitude: -37.8136, longitude: 144.9631 };
    
    const mockLocalityResult = {
      rows: [{
        locality_name: 'Melbourne',
        locality_pid: 'VIC2628',
        postcode: '3000',
        local_government_area: 'City of Melbourne'
      }]
    };

    beforeEach(() => {
      // Mock successful optimization and boundary queries
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // optimization query
        .mockResolvedValueOnce(mockLocalityResult); // boundary query
    });

    it('should successfully lookup boundaries with default options', async () => {
      const request: BoundaryLookupParams = {
        coordinates: validMelbourneCoordinates
      };

      const result = await boundaryService.lookupBoundaries(request);

      // Verify database queries were called correctly
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      
      // Check optimization query
      expect(mockDb.query).toHaveBeenNthCalledWith(1, expect.stringContaining('SET enable_seqscan = off'));
      
      // Check boundary query with correct parameters
      expect(mockDb.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('ST_Contains'),
        [validMelbourneCoordinates.latitude, validMelbourneCoordinates.longitude]
      );

      // Verify response structure
      expect(result).toMatchObject({
        coordinates: validMelbourneCoordinates,
        boundaries: {
          locality: {
            name: 'Melbourne',
            pid: 'VIC2628',
            postcode: '3000'
          },
          localGovernmentArea: {
            name: 'City of Melbourne',
            category: 'City'
          },
          postalArea: {
            postcode: '3000',
            deliveryOffice: 'VIC'
          }
        }
      });
    });

    it('should successfully lookup boundaries with LGA disabled', async () => {
      const request: BoundaryLookupParams = {
        coordinates: validMelbourneCoordinates,
        includeLGA: false
      };

      const result = await boundaryService.lookupBoundaries(request);

      // Verify LGA is not included
      expect(result.boundaries.localGovernmentArea).toBeUndefined();
      
      // Verify locality and postal are still included
      expect(result.boundaries.locality).toBeDefined();
      expect(result.boundaries.postalArea).toBeDefined();
    });

    it('should successfully lookup boundaries with postal disabled', async () => {
      const request: BoundaryLookupParams = {
        coordinates: validMelbourneCoordinates,
        includePostal: false
      };

      const result = await boundaryService.lookupBoundaries(request);

      // Verify postal area is not included
      expect(result.boundaries.postalArea).toBeUndefined();
      
      // Verify locality and LGA are still included
      expect(result.boundaries.locality).toBeDefined();
      expect(result.boundaries.localGovernmentArea).toBeDefined();
    });

    it('should handle electoral district requests', async () => {
      const request: BoundaryLookupParams = {
        coordinates: validMelbourneCoordinates,
        includeElectoral: true
      };

      const result = await boundaryService.lookupBoundaries(request);

      // Electoral districts should be undefined (not implemented with available data)
      expect(result.boundaries.electoralDistrict).toBeUndefined();
    });

    it('should extract LGA categories correctly', async () => {
      const testCases = [
        { lga: 'City of Sydney', expectedCategory: 'City' },
        { lga: 'Ballarat Shire', expectedCategory: 'Shire' },
        { lga: 'Town of Walkerville', expectedCategory: 'Town' },
        { lga: 'Unley Council', expectedCategory: 'Council' }
      ];

      for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i]!;
        
        // Clear cache and reset mocks
        boundaryService.clearCache();
        mockDb.query.mockReset();
        mockDb.query
          .mockResolvedValueOnce({ rows: [] }) // optimization query
          .mockResolvedValueOnce({ 
            rows: [{
              locality_name: 'Test Location',
              locality_pid: 'TEST123',
              postcode: '5000',
              local_government_area: testCase.lga
            }]
          });

        const request: BoundaryLookupParams = {
          coordinates: { 
            latitude: validMelbourneCoordinates.latitude + (i * 0.001), // Slightly different coordinates to avoid cache
            longitude: validMelbourneCoordinates.longitude + (i * 0.001)
          }
        };

        const result = await boundaryService.lookupBoundaries(request);

        expect(result.boundaries.localGovernmentArea?.category).toBe(testCase.expectedCategory);
      }
    });

    it('should handle delivery office mapping correctly', async () => {
      const testCases = [
        { postcode: '2000', expectedState: 'NSW' }, // NSW
        { postcode: '3000', expectedState: 'VIC' }, // VIC
        { postcode: '4000', expectedState: 'QLD' }, // QLD
        { postcode: '5000', expectedState: 'SA' },  // SA
        { postcode: '6000', expectedState: 'WA' },  // WA
        { postcode: '7000', expectedState: 'TAS' }, // TAS
        { postcode: '0800', expectedState: 'NT' },  // NT
        { postcode: '0200', expectedState: 'ACT' }  // ACT
      ];

      for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i]!;
        
        // Clear cache and reset mocks
        boundaryService.clearCache();
        mockDb.query.mockReset();
        mockDb.query
          .mockResolvedValueOnce({ rows: [] }) // optimization query
          .mockResolvedValueOnce({ 
            rows: [{
              locality_name: 'Test Location',
              locality_pid: 'TEST123',
              postcode: testCase.postcode,
              local_government_area: 'Test Council'
            }]
          });

        const request: BoundaryLookupParams = {
          coordinates: { 
            latitude: validMelbourneCoordinates.latitude + (i * 0.002), // Different coordinates to avoid cache
            longitude: validMelbourneCoordinates.longitude + (i * 0.002)
          },
          includePostal: true
        };

        const result = await boundaryService.lookupBoundaries(request);

        expect(result.boundaries.postalArea?.deliveryOffice).toBe(testCase.expectedState);
      }
    });

    it('should reject coordinates outside Australian territory', async () => {
      const invalidCoordinates = { latitude: 51.5074, longitude: -0.1278 }; // London

      const request: BoundaryLookupParams = {
        coordinates: invalidCoordinates
      };

      await expect(boundaryService.lookupBoundaries(request))
        .rejects
        .toThrow('Coordinates must be within Australian territory');
    });

    it('should handle locality not found', async () => {
      // Mock no locality found
      mockDb.query.mockReset();
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // optimization query
        .mockResolvedValueOnce({ rows: [] }); // boundary query - no results

      const request: BoundaryLookupParams = {
        coordinates: validMelbourneCoordinates
      };

      await expect(boundaryService.lookupBoundaries(request))
        .rejects
        .toThrow('No locality found for coordinates');
    });

    it('should handle database errors properly', async () => {
      // Reset all mocks and setup fresh error condition
      mockDb.query.mockReset();
      mockDb.query.mockRejectedValue(new Error('Connection timeout'));

      const request: BoundaryLookupParams = {
        coordinates: validMelbourneCoordinates
      };

      await expect(boundaryService.lookupBoundaries(request))
        .rejects
        .toThrow('Connection timeout');
    });

    it('should cache boundary results', async () => {
      const request: BoundaryLookupParams = {
        coordinates: validMelbourneCoordinates
      };

      // First call
      const result1 = await boundaryService.lookupBoundaries(request);
      
      // Second call (should use cache)
      const result2 = await boundaryService.lookupBoundaries(request);

      // Verify database was only called once (for the first request)
      expect(mockDb.query).toHaveBeenCalledTimes(2); // optimization + boundary query

      // Results should be identical
      expect(result1).toEqual(result2);
    });
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      mockDb.query.mockReset();
    });

    it('should return healthy status when locality data is available', async () => {
      mockDb.query.mockResolvedValueOnce({ 
        rows: [{
          locality_name: 'Melbourne',
          locality_pid: 'VIC2628',
          postcode: '3000',
          local_government_area: 'City of Melbourne'
        }]
      });

      const result = await boundaryService.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.localityData).toBe(true);
      expect(result.cacheHealth).toBe('healthy');
    });

    it('should return degraded status when no locality data found', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const result = await boundaryService.healthCheck();

      expect(result.status).toBe('degraded');
      expect(result.localityData).toBe(false);
      expect(result.cacheHealth).toBe('healthy');
    });

    it('should return unhealthy status on database error', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Database unavailable'));

      const result = await boundaryService.healthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.localityData).toBe(false);
      expect(result.cacheHealth).toBe('unknown');
    });
  });

  describe('cache management', () => {
    beforeEach(() => {
      // Reset cache
      boundaryService.clearCache();
    });

    it('should clear cache correctly', () => {
      boundaryService.clearCache();
      const stats = boundaryService.getCacheStats();
      
      expect(stats.size).toBe(0);
    });

    it('should return cache statistics', () => {
      const stats = boundaryService.getCacheStats();
      
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('hitRate');
      expect(typeof stats.size).toBe('number');
      expect(typeof stats.hitRate).toBe('number');
    });
  });
});