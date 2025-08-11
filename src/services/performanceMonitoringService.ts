/**
 * Performance Monitoring Service
 * Comprehensive performance tracking, metrics collection, and alerting
 */

import { DatabaseManager } from '../config/database';
import { cachingService } from './cachingService';
import { redisManager } from '../config/redis';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('PerformanceMonitoring');

export interface PerformanceMetrics {
  timestamp: Date;
  endpoint: string;
  method: string;
  responseTime: number;
  statusCode: number;
  cacheHit: boolean;
  dbQueryTime?: number;
  dbQueryCount?: number;
  errorRate: number;
  throughput: number;
  memoryUsage: number;
  cpuUsage?: number;
}

export interface PerformanceAlert {
  id: string;
  type: 'response_time' | 'error_rate' | 'throughput' | 'database' | 'cache';
  severity: 'warning' | 'error' | 'critical';
  message: string;
  threshold: number;
  currentValue: number;
  timestamp: Date;
  resolved: boolean;
}

export interface PerformanceThresholds {
  responseTime: {
    warning: number;
    error: number;
    critical: number;
  };
  errorRate: {
    warning: number;
    error: number;
    critical: number;
  };
  throughput: {
    warning: number; // requests per second
  };
  database: {
    maxConnections: number;
    slowQueryThreshold: number;
  };
  cache: {
    minHitRatio: number;
    maxMemoryUsage: number;
  };
}

export class PerformanceMonitoringService {
  private static instance: PerformanceMonitoringService;
  private db: DatabaseManager;
  private metrics: PerformanceMetrics[] = [];
  private alerts: PerformanceAlert[] = [];
  private readonly MAX_METRICS_HISTORY = 10000;
  private readonly ALERT_CHECK_INTERVAL = 30000; // 30 seconds
  private alertTimer?: ReturnType<typeof setInterval>;

  private readonly DEFAULT_THRESHOLDS: PerformanceThresholds = {
    responseTime: {
      warning: 500,   // 500ms
      error: 1000,    // 1s
      critical: 3000  // 3s
    },
    errorRate: {
      warning: 0.05,  // 5%
      error: 0.10,    // 10%
      critical: 0.20  // 20%
    },
    throughput: {
      warning: 10     // < 10 req/s
    },
    database: {
      maxConnections: 18, // 90% of max pool size (20)
      slowQueryThreshold: 5000 // 5 seconds
    },
    cache: {
      minHitRatio: 0.7,    // 70%
      maxMemoryUsage: 512  // 512MB
    }
  };

  constructor() {
    this.db = DatabaseManager.getInstance();
    this.startPerformanceMonitoring();
  }

  static getInstance(): PerformanceMonitoringService {
    if (!this.instance) {
      this.instance = new PerformanceMonitoringService();
    }
    return this.instance;
  }

  /**
   * Record performance metrics for a request
   */
  recordMetrics(metrics: Partial<PerformanceMetrics>): void {
    const fullMetrics: PerformanceMetrics = {
      timestamp: new Date(),
      endpoint: metrics.endpoint || 'unknown',
      method: metrics.method || 'GET',
      responseTime: metrics.responseTime || 0,
      statusCode: metrics.statusCode || 200,
      cacheHit: metrics.cacheHit || false,
      dbQueryTime: metrics.dbQueryTime,
      dbQueryCount: metrics.dbQueryCount,
      errorRate: 0, // Will be calculated in aggregation
      throughput: 0, // Will be calculated in aggregation
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 // MB
    };

    this.metrics.push(fullMetrics);

    // Keep only recent metrics
    if (this.metrics.length > this.MAX_METRICS_HISTORY) {
      this.metrics = this.metrics.slice(-this.MAX_METRICS_HISTORY);
    }

    logger.debug('Performance metrics recorded', {
      endpoint: fullMetrics.endpoint,
      responseTime: fullMetrics.responseTime,
      statusCode: fullMetrics.statusCode,
      cacheHit: fullMetrics.cacheHit
    });
  }

