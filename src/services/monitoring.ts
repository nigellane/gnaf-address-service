/**
 * Monitoring and Alerting Service for G-NAF Address System
 * Handles dataset freshness, health checks, performance metrics, and alerting
 */

import winston from 'winston';
import { getDatabase } from '../config/database';

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

export interface SystemHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: HealthCheck[];
  overallScore: number;
  alerts: Alert[];
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  duration: number;
  message: string;
  details?: any;
}

export interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  type: 'dataset_freshness' | 'import_failure' | 'performance' | 'connectivity' | 'data_quality';
  message: string;
  timestamp: string;
  resolved: boolean;
  metadata?: any;
}

export interface DatasetFreshnessStatus {
  lastImportDate: string | null;
  daysSinceLastImport: number;
  isStale: boolean;
  quarterlyUpdateDue: boolean;
  nextExpectedUpdate: string;
  totalRecords: number;
  lastImportRecords: number;
}

export interface PerformanceMetrics {
  avgQueryTime: number;
  slowQueries: number;
  dbConnections: {
    total: number;
    active: number;
    idle: number;
    waiting: number;
  };
  throughput: {
    queriesPerSecond: number;
    recordsProcessedPerHour: number;
  };
  cacheHitRate: number;
  diskUsage: {
    totalSize: string;
    indexSize: string;
    dataSize: string;
  };
}

export class MonitoringService {
  private db = getDatabase();
  private alerts: Alert[] = [];
  private performanceWindow = 3600000; // 1 hour in milliseconds
  
  constructor() {
    this.initializeMonitoring();
  }

  /**
   * Initialize monitoring service
   */
  private initializeMonitoring(): void {
    logger.info('Initializing monitoring service...');
    
    // Start periodic health checks
    setInterval(() => this.runPeriodicHealthCheck(), 300000); // Every 5 minutes
    
    // Start dataset freshness monitoring
    setInterval(() => this.checkDatasetFreshness(), 86400000); // Every 24 hours
    
    // Start performance monitoring
    setInterval(() => this.collectPerformanceMetrics(), 60000); // Every minute
  }

  /**
   * Run comprehensive system health check
   */
  async checkSystemHealth(): Promise<SystemHealthStatus> {
    logger.info('Running comprehensive system health check...');
    
    const checks: HealthCheck[] = [];
    const startTime = Date.now();

    // Database connectivity check
    checks.push(await this.checkDatabaseConnectivity());
    
    // Dataset freshness check
    checks.push(await this.checkDatasetFreshnessHealth());
    
    // Performance check
    checks.push(await this.checkPerformanceHealth());
    
    // Data integrity check
    checks.push(await this.checkDataIntegrityHealth());
    
    // Index health check
    checks.push(await this.checkIndexHealth());

    // Calculate overall status
    const failedChecks = checks.filter(c => c.status === 'fail').length;
    const warningChecks = checks.filter(c => c.status === 'warn').length;
    const totalChecks = checks.length;
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    let overallScore: number;
    
    if (failedChecks === 0 && warningChecks === 0) {
      status = 'healthy';
      overallScore = 100;
    } else if (failedChecks === 0) {
      status = 'degraded';
      overallScore = Math.round(((totalChecks - warningChecks) / totalChecks) * 100);
    } else {
      status = 'unhealthy';
      overallScore = Math.round(((totalChecks - failedChecks - warningChecks) / totalChecks) * 100);
    }

    // Generate alerts for failed checks
    const newAlerts = this.generateHealthAlerts(checks);
    this.alerts.push(...newAlerts);

    const healthStatus: SystemHealthStatus = {
      status,
      timestamp: new Date().toISOString(),
      checks,
      overallScore,
      alerts: this.getActiveAlerts()
    };

    logger.info(`Health check completed in ${Date.now() - startTime}ms. Status: ${status} (${overallScore}%)`);
    return healthStatus;
  }

