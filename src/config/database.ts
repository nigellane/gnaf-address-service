/**
 * Database configuration with connection pooling for G-NAF Address Service
 * Optimized for high-performance spatial queries
 */

import { Pool, PoolConfig, PoolClient } from 'pg';
import winston from 'winston';

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

export interface DatabaseMetrics {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  totalQueries: number;
  avgQueryTime: number;
  slowQueries: number;
}

class DatabaseManager {
  private pool!: Pool;
  private metrics: DatabaseMetrics;
  private queryTimes: number[] = [];
  private readonly SLOW_QUERY_THRESHOLD = 5000; // 5 seconds (increased for bulk imports)

  constructor() {
    this.metrics = {
      totalConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
      totalQueries: 0,
      avgQueryTime: 0,
      slowQueries: 0
    };

    this.initializePool();
    this.setupEventListeners();
  }

  private initializePool(): void {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    const poolConfig: PoolConfig = {
      connectionString: databaseUrl,
      
      // Connection pool settings optimized for G-NAF workload
      min: parseInt(process.env.DB_POOL_MIN || '5'),
      max: parseInt(process.env.DB_POOL_MAX || '20'),
      
      // Connection lifecycle
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'), // 30 seconds
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000'), // 10 seconds
      
      // Keep connections alive
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      
      // Performance settings
      statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '60000'), // 60 seconds
      query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT || '30000'), // 30 seconds
      
      // Spatial data optimization
      application_name: 'gnaf-address-service',
      
      // Additional PostgreSQL settings for spatial queries
      options: `
        -c search_path=gnaf,public,postgis
        -c max_parallel_workers_per_gather=4
        -c work_mem=256MB
        -c maintenance_work_mem=1GB
        -c random_page_cost=1.1
        -c effective_cache_size=4GB
      `.replace(/\s+/g, ' ').trim()
    };

    this.pool = new Pool(poolConfig);
    
    logger.info('Database connection pool initialized', {
      min: poolConfig.min,
      max: poolConfig.max,
      idleTimeout: poolConfig.idleTimeoutMillis,
      connectionTimeout: poolConfig.connectionTimeoutMillis
    });
  }

  private setupEventListeners(): void {
    // Connection events
    this.pool.on('connect', (client: PoolClient) => {
      this.metrics.totalConnections++;
      logger.debug('New database connection established');
      
      // Set session-level optimizations for spatial queries
      client.query(`
        SET search_path = gnaf, public, postgis;
        SET enable_seqscan = off;
        SET enable_indexscan = on;
        SET enable_bitmapscan = on;
        SET random_page_cost = 1.1;
        SET seq_page_cost = 1.0;
      `).catch(error => {
        logger.error('Failed to set session optimizations:', error.message);
      });
    });

    this.pool.on('acquire', () => {
      this.metrics.idleConnections = Math.max(0, this.metrics.idleConnections - 1);
      logger.debug('Database connection acquired from pool');
    });

    this.pool.on('release', () => {
      this.metrics.idleConnections++;
      logger.debug('Database connection released to pool');
    });

    this.pool.on('error', (error: Error) => {
      logger.error('Database pool error:', error.message);
    });

    this.pool.on('remove', () => {
      this.metrics.totalConnections = Math.max(0, this.metrics.totalConnections - 1);
      logger.debug('Database connection removed from pool');
    });
  }

  /**
   * Execute a query with performance tracking
   */
  async query(text: string, params?: any[]): Promise<any> {
    const startTime = Date.now();
    
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - startTime;
      
      this.trackQueryPerformance(duration);
      
      if (duration > this.SLOW_QUERY_THRESHOLD) {
        logger.warn('Slow query detected', {
          duration,
          query: text.substring(0, 200),
          params: params?.length ? `${params.length} parameters` : 'no parameters'
        });
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Query error', {
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
        query: text.substring(0, 200)
      });
      throw error;
    }
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get a client for multiple operations
   */
  async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }

  /**
   * Execute spatial query with optimizations
   */
  async spatialQuery(text: string, params?: any[]): Promise<any> {
    // Add spatial query hints
    const optimizedQuery = `
      SET enable_seqscan = off;
      SET enable_indexscan = on;
      SET work_mem = '256MB';
      ${text}
    `;
    
    return this.query(optimizedQuery, params);
  }

  /**
   * Bulk insert with COPY for large datasets
   */
  async bulkInsert(tableName: string, columns: string[], data: any[][]): Promise<void> {
    const client = await this.getClient();
    
    try {
      const copyText = `COPY gnaf.${tableName} (${columns.join(', ')}) FROM STDIN WITH (FORMAT csv, DELIMITER ',', NULL '')`;
      
      const stream = client.query(require('pg-copy-streams').from(copyText));
      
      for (const row of data) {
        const csvRow = row.map(value => 
          value === null || value === undefined ? '' : 
          typeof value === 'string' && value.includes(',') ? `"${value}"` : 
          String(value)
        ).join(',') + '\n';
        
        stream.write(csvRow);
      }
      
      stream.end();
      
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
      
    } finally {
      client.release();
    }
  }

  private trackQueryPerformance(duration: number): void {
    this.metrics.totalQueries++;
    this.queryTimes.push(duration);
    
    if (duration > this.SLOW_QUERY_THRESHOLD) {
      this.metrics.slowQueries++;
    }
    
    // Keep only last 1000 query times for rolling average
    if (this.queryTimes.length > 1000) {
      this.queryTimes = this.queryTimes.slice(-1000);
    }
    
    this.metrics.avgQueryTime = this.queryTimes.reduce((sum, time) => sum + time, 0) / this.queryTimes.length;
  }

  /**
   * Get current database metrics
   */
  getMetrics(): DatabaseMetrics {
    return {
      ...this.metrics,
      idleConnections: this.pool.idleCount,
      waitingClients: this.pool.waitingCount,
      totalConnections: this.pool.totalCount
    };
  }

  /**
   * Health check for database connectivity
   */
  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      await this.query('SELECT 1 as health_check');
      const latency = Date.now() - startTime;
      
      return {
        healthy: true,
        latency
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Optimize database for spatial queries
   */
  async optimize(): Promise<void> {
    logger.info('Running database optimization...');
    
    try {
      // Update table statistics
      await this.query('ANALYZE gnaf.addresses');
      await this.query('ANALYZE gnaf.localities');
      await this.query('ANALYZE gnaf.streets');
      
      // Refresh materialized views
      await this.query('REFRESH MATERIALIZED VIEW gnaf.address_statistics');
      
      // Vacuum for optimal performance
      await this.query('VACUUM (ANALYZE) gnaf.addresses');
      
      logger.info('Database optimization completed');
    } catch (error) {
      logger.error('Database optimization failed:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database connection pool closed');
  }
}

// Singleton instance
let databaseManager: DatabaseManager | null = null;

export function getDatabase(): DatabaseManager {
  if (!databaseManager) {
    databaseManager = new DatabaseManager();
  }
  return databaseManager;
}

export default getDatabase;