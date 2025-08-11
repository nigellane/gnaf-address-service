/**
 * Spatial Query Optimizer
 * Performance utilities for PostGIS spatial operations
 */

import Logger from './logger';

const logger = Logger.createServiceLogger('SpatialOptimizer');
import { SpatialPerformanceMetrics, SPATIAL_CONSTANTS } from '../types/spatial';

export class SpatialOptimizer {
  private static instance: SpatialOptimizer;
  private performanceMetrics: SpatialPerformanceMetrics[] = [];

  static getInstance(): SpatialOptimizer {
    if (!this.instance) {
      this.instance = new SpatialOptimizer();
    }
    return this.instance;
  }

  /**
   * Apply spatial query optimization hints
   */
  static getSpatialOptimizationQuery(): string {
    return `
      SET enable_seqscan = off;
      SET enable_indexscan = on;
      SET work_mem = '256MB';
      SET enable_nestloop = on;
      SET enable_hashjoin = off;
    `;
  }

  /**
   * Calculate bearing between two coordinates using Haversine formula
   */
  static calculateBearing(
    lat1: number, lng1: number, 
    lat2: number, lng2: number
  ): number {
    const toRadians = (degrees: number) => degrees * (Math.PI / 180);
    const toDegrees = (radians: number) => radians * (180 / Math.PI);

    const dLng = toRadians(lng2 - lng1);
    const lat1Rad = toRadians(lat1);
    const lat2Rad = toRadians(lat2);

    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    const bearing = toDegrees(Math.atan2(y, x));
    return (bearing + 360) % 360; // Normalize to 0-360
  }