  /**
   * Check database connectivity and basic functionality
   */
  private async checkDatabaseConnectivity(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      const health = await this.db.healthCheck();
      const duration = Date.now() - startTime;
      
      if (health.healthy) {
        return {
          name: 'Database Connectivity',
          status: 'pass',
          duration,
          message: `Connected successfully (${health.latency}ms)`
        };
      } else {
        return {
          name: 'Database Connectivity',
          status: 'fail',
          duration,
          message: health.error || 'Database connection failed',
          details: { latency: health.latency }
        };
      }
    } catch (error) {
      return {
        name: 'Database Connectivity',
        status: 'fail',
        duration: Date.now() - startTime,
        message: `Connection check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Check dataset freshness status
   */
  async checkDatasetFreshness(): Promise<DatasetFreshnessStatus> {
    try {
      // Get latest import information
      const importQuery = `
        SELECT 
          MAX(created_at) as last_import_date,
          COUNT(*) FILTER (WHERE created_at = MAX(created_at)) as last_import_records,
          COUNT(*) as total_records
        FROM gnaf.addresses
        WHERE address_status = 'CURRENT'
      `;

      const result = await this.db.query(importQuery);
      const row = result.rows[0];

      const lastImportDate = row.last_import_date;
      const daysSinceLastImport = lastImportDate ? 
        Math.floor((Date.now() - new Date(lastImportDate).getTime()) / (1000 * 60 * 60 * 24)) : 
        999;

      // G-NAF is updated quarterly, so 100+ days is considered stale
      const isStale = daysSinceLastImport > 100;
      const quarterlyUpdateDue = daysSinceLastImport > 90;

      // Calculate next expected update (quarterly cycle)
      const nextUpdateDate = new Date();
      nextUpdateDate.setMonth(nextUpdateDate.getMonth() + (3 - (nextUpdateDate.getMonth() % 3)));
      nextUpdateDate.setDate(15); // Mid-month release typical

      const status: DatasetFreshnessStatus = {
        lastImportDate,
        daysSinceLastImport,
        isStale,
        quarterlyUpdateDue,
        nextExpectedUpdate: nextUpdateDate.toISOString().split('T')[0],
        totalRecords: parseInt(row.total_records),
        lastImportRecords: parseInt(row.last_import_records)
      };

      // Generate alerts if needed
      if (isStale) {
        this.createAlert({
          severity: 'critical',
          type: 'dataset_freshness',
          message: `G-NAF dataset is stale (${daysSinceLastImport} days old). Quarterly update overdue.`,
          metadata: status
        });
      } else if (quarterlyUpdateDue) {
        this.createAlert({
          severity: 'warning',
          type: 'dataset_freshness',
          message: `G-NAF dataset update may be due (${daysSinceLastImport} days old).`,
          metadata: status
        });
      }

      return status;

    } catch (error) {
      logger.error('Dataset freshness check failed:', error);
      
      this.createAlert({
        severity: 'critical',
        type: 'dataset_freshness',
        message: `Failed to check dataset freshness: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
      });