  /**
   * Get aggregated performance statistics for time period
   */
  getPerformanceStatistics(periodMinutes: number = 5): {
    responseTime: { avg: number; p95: number; p99: number };
    errorRate: number;
    throughput: number;
    cacheHitRatio: number;
    topEndpoints: Array<{ endpoint: string; count: number; avgResponseTime: number }>;
  } {
    const cutoffTime = new Date(Date.now() - periodMinutes * 60 * 1000);
    const recentMetrics = this.metrics.filter(m => m.timestamp >= cutoffTime);

    if (recentMetrics.length === 0) {
      return {
        responseTime: { avg: 0, p95: 0, p99: 0 },
        errorRate: 0,
        throughput: 0,
        cacheHitRatio: 0,
        topEndpoints: []
      };
    }

    // Response time statistics
    const responseTimes = recentMetrics.map(m => m.responseTime).sort((a, b) => a - b);
    const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);

    // Error rate
    const errorCount = recentMetrics.filter(m => m.statusCode >= 400).length;
    const errorRate = errorCount / recentMetrics.length;

    // Throughput (requests per second)
    const throughput = recentMetrics.length / (periodMinutes * 60);

    // Cache hit ratio
    const cacheHits = recentMetrics.filter(m => m.cacheHit).length;
    const cacheHitRatio = cacheHits / recentMetrics.length;

    // Top endpoints
    const endpointMap = new Map<string, { count: number; totalResponseTime: number }>();
    recentMetrics.forEach(m => {
      const existing = endpointMap.get(m.endpoint) || { count: 0, totalResponseTime: 0 };
      endpointMap.set(m.endpoint, {
        count: existing.count + 1,
        totalResponseTime: existing.totalResponseTime + m.responseTime
      });
    });

