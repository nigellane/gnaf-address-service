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
      checkSystemResources()
    ]);

    const databaseHealth = checks[0].status === 'fulfilled' ? checks[0].value : { status: 'unhealthy', error: 'Database check failed' };
    const cacheHealth = checks[1].status === 'fulfilled' ? checks[1].value : { status: 'unhealthy', error: 'Cache check failed' };
    const systemHealth = checks[2].status === 'fulfilled' ? checks[2].value : { status: 'unhealthy', error: 'System check failed' };

    const overallStatus = (
      databaseHealth.status === 'healthy' &&
      cacheHealth.status === 'healthy' &&
      systemHealth.status === 'healthy'
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
        system: systemHealth
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
      circuitBreakerHealth,
      degradationStatus,
      performanceMetrics,
      throttlingStats
    ] = await Promise.allSettled([
      checkDatabaseHealth(),
      checkCacheHealth(),
      checkSystemResources(),
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
    
    // Simple connectivity check
    await db.query('SELECT 1 as health_check');
    const queryTime = Date.now() - startTime;
    
    // Get database metrics
    const metrics = await db.getMetrics();
    
    return {
      status: 'healthy',
      details: {
        queryTime: `${queryTime}ms`,
        connections: {
          total: metrics.totalConnections,
          idle: metrics.idleConnections,
          waiting: metrics.waitingClients
        },
        averageQueryTime: `${metrics.avgQueryTime}ms`
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
    const health = await redisManager.healthCheck();
    
    return {
      status: health.status === 'healthy' ? 'healthy' : 'unhealthy',
      details: {
        connectionStatus: health.metrics.connectionStatus,
        commandsProcessed: health.metrics.commandsProcessed,
        cacheHitRatio: `${(redisManager.getCacheHitRatio() * 100).toFixed(1)}%`,
        averageResponseTime: `${health.metrics.averageResponseTime}ms`,
        memoryUsage: health.metrics.memoryUsage
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

export default router;