      return {
        lastImportDate: null,
        daysSinceLastImport: 999,
        isStale: true,
        quarterlyUpdateDue: true,
        nextExpectedUpdate: 'Unknown',
        totalRecords: 0,
        lastImportRecords: 0
      };
    }
  }

  private async checkDatasetFreshnessHealth(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      const freshness = await this.checkDatasetFreshness();
      const duration = Date.now() - startTime;

      if (freshness.isStale) {
        return {
          name: 'Dataset Freshness',
          status: 'fail',
          duration,
          message: `Dataset is stale (${freshness.daysSinceLastImport} days old)`,
          details: freshness
        };
      } else if (freshness.quarterlyUpdateDue) {
        return {
          name: 'Dataset Freshness',
          status: 'warn',
          duration,
          message: `Dataset update may be due (${freshness.daysSinceLastImport} days old)`,
          details: freshness
        };
      } else {
        return {
          name: 'Dataset Freshness',
          status: 'pass',
          duration,
          message: `Dataset is current (${freshness.daysSinceLastImport} days old)`,
          details: freshness
        };
      }
    } catch (error) {
      return {
        name: 'Dataset Freshness',
        status: 'fail',
        duration: Date.now() - startTime,
        message: `Freshness check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Collect performance metrics
   */
  async collectPerformanceMetrics(): Promise<PerformanceMetrics> {
    try {
      const dbMetrics = this.db.getMetrics();
      
      // Get database size information
      const sizeQuery = `
        SELECT 
          pg_size_pretty(pg_database_size(current_database())) as total_size,
          (SELECT pg_size_pretty(SUM(pg_relation_size(schemaname||'.'||tablename)))
           FROM pg_tables WHERE schemaname = 'gnaf') as data_size,
          (SELECT pg_size_pretty(SUM(pg_indexes_size(schemaname||'.'||tablename)))
           FROM pg_tables WHERE schemaname = 'gnaf') as index_size
      `;

      const sizeResult = await this.db.query(sizeQuery);
      const sizeInfo = sizeResult.rows[0];

      const metrics: PerformanceMetrics = {
        avgQueryTime: dbMetrics.avgQueryTime,
        slowQueries: dbMetrics.slowQueries,
        dbConnections: {
          total: dbMetrics.totalConnections,
          active: dbMetrics.totalConnections - dbMetrics.idleConnections,
          idle: dbMetrics.idleConnections,
          waiting: dbMetrics.waitingClients
        },
        throughput: {
          queriesPerSecond: this.calculateQueriesPerSecond(dbMetrics),
          recordsProcessedPerHour: this.calculateRecordsPerHour(dbMetrics)
        },
        cacheHitRate: await this.calculateCacheHitRate(),
        diskUsage: {
          totalSize: sizeInfo.total_size,
          dataSize: sizeInfo.data_size,
          indexSize: sizeInfo.index_size
        }
      };

      // Check for performance issues
      if (metrics.avgQueryTime > 1000) { // > 1 second
        this.createAlert({
          severity: 'warning',
          type: 'performance',
          message: `Average query time is high: ${metrics.avgQueryTime}ms`,
          metadata: { avgQueryTime: metrics.avgQueryTime }
        });
      }

      if (metrics.dbConnections.waiting > 5) {
        this.createAlert({
          severity: 'warning',
          type: 'performance',
          message: `High number of waiting connections: ${metrics.dbConnections.waiting}`,
          metadata: { waitingConnections: metrics.dbConnections.waiting }
        });
      }

      return metrics;

    } catch (error) {
      logger.error('Performance metrics collection failed:', error);
      throw error;
    }
  }

  private async checkPerformanceHealth(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      const metrics = await this.collectPerformanceMetrics();
      const duration = Date.now() - startTime;

      // Performance thresholds
      const avgQueryThreshold = 1000; // 1 second
      const slowQueryThreshold = 10;
      const waitingConnectionsThreshold = 5;

      if (metrics.avgQueryTime > avgQueryThreshold * 2 || 
          metrics.slowQueries > slowQueryThreshold * 5 ||
          metrics.dbConnections.waiting > waitingConnectionsThreshold * 2) {
        return {
          name: 'Performance',
          status: 'fail',
          duration,
          message: 'Performance is severely degraded',
          details: metrics
        };
      } else if (metrics.avgQueryTime > avgQueryThreshold || 
                 metrics.slowQueries > slowQueryThreshold ||
                 metrics.dbConnections.waiting > waitingConnectionsThreshold) {
        return {
          name: 'Performance',
          status: 'warn',
          duration,
          message: 'Performance may be degraded',
          details: metrics
        };
      } else {
        return {
          name: 'Performance',
          status: 'pass',
          duration,
          message: 'Performance is within acceptable limits',
          details: metrics
        };
      }
    } catch (error) {
      return {
        name: 'Performance',
        status: 'fail',
        duration: Date.now() - startTime,
        message: `Performance check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async checkDataIntegrityHealth(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Quick integrity checks
      const integrityQuery = `
        SELECT 
          COUNT(*) as total_addresses,
          COUNT(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL) as missing_coordinates,
          COUNT(*) FILTER (WHERE locality_pid IS NULL) as missing_locality,
          COUNT(*) FILTER (WHERE confidence_score < 50) as low_confidence_addresses
        FROM gnaf.addresses
        WHERE address_status = 'CURRENT'
      `;

      const result = await this.db.query(integrityQuery);
      const row = result.rows[0];
      const duration = Date.now() - startTime;

      const totalAddresses = parseInt(row.total_addresses);
      const missingCoordinates = parseInt(row.missing_coordinates);
      const missingLocality = parseInt(row.missing_locality);
      const lowConfidence = parseInt(row.low_confidence_addresses);

      const coordinateCompleteness = totalAddresses > 0 ? 
        ((totalAddresses - missingCoordinates) / totalAddresses) * 100 : 0;
      const localityCompleteness = totalAddresses > 0 ? 
        ((totalAddresses - missingLocality) / totalAddresses) * 100 : 0;
      const confidenceRate = totalAddresses > 0 ? 
        ((totalAddresses - lowConfidence) / totalAddresses) * 100 : 0;

      const details = {
        totalAddresses,
        coordinateCompleteness,
        localityCompleteness,
        confidenceRate
      };

      if (coordinateCompleteness < 90 || localityCompleteness < 95 || confidenceRate < 70) {
        return {
          name: 'Data Integrity',
          status: 'fail',
          duration,
          message: 'Data integrity issues detected',
          details
        };
      } else if (coordinateCompleteness < 95 || localityCompleteness < 98 || confidenceRate < 80) {
        return {
          name: 'Data Integrity',
          status: 'warn',
          duration,
          message: 'Minor data integrity concerns',
          details
        };
      } else {
        return {
          name: 'Data Integrity',
          status: 'pass',
          duration,
          message: 'Data integrity is good',
          details
        };
      }
    } catch (error) {
      return {
        name: 'Data Integrity',
        status: 'fail',
        duration: Date.now() - startTime,
        message: `Data integrity check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async checkIndexHealth(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Check for unused or missing indexes
      const indexQuery = `
        SELECT 
          schemaname,
          tablename,
          indexname,
          idx_scan as index_scans,
          pg_size_pretty(pg_relation_size(indexrelid)) as index_size
        FROM pg_stat_user_indexes 
        WHERE schemaname = 'gnaf'
        ORDER BY idx_scan ASC
      `;

      const result = await this.db.query(indexQuery);
      const duration = Date.now() - startTime;

      const indexes = result.rows;
      const unusedIndexes = indexes.filter(idx => parseInt(idx.index_scans) === 0);
      const lowUsageIndexes = indexes.filter(idx => parseInt(idx.index_scans) < 100);

      if (unusedIndexes.length > 5) {
        return {
          name: 'Index Health',
          status: 'warn',
          duration,
          message: `${unusedIndexes.length} unused indexes detected`,
          details: { unusedIndexes, totalIndexes: indexes.length }
        };
      } else {
        return {
          name: 'Index Health',
          status: 'pass',
          duration,
          message: 'Index usage appears optimal',
          details: { totalIndexes: indexes.length, lowUsage: lowUsageIndexes.length }
        };
      }
    } catch (error) {
      return {
        name: 'Index Health',
        status: 'fail',
        duration: Date.now() - startTime,
        message: `Index health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async runPeriodicHealthCheck(): Promise<void> {
    try {
      const healthStatus = await this.checkSystemHealth();
      
      if (healthStatus.status === 'unhealthy') {
        logger.error(`System health is unhealthy (${healthStatus.overallScore}%)`);
      } else if (healthStatus.status === 'degraded') {
        logger.warn(`System health is degraded (${healthStatus.overallScore}%)`);
      } else {
        logger.info(`System health check passed (${healthStatus.overallScore}%)`);
      }

    } catch (error) {
      logger.error('Periodic health check failed:', error);
    }
  }

  private calculateQueriesPerSecond(metrics: any): number {
    // This would calculate based on query history
    // For now, estimate based on total queries and avg time
    if (metrics.avgQueryTime > 0) {
      return Math.round(1000 / metrics.avgQueryTime);
    }
    return 0;
  }

  private calculateRecordsPerHour(metrics: any): number {
    // This would calculate based on import/processing history
    // For now, return a placeholder
    return 0;
  }

  private async calculateCacheHitRate(): Promise<number> {
    try {
      const cacheQuery = `
        SELECT 
          sum(blks_hit) as cache_hits,
          sum(blks_read) as disk_reads
        FROM pg_stat_database 
        WHERE datname = current_database()
      `;

      const result = await this.db.query(cacheQuery);
      const row = result.rows[0];

      const cacheHits = parseInt(row.cache_hits) || 0;
      const diskReads = parseInt(row.disk_reads) || 0;
      const totalReads = cacheHits + diskReads;

      return totalReads > 0 ? (cacheHits / totalReads) * 100 : 0;
    } catch (error) {
      logger.error('Cache hit rate calculation failed:', error);
      return 0;
    }
  }

  private createAlert(alertData: Omit<Alert, 'id' | 'timestamp' | 'resolved'>): void {
    const alert: Alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      resolved: false,
      ...alertData
    };

    this.alerts.push(alert);
    
    // Log alert
    const logLevel = alert.severity === 'critical' ? 'error' : 
                     alert.severity === 'warning' ? 'warn' : 'info';
    logger.log(logLevel, `ALERT [${alert.type}]: ${alert.message}`, alert.metadata);

    // Here you would integrate with external alerting systems
    // this.sendToAlertingSystem(alert);
  }

  private generateHealthAlerts(checks: HealthCheck[]): Alert[] {
    const alerts: Alert[] = [];

    for (const check of checks) {
      if (check.status === 'fail') {
        alerts.push({
          id: `health_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          severity: 'critical',
          type: 'connectivity',
          message: `Health check failed: ${check.name} - ${check.message}`,
          timestamp: new Date().toISOString(),
          resolved: false,
          metadata: check
        });
      } else if (check.status === 'warn') {
        alerts.push({
          id: `health_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          severity: 'warning',
          type: 'performance',
          message: `Health check warning: ${check.name} - ${check.message}`,
          timestamp: new Date().toISOString(),
          resolved: false,
          metadata: check
        });
      }
    }

    return alerts;
  }

  private getActiveAlerts(): Alert[] {
    return this.alerts.filter(alert => !alert.resolved);
  }

  /**
   * Resolve an alert by ID
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      logger.info(`Alert resolved: ${alert.id}`);
      return true;
    }
    return false;
  }

  /**
   * Get monitoring dashboard data
   */
  async getDashboardData(): Promise<{
    systemHealth: SystemHealthStatus;
    datasetFreshness: DatasetFreshnessStatus;
    performanceMetrics: PerformanceMetrics;
    activeAlerts: Alert[];
  }> {
    const [systemHealth, datasetFreshness, performanceMetrics] = await Promise.all([
      this.checkSystemHealth(),
      this.checkDatasetFreshness(),
      this.collectPerformanceMetrics()
    ]);

    return {
      systemHealth,
      datasetFreshness,
      performanceMetrics,
      activeAlerts: this.getActiveAlerts()
    };
  }
}

export default MonitoringService;