    const topEndpoints = Array.from(endpointMap.entries())
      .map(([endpoint, stats]) => ({
        endpoint,
        count: stats.count,
        avgResponseTime: stats.totalResponseTime / stats.count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      responseTime: {
        avg: Math.round(avgResponseTime),
        p95: responseTimes[p95Index] || 0,
        p99: responseTimes[p99Index] || 0
      },
      errorRate: Math.round(errorRate * 10000) / 100, // Percentage with 2 decimal places
      throughput: Math.round(throughput * 100) / 100,
      cacheHitRatio: Math.round(cacheHitRatio * 10000) / 100,
      topEndpoints
    };
  }

  /**
   * Check for performance issues and generate alerts
   */
  async checkPerformanceAlerts(): Promise<PerformanceAlert[]> {
    const newAlerts: PerformanceAlert[] = [];
    const stats = this.getPerformanceStatistics(5); // Last 5 minutes

    try {
      // Response time alerts
      if (stats.responseTime.p95 > this.DEFAULT_THRESHOLDS.responseTime.critical) {
        newAlerts.push(this.createAlert('response_time', 'critical', 
          `Critical: 95th percentile response time is ${stats.responseTime.p95}ms`,
          this.DEFAULT_THRESHOLDS.responseTime.critical, stats.responseTime.p95));
      } else if (stats.responseTime.p95 > this.DEFAULT_THRESHOLDS.responseTime.error) {
        newAlerts.push(this.createAlert('response_time', 'error',
          `Error: 95th percentile response time is ${stats.responseTime.p95}ms`,
          this.DEFAULT_THRESHOLDS.responseTime.error, stats.responseTime.p95));
      } else if (stats.responseTime.p95 > this.DEFAULT_THRESHOLDS.responseTime.warning) {
        newAlerts.push(this.createAlert('response_time', 'warning',
          `Warning: 95th percentile response time is ${stats.responseTime.p95}ms`,
          this.DEFAULT_THRESHOLDS.responseTime.warning, stats.responseTime.p95));
      }

      // Error rate alerts
      if (stats.errorRate > this.DEFAULT_THRESHOLDS.errorRate.critical * 100) {
        newAlerts.push(this.createAlert('error_rate', 'critical',
          `Critical: Error rate is ${stats.errorRate}%`,
          this.DEFAULT_THRESHOLDS.errorRate.critical * 100, stats.errorRate));
      } else if (stats.errorRate > this.DEFAULT_THRESHOLDS.errorRate.error * 100) {
        newAlerts.push(this.createAlert('error_rate', 'error',
          `Error: Error rate is ${stats.errorRate}%`,
          this.DEFAULT_THRESHOLDS.errorRate.error * 100, stats.errorRate));
      } else if (stats.errorRate > this.DEFAULT_THRESHOLDS.errorRate.warning * 100) {
        newAlerts.push(this.createAlert('error_rate', 'warning',
          `Warning: Error rate is ${stats.errorRate}%`,
          this.DEFAULT_THRESHOLDS.errorRate.warning * 100, stats.errorRate));
      }

      // Throughput alerts
      if (stats.throughput < this.DEFAULT_THRESHOLDS.throughput.warning) {
        newAlerts.push(this.createAlert('throughput', 'warning',
          `Warning: Low throughput at ${stats.throughput} requests/second`,
          this.DEFAULT_THRESHOLDS.throughput.warning, stats.throughput));
      }

      // Database alerts
      const dbMetrics = this.db.getMetrics();
      if (dbMetrics.totalConnections > this.DEFAULT_THRESHOLDS.database.maxConnections) {
        newAlerts.push(this.createAlert('database', 'warning',
          `Warning: High database connections (${dbMetrics.totalConnections})`,
          this.DEFAULT_THRESHOLDS.database.maxConnections, dbMetrics.totalConnections));
      }

      // Cache alerts
      const cacheMetrics = await cachingService.getMetrics();
      const overallHitRatio = cacheMetrics.overall.hitRatio;
      if (overallHitRatio < this.DEFAULT_THRESHOLDS.cache.minHitRatio) {
        newAlerts.push(this.createAlert('cache', 'warning',
          `Warning: Low cache hit ratio (${Math.round(overallHitRatio * 100)}%)`,
          this.DEFAULT_THRESHOLDS.cache.minHitRatio, overallHitRatio));
      }

      // Add new alerts to history
      this.alerts.push(...newAlerts);
      
      // Keep only recent alerts (last 24 hours)
      const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
      this.alerts = this.alerts.filter(alert => alert.timestamp >= cutoffTime);

      if (newAlerts.length > 0) {
        logger.warn('Performance alerts generated', { alertCount: newAlerts.length });
      }

      return newAlerts;

    } catch (error) {
      logger.error('Failed to check performance alerts', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Get current system health status
   */
  async getSystemHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    components: {
      database: { status: string; details: any };
      cache: { status: string; details: any };
      performance: { status: string; details: any };
    };
    alerts: PerformanceAlert[];
  }> {
    try {
      // Database health
      const dbMetrics = this.db.getMetrics();
      const dbHealth = {
        status: dbMetrics.totalConnections < this.DEFAULT_THRESHOLDS.database.maxConnections ? 'healthy' : 'degraded',
        details: {
          connections: `${dbMetrics.totalConnections}/${this.DEFAULT_THRESHOLDS.database.maxConnections + 2}`,
          averageQueryTime: `${dbMetrics.avgQueryTime}ms`,
          slowQueries: dbMetrics.slowQueries
        }
      };

      // Cache health
      const cacheHealth = await cachingService.healthCheck();

      // Performance health
      const stats = this.getPerformanceStatistics(5);
      const perfHealth = {
        status: stats.responseTime.p95 < this.DEFAULT_THRESHOLDS.responseTime.error ? 'healthy' : 'degraded',
        details: {
          responseTimeP95: `${stats.responseTime.p95}ms`,
          errorRate: `${stats.errorRate}%`,
          throughput: `${stats.throughput} req/s`,
          cacheHitRatio: `${stats.cacheHitRatio}%`
        }
      };

      // Overall system status
      const componentStatuses = [dbHealth.status, cacheHealth.status, perfHealth.status];
      let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (componentStatuses.includes('unhealthy')) {
        overallStatus = 'unhealthy';
      } else if (componentStatuses.includes('degraded')) {
        overallStatus = 'degraded';
      }

      // Get recent unresolved alerts
      const recentAlerts = this.alerts
        .filter(alert => !alert.resolved)
        .filter(alert => alert.timestamp >= new Date(Date.now() - 60 * 60 * 1000)) // Last hour
        .slice(0, 10);

      return {
        status: overallStatus,
        components: {
          database: dbHealth,
          cache: cacheHealth,
          performance: perfHealth
        },
        alerts: recentAlerts
      };

    } catch (error) {
      logger.error('Failed to get system health status', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        status: 'unhealthy',
        components: {
          database: { status: 'unknown', details: {} },
          cache: { status: 'unknown', details: {} },
          performance: { status: 'unknown', details: {} }
        },
        alerts: []
      };
    }
  }

  /**
   * Start performance monitoring background task
   */
  private startPerformanceMonitoring(): void {
    logger.info('Starting performance monitoring');

    // Check alerts periodically
    this.alertTimer = setInterval(async () => {
      try {
        await this.checkPerformanceAlerts();
      } catch (error) {
        logger.error('Performance monitoring check failed', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, this.ALERT_CHECK_INTERVAL);

    // Log performance summary every 5 minutes
    setInterval(() => {
      try {
        const stats = this.getPerformanceStatistics(5);
        logger.info('Performance summary', {
          responseTime: stats.responseTime,
          errorRate: `${stats.errorRate}%`,
          throughput: `${stats.throughput} req/s`,
          cacheHitRatio: `${stats.cacheHitRatio}%`
        });
      } catch (error) {
        logger.error('Failed to log performance summary', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Stop performance monitoring
   */
  stopPerformanceMonitoring(): void {
    if (this.alertTimer) {
      clearInterval(this.alertTimer);
      this.alertTimer = undefined;
    }
    logger.info('Performance monitoring stopped');
  }

  /**
   * Resolve a performance alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      logger.info('Performance alert resolved', { alertId, type: alert.type, severity: alert.severity });
      return true;
    }
    return false;
  }

  /**
   * Get performance metrics for specific endpoint
   */
  getEndpointMetrics(endpoint: string, periodMinutes: number = 60): {
    requestCount: number;
    averageResponseTime: number;
    errorRate: number;
    cacheHitRatio: number;
  } {
    const cutoffTime = new Date(Date.now() - periodMinutes * 60 * 1000);
    const endpointMetrics = this.metrics.filter(m => 
      m.endpoint === endpoint && m.timestamp >= cutoffTime
    );

    if (endpointMetrics.length === 0) {
      return {
        requestCount: 0,
        averageResponseTime: 0,
        errorRate: 0,
        cacheHitRatio: 0
      };
    }

    const totalResponseTime = endpointMetrics.reduce((sum, m) => sum + m.responseTime, 0);
    const errorCount = endpointMetrics.filter(m => m.statusCode >= 400).length;
    const cacheHits = endpointMetrics.filter(m => m.cacheHit).length;

    return {
      requestCount: endpointMetrics.length,
      averageResponseTime: Math.round(totalResponseTime / endpointMetrics.length),
      errorRate: Math.round((errorCount / endpointMetrics.length) * 10000) / 100,
      cacheHitRatio: Math.round((cacheHits / endpointMetrics.length) * 10000) / 100
    };
  }

  private createAlert(
    type: PerformanceAlert['type'],
    severity: PerformanceAlert['severity'],
    message: string,
    threshold: number,
    currentValue: number
  ): PerformanceAlert {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      type,
      severity,
      message,
      threshold,
      currentValue,
      timestamp: new Date(),
      resolved: false
    };
  }
}

export const performanceMonitoringService = PerformanceMonitoringService.getInstance();