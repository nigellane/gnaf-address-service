/**
 * Query Optimization Service
 * Advanced database query optimization and materialized view management
 */

import { DatabaseManager } from '../config/database';
import { cachingService } from './cachingService';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('QueryOptimization');

export interface QueryPlan {
  planJson: any;
  totalCost: number;
  executionTime: number;
  indexUsage: boolean;
  recommendations: string[];
}

export interface MaterializedViewInfo {
  viewName: string;
  query: string;
  refreshPolicy: 'manual' | 'auto';
  lastRefresh: Date;
  size: number;
  hitRatio: number;
}

export class QueryOptimizationService {
  private static instance: QueryOptimizationService;
  private db: DatabaseManager;
  private readonly MATERIALIZED_VIEWS = {
    statistical_areas_agg: {
      name: 'mv_statistical_areas_agg',
      query: `
        SELECT 
          statistical_area_2,
          statistical_area_3,
          statistical_area_4,
          COUNT(*) as address_count,
          ST_Centroid(ST_Union(geometry)) as center_point
        FROM gnaf.addresses 
        WHERE statistical_area_2 IS NOT NULL
        GROUP BY statistical_area_2, statistical_area_3, statistical_area_4
      `
    },
    locality_stats: {
      name: 'mv_locality_stats',
      query: `
        SELECT 
          locality_pid,
          locality_name,
          state_abbreviation,
          postcode,
          COUNT(*) as address_count,
          AVG(confidence_score) as avg_confidence,
          ST_Centroid(ST_Union(geometry)) as locality_center
        FROM gnaf.addresses
        GROUP BY locality_pid, locality_name, state_abbreviation, postcode
      `
    },
    proximity_hotspots: {
      name: 'mv_proximity_hotspots',
      query: `
        SELECT 
          ST_SnapToGrid(geometry, 0.01) as grid_cell,
          COUNT(*) as density,
          AVG(confidence_score) as avg_confidence,
          array_agg(DISTINCT locality_name) as localities
        FROM gnaf.addresses
        GROUP BY ST_SnapToGrid(geometry, 0.01)
        HAVING COUNT(*) > 10
      `
    }
  };

  constructor() {
    this.db = DatabaseManager.getInstance();
  }

  static getInstance(): QueryOptimizationService {
    if (!this.instance) {
      this.instance = new QueryOptimizationService();
    }
    return this.instance;
  }

