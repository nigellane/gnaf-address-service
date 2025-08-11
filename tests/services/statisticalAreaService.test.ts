/**
 * Statistical Area Service Unit Tests
 * Tests for ABS statistical area classification functionality
 */

import { StatisticalAreaService } from '../../src/services/statisticalAreaService';
import { DatabaseManager } from '../../src/config/database';
import { geocodingService } from '../../src/services/geocodingService';
import { StatisticalAreaRequest, StatisticalAreaResponse } from '../../src/types/spatial';

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

describe('StatisticalAreaService', () => {
  let statisticalService: StatisticalAreaService;

  beforeAll(() => {
    // Mock DatabaseManager.getInstance
    (DatabaseManager.getInstance as jest.Mock).mockReturnValue(mockDb);
  });

  beforeEach(() => {
    statisticalService = new StatisticalAreaService();
    jest.clearAllMocks();
    mockDb.query.mockClear();
  });

  describe('classifyStatisticalAreas', () => {
    const validMelbourneCoordinates = { latitude: -37.8136, longitude: 144.9631 };
    
    const mockStatisticalResult = {
      rows: [{
        mesh_block_code: '20663970000',
        statistical_area_1: '20663970002',
        statistical_area_2: '206639700',
        locality_pid: 'VIC2628'
      }]
    };

    beforeEach(() => {
      // Mock successful optimization and statistical queries
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // optimization query
        .mockResolvedValueOnce(mockStatisticalResult); // statistical query
    });

    it('should successfully classify statistical areas with coordinates', async () => {
      const request: StatisticalAreaRequest = {
        coordinates: validMelbourneCoordinates,
        includeHierarchy: true
      };

      const result = await statisticalService.classifyStatisticalAreas(request);

      // Verify database queries were called correctly
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      
      // Check optimization query
      expect(mockDb.query).toHaveBeenNthCalledWith(1, expect.stringContaining('SET enable_seqscan = off'));
      
      // Check statistical query with correct parameters
      expect(mockDb.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('statistical_area_1'),
        [validMelbourneCoordinates.latitude, validMelbourneCoordinates.longitude]
      );

      // Verify response structure
      expect(result).toMatchObject({
        coordinates: validMelbourneCoordinates,
        classification: {
          sa1: {
            code: '20663970002',
            name: 'SA1 20663970002'
          },
          sa2: {
            code: '206639700',
            name: 'SA2 206639700'
          },
          sa3: {
            code: '20663',
            name: 'VIC SA3 20663'
          },
          sa4: {
            code: '206',
            name: 'VIC SA4 206'
          }
        },
        hierarchy: {
          meshBlock: '20663970000',
          censusCollectionDistrict: '20663970'
        },
        metadata: {
          dataSource: 'G-NAF',
          accuracy: 'EXACT'
        }
      });
    });

    it('should successfully classify statistical areas without hierarchy', async () => {
      const request: StatisticalAreaRequest = {
        coordinates: validMelbourneCoordinates,
        includeHierarchy: false
      };

      const result = await statisticalService.classifyStatisticalAreas(request);

      // Verify hierarchy is empty
      expect(result.hierarchy).toEqual({});
      
      // Verify other fields are still included
      expect(result.classification).toBeDefined();
      expect(result.metadata).toBeDefined();
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

      const request: StatisticalAreaRequest = {
        address: '123 Collins Street Melbourne VIC',
        includeHierarchy: true
      };

      const result = await statisticalService.classifyStatisticalAreas(request);

      // Verify geocoding was called
      expect(mockGeocodingService.geocodeAddress).toHaveBeenCalledWith({ address: '123 Collins Street Melbourne VIC' });
      
      // Verify statistical query used geocoded coordinates
      expect(mockDb.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('statistical_area_1'),
        [validMelbourneCoordinates.latitude, validMelbourneCoordinates.longitude]
      );

      expect(result.coordinates).toEqual(validMelbourneCoordinates);
    });

    it('should handle state code derivation correctly', async () => {
      const testCases = [
        { sa2: '101234567', expectedSA3: '10123', expectedSA4: '101', expectedState: 'NSW' },
        { sa2: '201234567', expectedSA3: '20123', expectedSA4: '201', expectedState: 'VIC' },
        { sa2: '301234567', expectedSA3: '30123', expectedSA4: '301', expectedState: 'QLD' },
        { sa2: '401234567', expectedSA3: '40123', expectedSA4: '401', expectedState: 'SA' },
        { sa2: '501234567', expectedSA3: '50123', expectedSA4: '501', expectedState: 'WA' },
        { sa2: '601234567', expectedSA3: '60123', expectedSA4: '601', expectedState: 'TAS' },
        { sa2: '701234567', expectedSA3: '70123', expectedSA4: '701', expectedState: 'NT' },
        { sa2: '801234567', expectedSA3: '80123', expectedSA4: '801', expectedState: 'ACT' }
      ];

      for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i]!;
        
        mockDb.query.mockReset();
        mockDb.query
          .mockResolvedValueOnce({ rows: [] }) // optimization query
          .mockResolvedValueOnce({ 
            rows: [{
              mesh_block_code: '12345670000',
              statistical_area_1: '12345670002',
              statistical_area_2: testCase.sa2,
              locality_pid: 'TEST123'
            }]
          });

        const request: StatisticalAreaRequest = {
          coordinates: { 
            latitude: validMelbourneCoordinates.latitude + (i * 0.001),
            longitude: validMelbourneCoordinates.longitude + (i * 0.001)
          },
          includeHierarchy: true
        };

        const result = await statisticalService.classifyStatisticalAreas(request);

        expect(result.classification.sa2.code).toBe(testCase.sa2);
        expect(result.classification.sa3.code).toBe(testCase.expectedSA3);
        expect(result.classification.sa4.code).toBe(testCase.expectedSA4);
        expect(result.classification.sa3.name).toContain(testCase.expectedState);
        expect(result.classification.sa4.name).toContain(testCase.expectedState);
      }
    });

    it('should handle missing statistical area data gracefully', async () => {
      const testCases = [
        { 
          mockData: { mesh_block_code: null, statistical_area_1: null, statistical_area_2: null },
          expected: { sa1: 'Unknown', sa2: 'Unknown', sa3: 'Unknown', sa4: 'Unknown' }
        },
        {
          mockData: { mesh_block_code: '12345', statistical_area_1: '123', statistical_area_2: null },
          expected: { sa1: '123', sa2: 'Unknown', sa3: 'Unknown', sa4: 'Unknown' }
        }
      ];

      for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i]!;
        
        mockDb.query.mockReset();
        mockDb.query
          .mockResolvedValueOnce({ rows: [] }) // optimization query
          .mockResolvedValueOnce({ rows: [{ locality_pid: 'TEST123', ...testCase.mockData }] });

        const request: StatisticalAreaRequest = {
          coordinates: { 
            latitude: validMelbourneCoordinates.latitude + (i * 0.002),
            longitude: validMelbourneCoordinates.longitude + (i * 0.002)
          }
        };

        const result = await statisticalService.classifyStatisticalAreas(request);

        expect(result.classification.sa1.code).toBe(testCase.expected.sa1);
        expect(result.classification.sa2.code).toBe(testCase.expected.sa2);
        expect(result.classification.sa3.code).toBe(testCase.expected.sa3);
        expect(result.classification.sa4.code).toBe(testCase.expected.sa4);
      }
    });

    it('should reject coordinates outside Australian territory', async () => {
      const invalidCoordinates = { latitude: 51.5074, longitude: -0.1278 }; // London

      const request: StatisticalAreaRequest = {
        coordinates: invalidCoordinates
      };

      await expect(statisticalService.classifyStatisticalAreas(request))
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

      const request: StatisticalAreaRequest = {
        address: 'Invalid Address That Does Not Exist'
      };

      await expect(statisticalService.classifyStatisticalAreas(request))
        .rejects
        .toThrow('Unable to geocode address: Invalid Address That Does Not Exist');
    });

    it('should require either coordinates or address', async () => {
      const request: StatisticalAreaRequest = {};

      await expect(statisticalService.classifyStatisticalAreas(request))
        .rejects
        .toThrow('Either coordinates or address must be provided');
    });

    it('should handle no statistical area data found', async () => {
      // Mock no statistical data found
      mockDb.query.mockReset();
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // optimization query
        .mockResolvedValueOnce({ rows: [] }); // statistical query - no results

      const request: StatisticalAreaRequest = {
        coordinates: validMelbourneCoordinates
      };

      await expect(statisticalService.classifyStatisticalAreas(request))
        .rejects
        .toThrow('No statistical area data found for coordinates');
    });

    it('should handle database errors properly', async () => {
      // Reset all mocks and setup fresh error condition
      mockDb.query.mockReset();
      mockDb.query.mockRejectedValue(new Error('Connection timeout'));

      const request: StatisticalAreaRequest = {
        coordinates: validMelbourneCoordinates
      };

      await expect(statisticalService.classifyStatisticalAreas(request))
        .rejects
        .toThrow('Connection timeout');
    });
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      mockDb.query.mockReset();
    });

    it('should return healthy status when statistical data is available', async () => {
      mockDb.query.mockResolvedValueOnce({ 
        rows: [{
          mesh_block_code: '20663970000',
          statistical_area_1: '20663970002',
          statistical_area_2: '206639700',
          locality_pid: 'VIC2628'
        }]
      });

      const result = await statisticalService.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.statisticalData).toBe(true);
      expect(result.meshBlockData).toBe(true);
    });

    it('should return healthy status with missing mesh block data', async () => {
      mockDb.query.mockResolvedValueOnce({ 
        rows: [{
          mesh_block_code: null,
          statistical_area_1: '20663970002',
          statistical_area_2: '206639700',
          locality_pid: 'VIC2628'
        }]
      });

      const result = await statisticalService.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.statisticalData).toBe(true);
      expect(result.meshBlockData).toBe(false);
    });

    it('should return degraded status when no statistical data found', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const result = await statisticalService.healthCheck();

      expect(result.status).toBe('degraded');
      expect(result.statisticalData).toBe(false);
      expect(result.meshBlockData).toBe(false);
    });

    it('should return unhealthy status on database error', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Database unavailable'));

      const result = await statisticalService.healthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.statisticalData).toBe(false);
      expect(result.meshBlockData).toBe(false);
    });
  });
});