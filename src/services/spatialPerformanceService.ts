/**
 * Spatial Performance Service
 * Advanced spatial query optimization and performance monitoring
 */

import { DatabaseManager } from '../config/database';
import { SpatialOptimizer } from '../utils/spatialOptimizer';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('SpatialPerformanceService');

interface IndexingResult {
  operation: string;
  success: boolean;
  executionTime: number;
  error?: string;
}

interface PerformanceReport {
  timestamp: string;
  spatialIndexUsage: Array<{
    schemaname: string;
    tablename: string;
    indexname: string;
    reads: number;
    fetches: number;
  }>;
  slowQueries: Array<{
    query: string;
    calls: number;
    totalTime: number;
    meanTime: number;
    rows: number;
  }>;
  tableSizes: Array<{
    schemaname: string;
    tablename: string;
    totalSize: string;
    tableSize: string;
    indexSize: string;
  }>;
  postgisInfo: Array<{
    name: string;
    defaultVersion: string;
    installedVersion: string;
  }>;
}

export class SpatialPerformanceService {
  private static instance: SpatialPerformanceService;
  private db: DatabaseManager;
  private spatialOptimizer: SpatialOptimizer;

  constructor() {
    this.db = DatabaseManager.getInstance();
    this.spatialOptimizer = SpatialOptimizer.getInstance();
  }

  static getInstance(): SpatialPerformanceService {
    if (!this.instance) {
      this.instance = new SpatialPerformanceService();
    }
    return this.instance;
  }