  /**
   * Analyze query execution plan and provide optimization recommendations
   */
  async analyzeQuery(query: string, params: any[] = []): Promise<QueryPlan> {
    const startTime = Date.now();
    
    try {
      // Get execution plan with JSON format
      const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
      const result = await this.db.query(explainQuery, params);
      const planJson = result.rows[0]['QUERY PLAN'][0];
      
      const executionTime = Date.now() - startTime;
      const totalCost = planJson.Plan['Total Cost'];
      
      // Check for index usage
      const indexUsage = this.checkIndexUsage(planJson);
      
      // Generate recommendations
      const recommendations = this.generateOptimizationRecommendations(planJson);
      
      logger.info('Query analysis completed', {
        totalCost,
        executionTime,
        indexUsage,
        recommendationCount: recommendations.length
      });

      return {
        planJson,
        totalCost,
        executionTime,
        indexUsage,
        recommendations
      };

    } catch (error) {
      logger.error('Query analysis failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Create or refresh materialized views for common spatial queries
   */
  async createMaterializedView(viewKey: keyof typeof this.MATERIALIZED_VIEWS): Promise<boolean> {
    const viewConfig = this.MATERIALIZED_VIEWS[viewKey];
    
    try {
      logger.info('Creating materialized view', { viewName: viewConfig.name });

      // Drop existing view if exists
      await this.db.query(`DROP MATERIALIZED VIEW IF EXISTS ${viewConfig.name} CASCADE;`);
      
      // Create new materialized view
      const createQuery = `
        CREATE MATERIALIZED VIEW ${viewConfig.name} AS
        ${viewConfig.query}
        WITH DATA;
      `;
      
      await this.db.query(createQuery);
      
      // Create index on the view for better performance
      await this.createMaterializedViewIndexes(viewConfig.name, viewKey);
      
      // Grant permissions
      await this.db.query(`GRANT SELECT ON ${viewConfig.name} TO PUBLIC;`);
      
      logger.info('Materialized view created successfully', { viewName: viewConfig.name });
      return true;

    } catch (error) {
      logger.error('Failed to create materialized view', {
        viewName: viewConfig.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Refresh materialized view data
   */
  async refreshMaterializedView(viewKey: keyof typeof this.MATERIALIZED_VIEWS): Promise<boolean> {
    const viewConfig = this.MATERIALIZED_VIEWS[viewKey];
    const startTime = Date.now();
    
    try {
      logger.info('Refreshing materialized view', { viewName: viewConfig.name });
      
      await this.db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewConfig.name};`);
      
      const refreshTime = Date.now() - startTime;
      logger.info('Materialized view refreshed successfully', {
        viewName: viewConfig.name,
        refreshTime: `${refreshTime}ms`
      });
      
      return true;

    } catch (error) {
      logger.error('Failed to refresh materialized view', {
        viewName: viewConfig.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Get materialized view statistics and information
   */
  async getMaterializedViewInfo(viewKey: keyof typeof this.MATERIALIZED_VIEWS): Promise<MaterializedViewInfo | null> {
    const viewConfig = this.MATERIALIZED_VIEWS[viewKey];
    
    try {
      // Get view statistics
      const statsQuery = `
        SELECT 
          schemaname,
          matviewname,
          hasindexes,
          ispopulated,
          pg_size_pretty(pg_total_relation_size(oid)) as size
        FROM pg_matviews 
        JOIN pg_class ON pg_class.relname = matviewname
        WHERE matviewname = $1;
      `;
      
      const statsResult = await this.db.query(statsQuery, [viewConfig.name]);
      
      if (statsResult.rows.length === 0) {
        return null;
      }
      
      const stats = statsResult.rows[0];
      
      // Get last refresh time from pg_stat_user_tables
      const refreshQuery = `
        SELECT 
          last_vacuum,
          last_autovacuum,
          last_analyze,
          last_autoanalyze
        FROM pg_stat_user_tables 
        WHERE relname = $1;
      `;
      
      const refreshResult = await this.db.query(refreshQuery, [viewConfig.name]);
      const refreshStats = refreshResult.rows[0] || {};

      return {
        viewName: viewConfig.name,
        query: viewConfig.query,
        refreshPolicy: 'manual',
        lastRefresh: refreshStats.last_analyze || new Date(),
        size: parseInt(stats.pg_total_relation_size) || 0,
        hitRatio: 0 // Would need pg_stat_user_tables data over time to calculate
      };

    } catch (error) {
      logger.error('Failed to get materialized view info', {
        viewName: viewConfig.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Initialize all materialized views
   */
  async initializeMaterializedViews(): Promise<number> {
    logger.info('Initializing materialized views');
    
    let successCount = 0;
    const viewKeys = Object.keys(this.MATERIALIZED_VIEWS) as Array<keyof typeof this.MATERIALIZED_VIEWS>;
    
    for (const viewKey of viewKeys) {
      const success = await this.createMaterializedView(viewKey);
      if (success) {
        successCount++;
      }
    }
    
    logger.info('Materialized view initialization completed', {
      total: viewKeys.length,
      successful: successCount,
      failed: viewKeys.length - successCount
    });
    
    return successCount;
  }

  /**
   * Cached query execution with intelligent cache key generation
   */
  async executeCachedQuery<T>(
    query: string, 
    params: any[] = [], 
    ttl: number = 300,
    cacheKeyPrefix: string = 'query'
  ): Promise<T[]> {
    const cacheKey = `${cacheKeyPrefix}:${Buffer.from(query + JSON.stringify(params)).toString('base64').slice(0, 32)}`;
    
    const cached = await cachingService.getOrSet(
      cacheKey,
      async () => {
        const result = await this.db.query(query, params);
        return result.rows;
      },
      { ttl }
    );
    
    return cached || [];
  }

  /**
   * Optimize spatial query with hints and configuration
   */
  async optimizeSpatialQuery(query: string): Promise<string> {
    // Add spatial optimization hints
    const optimizationHints = `
      -- Spatial query optimization hints
      SET enable_seqscan = OFF;
      SET work_mem = '256MB';
      SET random_page_cost = 1.1;
      SET cpu_tuple_cost = 0.01;
      SET enable_nestloop = ON;
      SET enable_hashjoin = OFF;
    `;
    
    return `${optimizationHints}\n${query}`;
  }

  /**
   * Generate database performance recommendations
   */
  async getDatabaseRecommendations(): Promise<string[]> {
    const recommendations: string[] = [];
    
    try {
      // Check for missing indexes
      const missingIndexes = await this.findMissingIndexes();
      recommendations.push(...missingIndexes.map(idx => `Consider adding index: ${idx}`));
      
      // Check for unused indexes
      const unusedIndexes = await this.findUnusedIndexes();
      recommendations.push(...unusedIndexes.map(idx => `Consider removing unused index: ${idx}`));
      
      // Check table statistics
      const staleStats = await this.findStaleStatistics();
      recommendations.push(...staleStats.map(table => `Update statistics for table: ${table}`));
      
      return recommendations;

    } catch (error) {
      logger.error('Failed to generate database recommendations', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return ['Unable to generate recommendations due to database error'];
    }
  }

  private checkIndexUsage(plan: any): boolean {
    if (!plan.Plan) return false;
    
    const nodeType = plan.Plan['Node Type'];
    if (nodeType && (nodeType.includes('Index') || nodeType.includes('Bitmap'))) {
      return true;
    }
    
    // Check child plans recursively
    if (plan.Plan.Plans) {
      return plan.Plan.Plans.some((childPlan: any) => this.checkIndexUsage({ Plan: childPlan }));
    }
    
    return false;
  }

  private generateOptimizationRecommendations(plan: any): string[] {
    const recommendations: string[] = [];
    
    if (!this.checkIndexUsage(plan)) {
      recommendations.push('Consider adding appropriate indexes to improve query performance');
    }
    
    const totalCost = plan.Plan['Total Cost'];
    if (totalCost > 1000) {
      recommendations.push('High query cost detected - consider query optimization or partitioning');
    }
    
    const actualTime = plan.Plan['Actual Total Time'];
    if (actualTime > 1000) {
      recommendations.push('Slow execution time - consider caching frequently accessed data');
    }
    
    return recommendations;
  }

  private async createMaterializedViewIndexes(viewName: string, viewKey: keyof typeof this.MATERIALIZED_VIEWS): Promise<void> {
    const indexes: { [key: string]: string[] } = {
      statistical_areas_agg: [
        `CREATE INDEX idx_${viewName}_sa2 ON ${viewName} (statistical_area_2);`,
        `CREATE INDEX idx_${viewName}_sa3 ON ${viewName} (statistical_area_3);`,
        `CREATE INDEX idx_${viewName}_center ON ${viewName} USING GIST (center_point);`
      ],
      locality_stats: [
        `CREATE INDEX idx_${viewName}_locality_pid ON ${viewName} (locality_pid);`,
        `CREATE INDEX idx_${viewName}_state_postcode ON ${viewName} (state_abbreviation, postcode);`,
        `CREATE INDEX idx_${viewName}_center ON ${viewName} USING GIST (locality_center);`
      ],
      proximity_hotspots: [
        `CREATE INDEX idx_${viewName}_grid ON ${viewName} USING GIST (grid_cell);`,
        `CREATE INDEX idx_${viewName}_density ON ${viewName} (density);`
      ]
    };

    const viewIndexes = indexes[viewKey] || [];
    
    for (const indexQuery of viewIndexes) {
      try {
        await this.db.query(indexQuery);
      } catch (error) {
        logger.warn('Failed to create materialized view index', {
          viewName,
          indexQuery,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  private async findMissingIndexes(): Promise<string[]> {
    const query = `
      SELECT 
        schemaname,
        tablename,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch
      FROM pg_stat_user_tables 
      WHERE seq_scan > idx_scan * 2
        AND seq_tup_read > 10000
      ORDER BY seq_tup_read DESC
      LIMIT 10;
    `;
    
    const result = await this.db.query(query);
    return result.rows.map((row: any) => `${row.schemaname}.${row.tablename} (seq_scans: ${row.seq_scan})`);
  }

  private async findUnusedIndexes(): Promise<string[]> {
    const query = `
      SELECT 
        schemaname,
        tablename,
        indexname,
        idx_scan
      FROM pg_stat_user_indexes 
      WHERE idx_scan = 0
        AND indexname NOT LIKE '%_pkey'
      ORDER BY schemaname, tablename, indexname
      LIMIT 10;
    `;
    
    const result = await this.db.query(query);
    return result.rows.map((row: any) => `${row.schemaname}.${row.tablename}.${row.indexname}`);
  }

  private async findStaleStatistics(): Promise<string[]> {
    const query = `
      SELECT 
        schemaname,
        tablename,
        last_analyze,
        n_tup_ins + n_tup_upd + n_tup_del as changes
      FROM pg_stat_user_tables 
      WHERE last_analyze < NOW() - INTERVAL '7 days'
        AND (n_tup_ins + n_tup_upd + n_tup_del) > 1000
      ORDER BY changes DESC
      LIMIT 10;
    `;
    
    const result = await this.db.query(query);
    return result.rows.map((row: any) => `${row.schemaname}.${row.tablename}`);
  }
}

export const queryOptimizationService = QueryOptimizationService.getInstance();