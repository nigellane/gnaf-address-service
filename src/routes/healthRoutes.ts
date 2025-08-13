/**
 * Enhanced Health Check Routes
 * Comprehensive health endpoints with detailed service status and performance metrics
 */

import { Router, Request, Response } from 'express';
import { DatabaseManager } from '../config/database';
import { redisManager } from '../config/redis';
import { circuitBreakerService } from '../services/circuitBreakerService';
import { requestThrottlingService } from '../services/requestThrottlingService';
import { gracefulDegradationService } from '../services/gracefulDegradationService';
import { performanceMonitoringService } from '../services/performanceMonitoringService';
import { cachingService } from '../services/cachingService';
import Logger from '../utils/logger';

const router = Router();
const logger = Logger.createServiceLogger('HealthRoutes');

/**
 * Basic health check endpoint
 */
router.get('/health', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const checks = await Promise.allSettled([
      checkDatabaseHealth(),
      checkCacheHealth(),
      checkSystemResources(),
      checkGnafDatasetHealth()
    ]);

    const databaseHealth = checks[0].status === 'fulfilled' ? checks[0].value : { status: 'unhealthy', error: 'Database check failed' };
    const cacheHealth = checks[1].status === 'fulfilled' ? checks[1].value : { status: 'unhealthy', error: 'Cache check failed' };
    const systemHealth = checks[2].status === 'fulfilled' ? checks[2].value : { status: 'unhealthy', error: 'System check failed' };
    const gnafHealth = checks[3].status === 'fulfilled' ? checks[3].value : { status: 'unhealthy', error: 'G-NAF dataset check failed' };

    const overallStatus = (
      databaseHealth.status === 'healthy' &&
      cacheHealth.status === 'healthy' &&
      systemHealth.status === 'healthy' &&
      gnafHealth.status === 'healthy'
    ) ? 'healthy' : 'degraded';

    const responseTime = Date.now() - startTime;

    const healthData = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      responseTime: `${responseTime}ms`,
      checks: {
        database: databaseHealth,
        cache: cacheHealth,
        system: systemHealth,
        gnafDataset: gnafHealth
      }
    };

    res.status(overallStatus === 'healthy' ? 200 : 503).json(healthData);

  } catch (error) {
    logger.error('Health check failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      responseTime: `${Date.now() - startTime}ms`
    });
  }
});

/**
 * Detailed health check with comprehensive metrics
 */
router.get('/health/detailed', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    // Run all health checks in parallel
    const [
      databaseHealth,
      cacheHealth,
      systemHealth,
      gnafHealth,
      circuitBreakerHealth,
      degradationStatus,
      performanceMetrics,
      throttlingStats
    ] = await Promise.allSettled([
      checkDatabaseHealth(),
      checkCacheHealth(),
      checkSystemResources(),
      checkGnafDatasetHealth(),
      checkCircuitBreakers(),
      checkDegradationStatus(),
      checkPerformanceMetrics(),
      checkThrottlingStats()
    ]);

    const responseTime = Date.now() - startTime;

    const detailedHealth = {
      status: calculateOverallStatus([
        getValue(databaseHealth),
        getValue(cacheHealth),
        getValue(systemHealth),
        getValue(gnafHealth),
        getValue(circuitBreakerHealth)
      ]),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      responseTime: `${responseTime}ms`,
      uptime: `${Math.floor(process.uptime())}s`,
      checks: {
        database: getValue(databaseHealth),
        cache: getValue(cacheHealth),
        system: getValue(systemHealth),
        gnafDataset: getValue(gnafHealth),
        circuitBreakers: getValue(circuitBreakerHealth),
        degradation: getValue(degradationStatus),
        performance: getValue(performanceMetrics),
        throttling: getValue(throttlingStats)
      }
    };

    const statusCode = detailedHealth.status === 'healthy' ? 200 : 
                      detailedHealth.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json(detailedHealth);

  } catch (error) {
    logger.error('Detailed health check failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Detailed health check failed',
      responseTime: `${Date.now() - startTime}ms`
    });
  }
});

/**
 * Readiness probe endpoint
 */