  /**
   * Initialize advanced spatial indexing
   */
  async initializeAdvancedIndexing(): Promise<IndexingResult[]> {
    const startTime = Date.now();
    const results: IndexingResult[] = [];

    try {
      logger.info('Starting advanced spatial indexing initialization');

      const indexQueries = SpatialOptimizer.getAdvancedIndexQueries();

      for (const [operation, query] of Object.entries(indexQueries)) {
        const operationStartTime = Date.now();
        
        try {
          await this.db.query(query);
          
          results.push({
            operation,
            success: true,
            executionTime: Date.now() - operationStartTime
          });

          logger.debug('Index operation completed successfully', { operation, executionTime: Date.now() - operationStartTime });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
          results.push({
            operation,
            success: false,
            executionTime: Date.now() - operationStartTime,
            error: errorMessage
          });

          logger.warn('Index operation failed', { operation, error: errorMessage });
        }
      }

      const totalTime = Date.now() - startTime;
      const successCount = results.filter(r => r.success).length;
      
      logger.info('Advanced indexing initialization completed', {
        totalOperations: results.length,
        successful: successCount,
        failed: results.length - successCount,
        totalTime: `${totalTime}ms`
      });

      return results;
    } catch (error) {
      logger.error('Advanced indexing initialization failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: `${Date.now() - startTime}ms`
      });
      throw error;
    }
  }

  /**
   * Generate comprehensive performance report
   */
  async generatePerformanceReport(): Promise<PerformanceReport> {
    const startTime = Date.now();

    try {
      logger.info('Generating spatial performance report');

      const monitoringQueries = SpatialOptimizer.getPerformanceMonitoringQueries();

      // Execute monitoring queries in parallel
      const [
        spatialIndexResult,
        slowQueriesResult,
        tableBloatResult,
        postgisInfoResult
      ] = await Promise.all([
        this.db.query(monitoringQueries.spatialIndexUsage!),
        this.db.query(monitoringQueries.slowSpatialQueries!).catch(() => ({ rows: [] })), // pg_stat_statements may not be enabled
        this.db.query(monitoringQueries.tableBloat!),
        this.db.query(monitoringQueries.postgisInfo!)
      ]);

      const report: PerformanceReport = {
        timestamp: new Date().toISOString(),
        spatialIndexUsage: spatialIndexResult.rows.map((row: any) => ({
          schemaname: row.schemaname,
          tablename: row.tablename,
          indexname: row.indexname,
          reads: parseInt(row.idx_tup_read) || 0,
          fetches: parseInt(row.idx_tup_fetch) || 0
        })),
        slowQueries: slowQueriesResult.rows.map((row: any) => ({
          query: row.query,
          calls: parseInt(row.calls) || 0,
          totalTime: parseFloat(row.total_time) || 0,
          meanTime: parseFloat(row.mean_time) || 0,
          rows: parseInt(row.rows) || 0
        })),
        tableSizes: tableBloatResult.rows.map((row: any) => ({
          schemaname: row.schemaname,
          tablename: row.tablename,
          totalSize: row.size,
          tableSize: row.table_size,
          indexSize: row.index_size
        })),
        postgisInfo: postgisInfoResult.rows.map((row: any) => ({
          name: row.name,
          defaultVersion: row.default_version,
          installedVersion: row.installed_version || 'Not installed'
        }))
      };

      const executionTime = Date.now() - startTime;
      
      logger.info('Performance report generated successfully', {
        executionTime: `${executionTime}ms`,
        indexCount: report.spatialIndexUsage.length,
        slowQueryCount: report.slowQueries.length,
        tableCount: report.tableSizes.length
      });

      return report;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('Performance report generation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: `${executionTime}ms`
      });
      throw error;
    }
  }

  /**
   * Optimize connection pool settings
   */
  async optimizeConnectionPool(): Promise<{ success: boolean; executionTime: number; error?: string }> {
    const startTime = Date.now();

    try {
      logger.info('Optimizing connection pool settings');

      const optimizationQuery = SpatialOptimizer.getConnectionPoolOptimization();
      await this.db.query(optimizationQuery);

      const executionTime = Date.now() - startTime;
      
      logger.info('Connection pool optimization completed', { executionTime: `${executionTime}ms` });

      return {
        success: true,
        executionTime
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('Connection pool optimization failed', {
        error: errorMessage,
        executionTime: `${executionTime}ms`
      });

      return {
        success: false,
        executionTime,
        error: errorMessage
      };
    }
  }

  /**
   * Analyze spatial data clustering
   */
  async analyzeSpatialClustering(tableName: string = 'gnaf.addresses'): Promise<{
    clusters: Array<{
      clusterId: number;
      addressCount: number;
      sampleAddresses: Array<{
        gnafPid: string;
        address: string;
        coordinates: { latitude: number; longitude: number };
      }>;
    }>;
    totalClusters: number;
    unclusteredAddresses: number;
  }> {
    const startTime = Date.now();

    try {
      logger.info('Analyzing spatial data clustering', { tableName });

      const clusteringQuery = SpatialOptimizer.getSpatialClusteringQuery(tableName);
      const result = await this.db.query(clusteringQuery);

      // Process clustering results
      const clustersMap = new Map<number, Array<any>>();
      let unclusteredCount = 0;

      result.rows.forEach((row: any) => {
        const clusterId = row.cluster_id;
        if (clusterId === null) {
          unclusteredCount++;
        } else {
          if (!clustersMap.has(clusterId)) {
            clustersMap.set(clusterId, []);
          }
          clustersMap.get(clusterId)!.push(row);
        }
      });

      // Convert to response format
      const clusters = Array.from(clustersMap.entries()).map(([clusterId, addresses]) => ({
        clusterId,
        addressCount: addresses.length,
        sampleAddresses: addresses.slice(0, 5).map(addr => ({
          gnafPid: addr.gnaf_pid,
          address: addr.formatted_address,
          coordinates: {
            latitude: parseFloat(addr.latitude),
            longitude: parseFloat(addr.longitude)
          }
        }))
      }));

      const executionTime = Date.now() - startTime;

      logger.info('Spatial clustering analysis completed', {
        executionTime: `${executionTime}ms`,
        totalClusters: clusters.length,
        unclusteredAddresses: unclusteredCount,
        largestCluster: clusters.length > 0 ? Math.max(...clusters.map(c => c.addressCount)) : 0
      });

      return {
        clusters,
        totalClusters: clusters.length,
        unclusteredAddresses: unclusteredCount
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('Spatial clustering analysis failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: `${executionTime}ms`
      });
      throw error;
    }
  }

  /**
   * Analyze query performance for specific operations
   */
  async analyzeQueryPerformance(query: string, params: any[]): Promise<{
    executionTime: number;
    planningTime: number;
    usesSpatialIndex: boolean;
    estimatedCost: number;
    actualRows: number;
  }> {
    return await this.spatialOptimizer.analyzeQueryPlan(this.db, query, params);
  }

  /**
   * Run performance benchmark tests
   */
  async runPerformanceBenchmark(): Promise<{
    proximityQueryBenchmark: { averageTime: number; maxTime: number; minTime: number; iterations: number };
    boundaryQueryBenchmark: { averageTime: number; maxTime: number; minTime: number; iterations: number };
    statisticalQueryBenchmark: { averageTime: number; maxTime: number; minTime: number; iterations: number };
    overallScore: number;
  }> {
    const startTime = Date.now();
    const iterations = 10;

    try {
      logger.info('Running performance benchmark tests');

      // Test coordinates in different Australian cities
      const testCoordinates = [
        { latitude: -37.8136, longitude: 144.9631 }, // Melbourne
        { latitude: -33.8688, longitude: 151.2093 }, // Sydney
        { latitude: -27.4698, longitude: 153.0251 }, // Brisbane
        { latitude: -31.9505, longitude: 115.8605 }, // Perth
        { latitude: -34.9285, longitude: 138.6007 }  // Adelaide
      ];

      // Proximity query benchmark
      const proximityTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const coord = testCoordinates[i % testCoordinates.length]!;
        const queryStart = Date.now();
        
        try {
          await this.db.query(SpatialOptimizer.getProximityQuery(true), [
            coord.latitude, coord.longitude, 1000, 10
          ]);
          proximityTimes.push(Date.now() - queryStart);
        } catch (error) {
          logger.warn('Benchmark proximity query failed', { iteration: i, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      // Boundary query benchmark
      const boundaryTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const coord = testCoordinates[i % testCoordinates.length]!;
        const queryStart = Date.now();
        
        try {
          await this.db.query(SpatialOptimizer.getBoundaryQuery(), [
            coord.latitude, coord.longitude
          ]);
          boundaryTimes.push(Date.now() - queryStart);
        } catch (error) {
          logger.warn('Benchmark boundary query failed', { iteration: i, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      // Statistical area query benchmark
      const statisticalTimes: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const coord = testCoordinates[i % testCoordinates.length]!;
        const queryStart = Date.now();
        
        try {
          await this.db.query(SpatialOptimizer.getStatisticalAreaQuery(), [
            coord.latitude, coord.longitude
          ]);
          statisticalTimes.push(Date.now() - queryStart);
        } catch (error) {
          logger.warn('Benchmark statistical query failed', { iteration: i, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      // Calculate benchmark statistics
      const calculateStats = (times: number[]) => ({
        averageTime: times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
        maxTime: times.length > 0 ? Math.max(...times) : 0,
        minTime: times.length > 0 ? Math.min(...times) : 0,
        iterations: times.length
      });

      const proximityStats = calculateStats(proximityTimes);
      const boundaryStats = calculateStats(boundaryTimes);
      const statisticalStats = calculateStats(statisticalTimes);

      // Calculate overall performance score (lower is better, max score is 1000)
      const overallAverageTime = (proximityStats.averageTime + boundaryStats.averageTime + statisticalStats.averageTime) / 3;
      const overallScore = Math.max(0, Math.min(1000, 1000 - overallAverageTime));

      const totalTime = Date.now() - startTime;

      logger.info('Performance benchmark completed', {
        totalTime: `${totalTime}ms`,
        proximityAvg: `${proximityStats.averageTime}ms`,
        boundaryAvg: `${boundaryStats.averageTime}ms`,
        statisticalAvg: `${statisticalStats.averageTime}ms`,
        overallScore
      });

      return {
        proximityQueryBenchmark: proximityStats,
        boundaryQueryBenchmark: boundaryStats,
        statisticalQueryBenchmark: statisticalStats,
        overallScore
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('Performance benchmark failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: `${executionTime}ms`
      });
      throw error;
    }
  }

  /**
   * Health check for performance service
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    indexingAvailable: boolean;
    monitoringAvailable: boolean;
    benchmarkCapable: boolean;
  }> {
    try {
      // Test basic database connectivity and PostGIS availability
      const postgisTest = await this.db.query('SELECT PostGIS_version();');
      const indexTest = await this.db.query('SELECT count(*) FROM pg_indexes WHERE schemaname = \'gnaf\';');
      
      const indexingAvailable = postgisTest.rows.length > 0;
      const monitoringAvailable = indexTest.rows.length > 0;
      const benchmarkCapable = indexingAvailable && monitoringAvailable;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (!indexingAvailable && !monitoringAvailable) {
        status = 'unhealthy';
      } else if (!indexingAvailable || !monitoringAvailable) {
        status = 'degraded';
      }

      return {
        status,
        indexingAvailable,
        monitoringAvailable,
        benchmarkCapable
      };
    } catch (error) {
      logger.error('Performance service health check failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      return {
        status: 'unhealthy',
        indexingAvailable: false,
        monitoringAvailable: false,
        benchmarkCapable: false
      };
    }
  }
}

// Export singleton instance
export const spatialPerformanceService = SpatialPerformanceService.getInstance();