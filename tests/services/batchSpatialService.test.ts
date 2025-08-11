/**
 * Batch Spatial Service Unit Tests
 * Tests for concurrent spatial operations processing
 */

import { BatchSpatialService } from '../../src/services/batchSpatialService';
import { spatialAnalyticsService } from '../../src/services/spatialAnalyticsService';
import { boundaryService } from '../../src/services/boundaryService';
import { statisticalAreaService } from '../../src/services/statisticalAreaService';
import { BatchSpatialRequest, BatchSpatialResponse } from '../../src/types/spatial';

// Mock dependencies
jest.mock('../../src/services/spatialAnalyticsService');
jest.mock('../../src/services/boundaryService');
jest.mock('../../src/services/statisticalAreaService');

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

const mockSpatialAnalyticsService = spatialAnalyticsService as jest.Mocked<typeof spatialAnalyticsService>;
const mockBoundaryService = boundaryService as jest.Mocked<typeof boundaryService>;
const mockStatisticalAreaService = statisticalAreaService as jest.Mocked<typeof statisticalAreaService>;

describe('BatchSpatialService', () => {
  let batchService: BatchSpatialService;

  beforeEach(() => {
    batchService = new BatchSpatialService();
    jest.clearAllMocks();
  });

  describe('processBatch', () => {
    const mockProximityResult = {
      center: { latitude: -37.8136, longitude: 144.9631 },
      radius: 1000,
      results: [],
      summary: { total: 0, averageDistance: 0, searchTime: 50 }
    };

    const mockBoundaryResult = {
      coordinates: { latitude: -37.8136, longitude: 144.9631 },
      boundaries: {
        locality: { name: 'Melbourne', pid: 'VIC2628', postcode: '3000' }
      }
    };

    const mockStatisticalResult = {
      coordinates: { latitude: -37.8136, longitude: 144.9631 },
      classification: {
        sa1: { code: '20663970002', name: 'SA1 20663970002' },
        sa2: { code: '206639700', name: 'SA2 206639700' },
        sa3: { code: '20663', name: 'VIC SA3 20663' },
        sa4: { code: '206', name: 'VIC SA4 206' }
      },
      hierarchy: {},
      metadata: { dataSource: 'G-NAF' as const, accuracy: 'EXACT' as const }
    };

    beforeEach(() => {
      // Mock successful service calls
      mockSpatialAnalyticsService.analyzeProximity.mockResolvedValue(mockProximityResult);
      mockBoundaryService.lookupBoundaries.mockResolvedValue(mockBoundaryResult);
      mockStatisticalAreaService.classifyStatisticalAreas.mockResolvedValue(mockStatisticalResult);
    });

    it('should successfully process mixed batch operations', async () => {
      const request: BatchSpatialRequest = {
        operations: [
          {
            id: 'prox-1',
            type: 'proximity',
            parameters: {
              coordinates: { latitude: -37.8136, longitude: 144.9631 },
              radius: 1000
            }
          },
          {
            id: 'boundary-1', 
            type: 'boundary',
            parameters: {
              coordinates: { latitude: -37.8136, longitude: 144.9631 }
            }
          },
          {
            id: 'stat-1',
            type: 'statistical',
            parameters: {
              coordinates: { latitude: -37.8136, longitude: 144.9631 }
            }
          }
        ],
        options: {
          batchSize: 10,
          failFast: false
        }
      };

      const result = await batchService.processBatch(request);

      // Verify all services were called
      expect(mockSpatialAnalyticsService.analyzeProximity).toHaveBeenCalledWith(request.operations[0]!.parameters);
      expect(mockBoundaryService.lookupBoundaries).toHaveBeenCalledWith(request.operations[1]!.parameters);
      expect(mockStatisticalAreaService.classifyStatisticalAreas).toHaveBeenCalledWith(request.operations[2]!.parameters);

      // Verify response structure
      expect(result).toMatchObject({
        results: [
          {
            id: 'prox-1',
            type: 'proximity',
            status: 'success',
            data: mockProximityResult
          },
          {
            id: 'boundary-1',
            type: 'boundary', 
            status: 'success',
            data: mockBoundaryResult
          },
          {
            id: 'stat-1',
            type: 'statistical',
            status: 'success',
            data: mockStatisticalResult
          }
        ],
        summary: {
          total: 3,
          successful: 3,
          failed: 0,
          processingTime: expect.any(Number),
          batchSize: expect.any(Number)
        }
      });
    });

    it('should handle batch operations with default batch size', async () => {
      const request: BatchSpatialRequest = {
        operations: [
          {
            id: 'prox-1',
            type: 'proximity',
            parameters: {
              coordinates: { latitude: -37.8136, longitude: 144.9631 },
              radius: 1000
            }
          }
        ]
        // No options specified
      };

      const result = await batchService.processBatch(request);

      expect(result.summary.batchSize).toBeGreaterThan(0);
      expect(result.summary.successful).toBe(1);
      expect(result.summary.failed).toBe(0);
    });

    it('should handle individual operation failures gracefully', async () => {
      // Mock one operation to fail
      mockSpatialAnalyticsService.analyzeProximity.mockResolvedValue(mockProximityResult);
      mockBoundaryService.lookupBoundaries.mockRejectedValue(new Error('Boundary lookup failed'));
      mockStatisticalAreaService.classifyStatisticalAreas.mockResolvedValue(mockStatisticalResult);

      const request: BatchSpatialRequest = {
        operations: [
          {
            id: 'prox-1',
            type: 'proximity',
            parameters: {
              coordinates: { latitude: -37.8136, longitude: 144.9631 },
              radius: 1000
            }
          },
          {
            id: 'boundary-1',
            type: 'boundary',
            parameters: {
              coordinates: { latitude: -37.8136, longitude: 144.9631 }
            }
          },
          {
            id: 'stat-1',
            type: 'statistical',
            parameters: {
              coordinates: { latitude: -37.8136, longitude: 144.9631 }
            }
          }
        ],
        options: {
          failFast: false
        }
      };

      const result = await batchService.processBatch(request);

      // Verify partial success
      expect(result.summary.total).toBe(3);
      expect(result.summary.successful).toBe(2);
      expect(result.summary.failed).toBe(1);

      // Verify failed operation result
      const failedResult = result.results.find(r => r.id === 'boundary-1');
      expect(failedResult).toMatchObject({
        id: 'boundary-1',
        type: 'boundary',
        status: 'error',
        error: 'Boundary lookup failed'
      });

      // Verify successful operations still completed
      const successfulResults = result.results.filter(r => r.status === 'success');
      expect(successfulResults).toHaveLength(2);
    });

    it('should implement fail-fast behavior when enabled', async () => {
      // Mock first operation to fail
      mockSpatialAnalyticsService.analyzeProximity.mockRejectedValue(new Error('First operation failed'));
      mockBoundaryService.lookupBoundaries.mockResolvedValue(mockBoundaryResult);

      const request: BatchSpatialRequest = {
        operations: [
          {
            id: 'prox-1',
            type: 'proximity',
            parameters: {
              coordinates: { latitude: -37.8136, longitude: 144.9631 },
              radius: 1000
            }
          },
          {
            id: 'boundary-1',
            type: 'boundary',
            parameters: {
              coordinates: { latitude: -37.8136, longitude: 144.9631 }
            }
          }
        ],
        options: {
          batchSize: 1, // Process one at a time to test fail-fast
          failFast: true
        }
      };

      const result = await batchService.processBatch(request);

      // Verify only first batch processed due to fail-fast
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.status).toBe('error');
      expect(result.summary.failed).toBe(1);
      expect(result.summary.successful).toBe(0);

      // Verify second operation was not attempted
      expect(mockBoundaryService.lookupBoundaries).not.toHaveBeenCalled();
    });

    it('should handle unsupported operation types', async () => {
      const request: BatchSpatialRequest = {
        operations: [
          {
            id: 'invalid-1',
            type: 'unsupported' as any,
            parameters: {}
          }
        ]
      };

      const result = await batchService.processBatch(request);

      expect(result.summary.failed).toBe(1);
      expect(result.results[0]).toMatchObject({
        id: 'invalid-1',
        type: 'unsupported',
        status: 'error',
        error: 'Unsupported operation type: unsupported'
      });
    });

    it('should handle large batch sizes correctly', async () => {
      // Create 25 operations
      const operations = Array.from({ length: 25 }, (_, i) => ({
        id: `prox-${i}`,
        type: 'proximity' as const,
        parameters: {
          coordinates: { latitude: -37.8136, longitude: 144.9631 },
          radius: 1000
        }
      }));

      const request: BatchSpatialRequest = {
        operations,
        options: {
          batchSize: 10
        }
      };

      const result = await batchService.processBatch(request);

      expect(result.summary.total).toBe(25);
      expect(result.summary.successful).toBe(25);
      expect(result.summary.batchSize).toBe(10);
      expect(mockSpatialAnalyticsService.analyzeProximity).toHaveBeenCalledTimes(25);
    });

    it('should respect batch size limits', async () => {
      const operations = Array.from({ length: 5 }, (_, i) => ({
        id: `prox-${i}`,
        type: 'proximity' as const,
        parameters: {
          coordinates: { latitude: -37.8136, longitude: 144.9631 },
          radius: 1000
        }
      }));

      const request: BatchSpatialRequest = {
        operations,
        options: {
          batchSize: 100 // Exceeds max, should be capped
        }
      };

      const result = await batchService.processBatch(request);

      // Batch size should be capped at operation count or max limit
      expect(result.summary.batchSize).toBeLessThanOrEqual(50);
      expect(result.summary.batchSize).toBeLessThanOrEqual(operations.length);
    });
  });

  describe('getActiveJobs', () => {
    it('should return empty array when no active jobs', () => {
      const activeJobs = batchService.getActiveJobs();
      expect(activeJobs).toEqual([]);
    });
  });

  describe('getProcessingStats', () => {
    it('should return default stats when no active jobs', () => {
      const stats = batchService.getProcessingStats();
      
      expect(stats).toEqual({
        activeJobs: 0,
        totalOperationsInProgress: 0,
        averageBatchDuration: 0
      });
    });
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      // Mock health checks for all services
      mockSpatialAnalyticsService.healthCheck.mockResolvedValue({
        status: 'healthy',
        spatialExtensions: true,
        indexHealth: 'healthy'
      });

      mockBoundaryService.healthCheck.mockResolvedValue({
        status: 'healthy',
        localityData: true,
        cacheHealth: 'healthy'
      });

      mockStatisticalAreaService.healthCheck.mockResolvedValue({
        status: 'healthy',
        statisticalData: true,
        meshBlockData: true
      });
    });

    it('should return healthy status when all services are healthy', async () => {
      const result = await batchService.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.activeJobs).toBe(0);
      expect(result.servicesAvailable).toEqual({
        proximity: true,
        boundary: true,
        statistical: true
      });
    });

    it('should return degraded status when some services are unhealthy', async () => {
      mockBoundaryService.healthCheck.mockResolvedValue({
        status: 'unhealthy',
        localityData: false,
        cacheHealth: 'unknown'
      });

      const result = await batchService.healthCheck();

      expect(result.status).toBe('degraded');
      expect(result.servicesAvailable).toEqual({
        proximity: true,
        boundary: false,
        statistical: true
      });
    });

    it('should return unhealthy status when all services are unavailable', async () => {
      mockSpatialAnalyticsService.healthCheck.mockResolvedValue({
        status: 'unhealthy',
        spatialExtensions: false,
        indexHealth: 'missing'
      });

      mockBoundaryService.healthCheck.mockResolvedValue({
        status: 'unhealthy',
        localityData: false,
        cacheHealth: 'unknown'
      });

      mockStatisticalAreaService.healthCheck.mockResolvedValue({
        status: 'unhealthy',
        statisticalData: false,
        meshBlockData: false
      });

      const result = await batchService.healthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.servicesAvailable).toEqual({
        proximity: false,
        boundary: false,
        statistical: false
      });
    });

    it('should return unhealthy status on health check error', async () => {
      mockSpatialAnalyticsService.healthCheck.mockRejectedValue(new Error('Health check failed'));

      const result = await batchService.healthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.activeJobs).toBe(0);
      expect(result.servicesAvailable).toEqual({
        proximity: false,
        boundary: false,
        statistical: false
      });
    });
  });
});