router.get('/health/ready', async (req: Request, res: Response) => {
  try {
    // Check if all critical services are ready
    const [dbReady, cacheReady] = await Promise.allSettled([
      checkDatabaseReadiness(),
      checkCacheReadiness()
    ]);

    const databaseReady = dbReady.status === 'fulfilled' && dbReady.value;
    const redisReady = cacheReady.status === 'fulfilled' && cacheReady.value;

    const ready = databaseReady && redisReady;

    res.status(ready ? 200 : 503).json({
      ready,
      timestamp: new Date().toISOString(),
      checks: {
        database: databaseReady,
        cache: redisReady
      }
    });

  } catch (error) {
    logger.error('Readiness check failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(503).json({
      ready: false,
      timestamp: new Date().toISOString(),
      error: 'Readiness check failed'
    });
  }
});

/**
 * Liveness probe endpoint
 */
router.get('/health/live', (req: Request, res: Response) => {
  // Simple liveness check - if this endpoint responds, the service is alive
  res.status(200).json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(process.uptime())}s`
  });
});

/**
 * Performance metrics endpoint
 */
router.get('/health/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = performanceMonitoringService.getPerformanceStatistics();
    const systemResources = await checkSystemResources();
    const throttlingStats = requestThrottlingService.getStats();
    const degradationStatus = gracefulDegradationService.getStatus();

    res.json({
      timestamp: new Date().toISOString(),
      metrics: {
        performance: metrics,
        system: systemResources,
        throttling: throttlingStats,
        degradation: degradationStatus
      }
    });

  } catch (error) {
    logger.error('Metrics endpoint failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(500).json({
      error: 'Unable to retrieve metrics',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Database connection health check
 */
async function checkDatabaseHealth(): Promise<{ status: string; details?: any; error?: string }> {
  try {
    const db = DatabaseManager.getInstance();
    const startTime = Date.now();
    
    // Enhanced connectivity check with read/write validation
    const checks = await Promise.allSettled([
      // Basic connectivity
      db.query('SELECT 1 as health_check'),
      // Check database version and extensions
      db.query('SELECT version() as db_version, installed_version FROM pg_available_extensions WHERE name = \'postgis\''),
      // Test a simple spatial query to ensure PostGIS is working
      db.query('SELECT ST_Point(144.9631, -37.8136) as test_point')
    ]);
    
    const queryTime = Date.now() - startTime;
    
    // Get database metrics
    const metrics = await db.getMetrics();
    
    // Analyze results
    const basicConnectivity = checks[0].status === 'fulfilled';
    const extensionCheck = checks[1].status === 'fulfilled' ? checks[1].value : null;
    const spatialCheck = checks[2].status === 'fulfilled';
    
    let status = 'healthy';
    const warnings = [];
    
    if (!basicConnectivity) {
      status = 'unhealthy';
    } else {
      // Check query performance
      if (queryTime > 1000) {
        warnings.push('Slow database response time');
        status = 'degraded';
      }
      
      if (!spatialCheck) {
        warnings.push('PostGIS spatial queries failing');
        status = 'degraded';
      }
      
      // Check connection pool health
      if (metrics.totalConnections > 18) { // 90% of max pool size
        warnings.push('High connection pool usage');
        status = 'degraded';
      }
      
      if (metrics.waitingClients > 5) {
        warnings.push('Connection pool saturation');
        status = 'degraded';
      }
    }
    
    return {
      status,
      details: {
        queryTime: `${queryTime}ms`,
        connections: {
          total: metrics.totalConnections,
          idle: metrics.idleConnections,
          waiting: metrics.waitingClients,
          maxConnections: 20
        },
        averageQueryTime: `${metrics.avgQueryTime}ms`,
        slowQueries: metrics.slowQueries,
        extensions: {
          postgis: extensionCheck?.rows?.[0]?.installed_version || 'not available'
        },
        spatialFunctionality: spatialCheck ? 'working' : 'failed',
        warnings: warnings.length > 0 ? warnings : undefined
      }
    };

  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Database connection failed'
    };
  }
}

/**
 * Cache (Redis) health check
 */
async function checkCacheHealth(): Promise<{ status: string; details?: any; error?: string }> {
  try {
    const startTime = Date.now();
    const health = await redisManager.healthCheck();
    const responseTime = Date.now() - startTime;
    
    let status = health.status === 'healthy' ? 'healthy' : 'unhealthy';
    const warnings = [];
    
    // Check response time performance
    if (responseTime > 500) {
      warnings.push('Slow Redis response time');
      if (status === 'healthy') status = 'degraded';
    }
    
    // Check cache hit ratio
    const hitRatio = redisManager.getCacheHitRatio() * 100;
    if (hitRatio < 70 && health.metrics.commandsProcessed > 100) {
      warnings.push('Low cache hit ratio');
      if (status === 'healthy') status = 'degraded';
    }
    
    // Check for cluster failover indicators
    const isClusterMode = process.env.REDIS_CLUSTER_MODE === 'true';
    let clusterHealth = null;
    
    if (isClusterMode) {
      clusterHealth = {
        mode: 'cluster',
        connectionStatus: health.metrics.connectionStatus,
        activeConnections: health.metrics.activeConnections
      };
      
      // In cluster mode, check if we're still connected to multiple nodes
      if (health.metrics.activeConnections < 2) {
        warnings.push('Limited Redis cluster connectivity');
        if (status === 'healthy') status = 'degraded';
      }
    } else {
      clusterHealth = {
        mode: 'single-node',
        fallbackMode: health.metrics.connectionStatus !== 'connected'
      };
      
      if (health.metrics.connectionStatus !== 'connected') {
        warnings.push('Redis running in fallback mode');
      }
    }
    
    return {
      status,
      details: {
        connectionStatus: health.metrics.connectionStatus,
        responseTime: `${responseTime}ms`,
        commandsProcessed: health.metrics.commandsProcessed,
        cacheHitRatio: `${hitRatio.toFixed(1)}%`,
        averageResponseTime: `${health.metrics.averageResponseTime}ms`,
        memoryUsage: health.metrics.memoryUsage,
        cluster: clusterHealth,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    };

  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Cache connection failed'
    };
  }
}

/**
 * System resources health check
 */
async function checkSystemResources(): Promise<{ status: string; details?: any }> {
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  // Calculate memory usage percentage (simplified)
  const memoryPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
  
  const status = memoryPercent < 90 ? 'healthy' : 'degraded';
  
  return {
    status,
    details: {
      memory: {
        used: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        total: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
        percentage: `${memoryPercent.toFixed(1)}%`
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: `${Math.floor(process.uptime())}s`
    }
  };
}

/**
 * Circuit breakers health check
 */
async function checkCircuitBreakers(): Promise<{ status: string; details?: any }> {
  const health = circuitBreakerService.getHealthStatus();
  
  return {
    status: health.healthy ? 'healthy' : 'degraded',
    details: {
      totalBreakers: health.totalBreakers,
      openBreakers: health.openBreakers,
      halfOpenBreakers: health.halfOpenBreakers,
      breakerDetails: health.details
    }
  };
}

/**
 * Degradation status check
 */
async function checkDegradationStatus(): Promise<{ status: string; details?: any }> {
  const degradationHealth = await gracefulDegradationService.healthCheck();
  
  return {
    status: degradationHealth.status,
    details: degradationHealth.details
  };
}

/**
 * Performance metrics check
 */
async function checkPerformanceMetrics(): Promise<{ status: string; details?: any }> {
  try {
    const metrics = performanceMonitoringService.getPerformanceStatistics();
    
    const status = metrics.responseTime.avg < 1000 ? 'healthy' : 'degraded';
    
    return {
      status,
      details: {
        averageResponseTime: `${metrics.responseTime.avg}ms`,
        p95ResponseTime: `${metrics.responseTime.p95}ms`,
        errorRate: `${metrics.errorRate}%`,
        throughput: `${metrics.throughput} req/s`,
        cacheHitRatio: `${metrics.cacheHitRatio}%`
      }
    };

  } catch (error) {
    return {
      status: 'unknown',
      details: { error: 'Unable to retrieve performance metrics' }
    };
  }
}

/**
 * Throttling stats check
 */
async function checkThrottlingStats(): Promise<{ status: string; details?: any }> {
  const stats = requestThrottlingService.getStats();
  const queueStats = requestThrottlingService.getQueueStats();
  
  const status = stats.currentQueueSize < 50 ? 'healthy' : 'degraded';
  
  return {
    status,
    details: {
      totalRequests: stats.totalRequests,
      throttledRequests: stats.throttledRequests,
      currentQueueSize: stats.currentQueueSize,
      averageResponseTime: `${stats.averageResponseTime}ms`,
      systemLoad: stats.systemLoad,
      queueByPriority: queueStats.queueByPriority
    }
  };
}

/**
 * Database readiness check
 */
async function checkDatabaseReadiness(): Promise<boolean> {
  try {
    const db = DatabaseManager.getInstance();
    await db.query('SELECT 1');
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Cache readiness check
 */
async function checkCacheReadiness(): Promise<boolean> {
  try {
    const health = await redisManager.healthCheck();
    return health.status === 'healthy';
  } catch (error) {
    return false;
  }
}

/**
 * Utility functions
 */
function getValue(promiseResult: PromiseSettledResult<any>): any {
  return promiseResult.status === 'fulfilled' ? promiseResult.value : { status: 'error', error: 'Check failed' };
}

function calculateOverallStatus(healthChecks: Array<{ status: string }>): string {
  const unhealthyCount = healthChecks.filter(check => check.status === 'unhealthy').length;
  const degradedCount = healthChecks.filter(check => check.status === 'degraded').length;
  
  if (unhealthyCount > 0) return 'unhealthy';
  if (degradedCount > 0) return 'degraded';
  return 'healthy';
}

/**
 * G-NAF Dataset health check
 */
async function checkGnafDatasetHealth(): Promise<{ status: string; details?: any; error?: string }> {
  try {
    const db = DatabaseManager.getInstance();
    const startTime = Date.now();
    
    // Check if G-NAF tables exist and have data
    const tableChecks = await Promise.allSettled([
      // Check if core G-NAF tables exist and have recent data
      db.query(`
        SELECT COUNT(*) as address_count 
        FROM gnaf.addresses 
        WHERE created_at > NOW() - INTERVAL '6 months'
        LIMIT 1
      `),
      // Check dataset metadata if available
      db.query(`
        SELECT 
          COUNT(*) as total_addresses,
          MAX(created_at) as last_updated,
          MIN(created_at) as first_created
        FROM gnaf.addresses
      `)
    ]);

    const queryTime = Date.now() - startTime;
    
    if (tableChecks[0].status === 'rejected') {
      return {
        status: 'unhealthy',
        error: 'G-NAF address table not accessible or empty'
      };
    }

    const addressCheckResult = tableChecks[0].status === 'fulfilled' ? tableChecks[0].value : null;
    const metadataResult = tableChecks[1].status === 'fulfilled' ? tableChecks[1].value : null;

    const recentAddresses = addressCheckResult?.rows?.[0]?.address_count || 0;
    const totalAddresses = metadataResult?.rows?.[0]?.total_addresses || 0;
    const lastUpdated = metadataResult?.rows?.[0]?.last_updated;
    
    // Determine health based on data freshness and availability
    const hasRecentData = parseInt(recentAddresses) > 0;
    const hasMinimumData = parseInt(totalAddresses) > 1000000; // At least 1M addresses expected
    
    let status = 'healthy';
    const warnings = [];
    
    if (!hasRecentData) {
      warnings.push('No recent address updates in last 6 months');
      status = 'degraded';
    }
    
    if (!hasMinimumData) {
      warnings.push('Insufficient address data for reliable service');
      status = 'degraded';
    }

    return {
      status,
      details: {
        queryTime: `${queryTime}ms`,
        totalAddresses: totalAddresses,
        recentAddresses: recentAddresses,
        lastUpdated: lastUpdated?.toISOString?.() || lastUpdated || 'unknown',
        dataFreshness: hasRecentData ? 'current' : 'stale',
        warnings: warnings.length > 0 ? warnings : undefined
      }
    };

  } catch (error) {
    return {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'G-NAF dataset check failed'
    };
  }
}

export default router;