  /**
   * Validate coordinates are within Australian territory
   */
  static validateAustralianCoordinates(latitude: number, longitude: number): boolean {
    return (
      latitude >= -43.7 && latitude <= -9.0 &&
      longitude >= 112.0 && longitude <= 154.0 &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude)
    );
  }

  /**
   * Validate coordinate precision (7 decimal places max)
   */
  static validateCoordinatePrecision(value: number): number {
    return Math.round(value * Math.pow(10, SPATIAL_CONSTANTS.COORDINATE_PRECISION)) / 
           Math.pow(10, SPATIAL_CONSTANTS.COORDINATE_PRECISION);
  }

  /**
   * Get optimized proximity query with spatial indexing
   */
  static getProximityQuery(useWebMercator: boolean = true): string {
    const projection = useWebMercator ? SPATIAL_CONSTANTS.WEB_MERCATOR_SRID : SPATIAL_CONSTANTS.WGS84_SRID;
    
    return `
      SELECT 
        a.gnaf_pid,
        a.formatted_address as address,
        a.latitude,
        a.longitude,
        ROUND(
          ST_Distance(
            ST_Transform(a.geometry, ${projection}),
            ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), ${projection})
          )
        ) as distance_meters
      FROM gnaf.addresses a
      WHERE ST_DWithin(
        ST_Transform(a.geometry, ${projection}),
        ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), ${projection}),
        $3
      )
      ORDER BY distance_meters
      LIMIT $4;
    `;
  }

  /**
   * Get boundary containment query
   */
  static getBoundaryQuery(): string {
    return `
      SELECT 
        l.locality_name,
        l.locality_pid,
        l.postcode,
        l.local_government_area
      FROM gnaf.localities l
      WHERE ST_Contains(l.geometry, ST_SetSRID(ST_MakePoint($2, $1), 4326))
      LIMIT 1;
    `;
  }

  /**
   * Get statistical area classification query
   */
  static getStatisticalAreaQuery(): string {
    return `
      SELECT 
        s.mesh_block_code,
        s.statistical_area_1,
        s.statistical_area_2,
        a.locality_pid
      FROM gnaf.addresses a
      JOIN gnaf.streets s ON a.street_pid = s.street_pid
      WHERE ST_DWithin(
        a.geometry,
        ST_SetSRID(ST_MakePoint($2, $1), 4326),
        100  -- 100m tolerance for finding nearest street
      )
      ORDER BY ST_Distance(a.geometry, ST_SetSRID(ST_MakePoint($2, $1), 4326))
      LIMIT 1;
    `;
  }

  /**
   * Record performance metrics for monitoring
   */
  recordPerformance(metrics: SpatialPerformanceMetrics): void {
    this.performanceMetrics.push(metrics);
    
    // Log slow queries for monitoring
    if (metrics.executionTime > 500) {
      logger.warn('Slow spatial query detected', {
        queryType: metrics.queryType,
        executionTime: metrics.executionTime,
        resultCount: metrics.resultCount,
        usesSpatialIndex: metrics.usesSpatialIndex
      });
    }

    // Keep only last 1000 metrics in memory
    if (this.performanceMetrics.length > 1000) {
      this.performanceMetrics = this.performanceMetrics.slice(-500);
    }
  }

  /**
   * Get performance statistics for monitoring
   */
  getPerformanceStats(): {
    averageExecutionTime: number;
    slowQueries: number;
    totalQueries: number;
    spatialIndexUsage: number;
  } {
    if (this.performanceMetrics.length === 0) {
      return {
        averageExecutionTime: 0,
        slowQueries: 0,
        totalQueries: 0,
        spatialIndexUsage: 0
      };
    }

    const total = this.performanceMetrics.length;
    const avgTime = this.performanceMetrics.reduce((sum, m) => sum + m.executionTime, 0) / total;
    const slowQueries = this.performanceMetrics.filter(m => m.executionTime > 500).length;
    const indexUsage = this.performanceMetrics.filter(m => m.usesSpatialIndex).length;

    return {
      averageExecutionTime: Math.round(avgTime * 100) / 100,
      slowQueries,
      totalQueries: total,
      spatialIndexUsage: Math.round((indexUsage / total) * 100)
    };
  }

  /**
   * Optimize batch operation size based on complexity
   */
  static calculateOptimalBatchSize(operationType: string, totalOperations: number): number {
    const baseSize = SPATIAL_CONSTANTS.DEFAULT_BATCH_SIZE;
    
    // Adjust batch size based on operation complexity
    switch (operationType) {
      case 'proximity':
        return Math.min(baseSize * 2, SPATIAL_CONSTANTS.MAX_BATCH_SIZE); // Proximity is faster
      case 'boundary':
        return baseSize; // Standard complexity
      case 'statistical':
        return Math.max(Math.floor(baseSize / 2), 5); // More complex joins
      default:
        return baseSize;
    }
  }

  /**
   * Generate explain analyze query for performance monitoring
   */
  static getExplainQuery(query: string): string {
    return `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
  }

  /**
   * Advanced spatial indexing strategy queries
   */
  static getAdvancedIndexQueries(): { [key: string]: string } {
    return {
      // Cluster addresses table by geometry for better spatial locality
      clusterAddresses: `
        CLUSTER gnaf.addresses USING idx_addresses_geometry;
      `,
      
      // Create additional spatial indexes for performance
      createLocalityGeomIndex: `
        CREATE INDEX IF NOT EXISTS idx_localities_geometry_gist 
        ON gnaf.localities USING GIST (geometry) 
        WITH (fillfactor=90);
      `,
      
      // Optimize statistics for query planner
      analyzeAddresses: `
        ANALYZE gnaf.addresses;
      `,
      
      // Create partial indexes for common query patterns
      createActiveAddressesIndex: `
        CREATE INDEX IF NOT EXISTS idx_addresses_active_geometry 
        ON gnaf.addresses USING GIST (geometry) 
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        WITH (fillfactor=90);
      `,
      
      // Vacuum and reindex for maintenance
      vacuumAddresses: `
        VACUUM ANALYZE gnaf.addresses;
      `,
      
      // Create compound index for statistical area queries
      createStatisticalIndex: `
        CREATE INDEX IF NOT EXISTS idx_streets_statistical_areas 
        ON gnaf.streets (statistical_area_1, statistical_area_2, mesh_block_code) 
        WHERE statistical_area_1 IS NOT NULL;
      `
    };
  }

  /**
   * Performance monitoring queries
   */
  static getPerformanceMonitoringQueries(): { [key: string]: string } {
    return {
      // Check spatial index usage
      spatialIndexUsage: `
        SELECT 
          schemaname,
          tablename,
          indexname,
          idx_tup_read,
          idx_tup_fetch
        FROM pg_stat_user_indexes 
        WHERE indexname LIKE 'idx_%geometry%'
        ORDER BY idx_tup_read DESC;
      `,
      
      // Monitor spatial query performance
      slowSpatialQueries: `
        SELECT 
          query,
          calls,
          total_time,
          mean_time,
          rows
        FROM pg_stat_statements 
        WHERE query LIKE '%ST_%' 
        AND mean_time > 100
        ORDER BY mean_time DESC
        LIMIT 10;
      `,
      
      // Check table bloat
      tableBloat: `
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
          pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size
        FROM pg_tables 
        WHERE schemaname = 'gnaf'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
      `,
      
      // Monitor spatial function performance
      spatialFunctionStats: `
        SELECT 
          funcname,
          calls,
          total_time,
          mean_time
        FROM pg_stat_user_functions 
        WHERE funcname LIKE 'st_%'
        ORDER BY total_time DESC
        LIMIT 10;
      `,
      
      // Check PostGIS version and extensions
      postgisInfo: `
        SELECT 
          name,
          default_version,
          installed_version
        FROM pg_available_extensions 
        WHERE name LIKE 'postgis%';
      `
    };
  }

  /**
   * Connection pool optimization settings
   */
  static getConnectionPoolOptimization(): string {
    return `
      SET shared_preload_libraries = 'pg_stat_statements';
      SET max_connections = 150;
      SET shared_buffers = '256MB';
      SET effective_cache_size = '1GB';
      SET work_mem = '256MB';
      SET maintenance_work_mem = '512MB';
      SET random_page_cost = 1.1;
      SET effective_io_concurrency = 200;
    `;
  }

  /**
   * Spatial clustering analysis
   */
  static getSpatialClusteringQuery(tableName: string = 'gnaf.addresses'): string {
    return `
      SELECT 
        ST_ClusterDBSCAN(geometry, eps => 1000, minpoints => 5) OVER () as cluster_id,
        gnaf_pid,
        latitude,
        longitude,
        formatted_address
      FROM ${tableName}
      WHERE geometry IS NOT NULL
      LIMIT 1000;
    `;
  }

  /**
   * Query plan analysis for spatial operations
   */
  async analyzeQueryPlan(db: any, query: string, params: any[]): Promise<{
    executionTime: number;
    planningTime: number;
    usesSpatialIndex: boolean;
    estimatedCost: number;
    actualRows: number;
  }> {
    try {
      const explainQuery = SpatialOptimizer.getExplainQuery(query);
      const result = await db.query(explainQuery, params);
      
      if (result.rows.length === 0) {
        throw new Error('No query plan returned');
      }

      const plan = result.rows[0]['QUERY PLAN'];
      const executionTime = plan['Execution Time'] || 0;
      const planningTime = plan['Planning Time'] || 0;
      
      // Analyze plan for spatial index usage
      const planText = JSON.stringify(plan);
      const usesSpatialIndex = planText.includes('idx_') && 
                              (planText.includes('geometry') || planText.includes('GIST'));
      
      // Extract cost and row estimates
      const rootPlan = plan.Plan || {};
      const estimatedCost = rootPlan['Total Cost'] || 0;
      const actualRows = rootPlan['Actual Rows'] || 0;

      return {
        executionTime,
        planningTime,
        usesSpatialIndex,
        estimatedCost,
        actualRows
      };
    } catch (error) {
      throw new Error(`Query plan analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Spatial data clustering for improved performance
   */
  static getDataClusteringQuery(): string {
    return `
      -- Cluster addresses by spatial proximity for better cache performance
      CREATE TABLE IF NOT EXISTS gnaf.addresses_clustered AS
      SELECT 
        a.*,
        ST_ClusterDBSCAN(a.geometry, eps => 5000, minpoints => 10) OVER () as spatial_cluster
      FROM gnaf.addresses a
      WHERE a.geometry IS NOT NULL
      ORDER BY spatial_cluster, ST_GeoHash(a.geometry);
      
      -- Create index on clustered table
      CREATE INDEX IF NOT EXISTS idx_addresses_clustered_geometry 
      ON gnaf.addresses_clustered USING GIST (geometry)
      WITH (fillfactor=95);
      
      CREATE INDEX IF NOT EXISTS idx_addresses_clustered_cluster 
      ON gnaf.addresses_clustered (spatial_cluster)
      WHERE spatial_cluster IS NOT NULL;
    `;
  }
}