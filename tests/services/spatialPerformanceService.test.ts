/**
 * Spatial Performance Service Unit Tests
 * Tests for spatial query optimization and performance monitoring
 */

import { SpatialPerformanceService } from '../../src/services/spatialPerformanceService';
import { DatabaseManager } from '../../src/config/database';

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

describe('SpatialPerformanceService', () => {
  let performanceService: SpatialPerformanceService;

  beforeAll(() => {
    // Mock DatabaseManager.getInstance
    (DatabaseManager.getInstance as jest.Mock).mockReturnValue(mockDb);
  });

  beforeEach(() => {
    performanceService = new SpatialPerformanceService();
    jest.clearAllMocks();
    mockDb.query.mockClear();
  });

  describe('initializeAdvancedIndexing', () => {
    beforeEach(() => {
      // Mock successful index creation queries
      mockDb.query.mockResolvedValue({ rows: [] });
    });

    it('should successfully initialize all advanced indexes', async () => {
      const results = await performanceService.initializeAdvancedIndexing();

      // Verify all index operations were attempted
      expect(results).toHaveLength(6); // Number of index operations in getAdvancedIndexQueries
      
      // Verify all operations succeeded
      const successfulOperations = results.filter(r => r.success);
      expect(successfulOperations).toHaveLength(6);

      // Verify database queries were called
      expect(mockDb.query).toHaveBeenCalledTimes(6);

      // Verify operation names
      const operationNames = results.map(r => r.operation);
      expect(operationNames).toContain('clusterAddresses');
      expect(operationNames).toContain('createLocalityGeomIndex');
      expect(operationNames).toContain('analyzeAddresses');
      expect(operationNames).toContain('createActiveAddressesIndex');
      expect(operationNames).toContain('vacuumAddresses');
      expect(operationNames).toContain('createStatisticalIndex');
    });

    it('should handle individual index operation failures gracefully', async () => {
      // Mock one operation to fail
      let callCount = 0;
      mockDb.query.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.reject(new Error('Index creation failed'));
        }
        return Promise.resolve({ rows: [] });
      });

      const results = await performanceService.initializeAdvancedIndexing();

      expect(results).toHaveLength(6);
      
      const successfulOperations = results.filter(r => r.success);
      const failedOperations = results.filter(r => !r.success);
      
      expect(successfulOperations).toHaveLength(5);
      expect(failedOperations).toHaveLength(1);
      expect(failedOperations[0]!.error).toBe('Index creation failed');
    });

    it('should include execution times for all operations', async () => {
      const results = await performanceService.initializeAdvancedIndexing();

      results.forEach(result => {
        expect(result.executionTime).toBeGreaterThanOrEqual(0);
        expect(typeof result.executionTime).toBe('number');
      });
    });
  });

  describe('generatePerformanceReport', () => {
    const mockIndexUsageResult = {
      rows: [
        {
          schemaname: 'gnaf',
          tablename: 'addresses',
          indexname: 'idx_addresses_geometry',
          idx_tup_read: '1000',
          idx_tup_fetch: '500'
        }
      ]
    };

    const mockSlowQueriesResult = {
      rows: [
        {
          query: 'SELECT * FROM gnaf.addresses WHERE ST_DWithin(...)',
          calls: '10',
          total_time: '500.5',
          mean_time: '50.05',
          rows: '100'
        }
      ]
    };

    const mockTableBloatResult = {
      rows: [
        {
          schemaname: 'gnaf',
          tablename: 'addresses',
          size: '100 MB',
          table_size: '80 MB',
          index_size: '20 MB'
        }
      ]
    };

    const mockPostgisInfoResult = {
      rows: [
        {
          name: 'postgis',
          default_version: '3.4',
          installed_version: '3.4.0'
        }
      ]
    };

    beforeEach(() => {
      mockDb.query
        .mockResolvedValueOnce(mockIndexUsageResult)
        .mockResolvedValueOnce(mockSlowQueriesResult)
        .mockResolvedValueOnce(mockTableBloatResult)
        .mockResolvedValueOnce(mockPostgisInfoResult);
    });

    it('should generate a comprehensive performance report', async () => {
      const report = await performanceService.generatePerformanceReport();

      expect(report).toMatchObject({
        timestamp: expect.any(String),
        spatialIndexUsage: [
          {
            schemaname: 'gnaf',
            tablename: 'addresses',
            indexname: 'idx_addresses_geometry',
            reads: 1000,
            fetches: 500
          }
        ],
        slowQueries: [
          {
            query: 'SELECT * FROM gnaf.addresses WHERE ST_DWithin(...)',
            calls: 10,
            totalTime: 500.5,
            meanTime: 50.05,
            rows: 100
          }
        ],
        tableSizes: [
          {
            schemaname: 'gnaf',
            tablename: 'addresses',
            totalSize: '100 MB',
            tableSize: '80 MB',
            indexSize: '20 MB'
          }
        ],
        postgisInfo: [
          {
            name: 'postgis',
            defaultVersion: '3.4',
            installedVersion: '3.4.0'
          }
        ]
      });
    });

    it('should handle missing pg_stat_statements gracefully', async () => {
      // Reset mocks and make slow queries fail
      mockDb.query.mockReset();
      mockDb.query
        .mockResolvedValueOnce(mockIndexUsageResult)
        .mockRejectedValueOnce(new Error('pg_stat_statements not enabled'))
        .mockResolvedValueOnce(mockTableBloatResult)
        .mockResolvedValueOnce(mockPostgisInfoResult);

      const report = await performanceService.generatePerformanceReport();

      expect(report.slowQueries).toEqual([]);
      expect(report.spatialIndexUsage).toHaveLength(1);
      expect(report.tableSizes).toHaveLength(1);
      expect(report.postgisInfo).toHaveLength(1);
    });
  });

  describe('optimizeConnectionPool', () => {
    it('should successfully optimize connection pool settings', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await performanceService.optimizeConnectionPool();

      expect(result.success).toBe(true);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();

      // Verify optimization query was called
      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('SET shared_preload_libraries'));
    });

    it('should handle connection pool optimization failures', async () => {
      mockDb.query.mockRejectedValue(new Error('Permission denied'));

      const result = await performanceService.optimizeConnectionPool();

      expect(result.success).toBe(false);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(result.error).toBe('Permission denied');
    });
  });

  describe('analyzeSpatialClustering', () => {
    const mockClusteringResult = {
      rows: [
        {
          cluster_id: 1,
          gnaf_pid: 'GAVIC411711441',
          formatted_address: '123 Collins Street, Melbourne VIC 3000',
          latitude: '-37.8140',
          longitude: '144.9630'
        },
        {
          cluster_id: 1,
          gnaf_pid: 'GAVIC411711442',
          formatted_address: '456 Collins Street, Melbourne VIC 3000', 
          latitude: '-37.8150',
          longitude: '144.9640'
        },
        {
          cluster_id: null,
          gnaf_pid: 'GAVIC411711443',
          formatted_address: '789 Remote Street, Melbourne VIC 3000',
          latitude: '-37.9000',
          longitude: '145.0000'
        }
      ]
    };

    beforeEach(() => {
      mockDb.query.mockResolvedValue(mockClusteringResult);
    });

    it('should successfully analyze spatial clustering', async () => {
      const result = await performanceService.analyzeSpatialClustering();

      expect(result).toMatchObject({
        totalClusters: 1,
        unclusteredAddresses: 1,
        clusters: [
          {
            clusterId: 1,
            addressCount: 2,
            sampleAddresses: [
              {
                gnafPid: 'GAVIC411711441',
                address: '123 Collins Street, Melbourne VIC 3000',
                coordinates: { latitude: -37.8140, longitude: 144.9630 }
              },
              {
                gnafPid: 'GAVIC411711442',
                address: '456 Collins Street, Melbourne VIC 3000',
                coordinates: { latitude: -37.8150, longitude: 144.9640 }
              }
            ]
          }
        ]
      });
    });

    it('should handle empty clustering results', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await performanceService.analyzeSpatialClustering();

      expect(result).toEqual({
        totalClusters: 0,
        unclusteredAddresses: 0,
        clusters: []
      });
    });

    it('should use custom table name when provided', async () => {
      await performanceService.analyzeSpatialClustering('custom.addresses');

      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('FROM custom.addresses'));
    });
  });

  describe('runPerformanceBenchmark', () => {
    beforeEach(() => {
      // Mock query responses with slight delays
      mockDb.query.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ rows: [] }), 10))
      );
    });

    it('should run comprehensive performance benchmarks', async () => {
      const result = await performanceService.runPerformanceBenchmark();

      expect(result).toMatchObject({
        proximityQueryBenchmark: {
          averageTime: expect.any(Number),
          maxTime: expect.any(Number),
          minTime: expect.any(Number),
          iterations: expect.any(Number)
        },
        boundaryQueryBenchmark: {
          averageTime: expect.any(Number),
          maxTime: expect.any(Number),
          minTime: expect.any(Number),
          iterations: expect.any(Number)
        },
        statisticalQueryBenchmark: {
          averageTime: expect.any(Number),
          maxTime: expect.any(Number),
          minTime: expect.any(Number),
          iterations: expect.any(Number)
        },
        overallScore: expect.any(Number)
      });

      // Verify all benchmark types ran with expected iterations
      expect(result.proximityQueryBenchmark.iterations).toBeGreaterThan(0);
      expect(result.boundaryQueryBenchmark.iterations).toBeGreaterThan(0);
      expect(result.statisticalQueryBenchmark.iterations).toBeGreaterThan(0);

      // Verify overall score is within expected range
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(1000);
    });

    it('should handle individual benchmark query failures', async () => {
      let callCount = 0;
      mockDb.query.mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          return Promise.reject(new Error('Query failed'));
        }
        return new Promise(resolve => setTimeout(() => resolve({ rows: [] }), 10));
      });

      const result = await performanceService.runPerformanceBenchmark();

      // Should still return results, but with reduced iterations for failed queries
      expect(result.proximityQueryBenchmark.iterations).toBeLessThan(10);
      expect(result.boundaryQueryBenchmark.iterations).toBeGreaterThan(0);
      expect(result.statisticalQueryBenchmark.iterations).toBeGreaterThan(0);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when all capabilities are available', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ postgis_version: '3.4.0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '5' }] });

      const result = await performanceService.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.indexingAvailable).toBe(true);
      expect(result.monitoringAvailable).toBe(true);
      expect(result.benchmarkCapable).toBe(true);
    });

    it('should return degraded status when PostGIS is not available', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // PostGIS not available
        .mockResolvedValueOnce({ rows: [{ count: '5' }] });

      const result = await performanceService.healthCheck();

      expect(result.status).toBe('degraded');
      expect(result.indexingAvailable).toBe(false);
      expect(result.monitoringAvailable).toBe(true);
      expect(result.benchmarkCapable).toBe(false);
    });

    it('should return unhealthy status on database error', async () => {
      mockDb.query.mockRejectedValue(new Error('Database unavailable'));

      const result = await performanceService.healthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.indexingAvailable).toBe(false);
      expect(result.monitoringAvailable).toBe(false);
      expect(result.benchmarkCapable).toBe(false);
    });
  });
});