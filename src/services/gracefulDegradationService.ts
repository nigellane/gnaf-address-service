/**
 * Graceful Degradation Service
 * Manages service degradation modes and fallback mechanisms during high load or failures
 */

import Logger from '../utils/logger';
import { circuitBreakerService } from './circuitBreakerService';
import { requestThrottlingService } from './requestThrottlingService';
import { cachingService } from './cachingService';
import { EventEmitter } from 'events';

const logger = Logger.createServiceLogger('GracefulDegradation');

export type DegradationLevel = 'normal' | 'reduced' | 'minimal' | 'emergency';

export interface DegradationConfig {
  enabled: boolean;
  autoMode: boolean;
  thresholds: {
    reduced: {
      errorRate: number;
      responseTime: number;
      cpuUsage: number;
      memoryUsage: number;
    };
    minimal: {
      errorRate: number;
      responseTime: number;
      cpuUsage: number;
      memoryUsage: number;
    };
    emergency: {
      errorRate: number;
      responseTime: number;
      cpuUsage: number;
      memoryUsage: number;
    };
  };
  fallbackStrategies: {
    cacheOnly: boolean;
    readOnlyMode: boolean;
    simplifiedResponses: boolean;
    disableNonEssential: boolean;
  };
}

export interface SystemMetrics {
  errorRate: number;
  averageResponseTime: number;
  cpuUsage: number;
  memoryUsage: number;
  databaseHealth: boolean;
  cacheHealth: boolean;
  circuitBreakersOpen: number;
}

export interface DegradationStatus {
  level: DegradationLevel;
  reason: string;
  activeSince: Date;
  affectedFeatures: string[];
  fallbacksActive: string[];
  metrics: SystemMetrics;
}

export class GracefulDegradationService extends EventEmitter {
  private static instance: GracefulDegradationService;
  private currentLevel: DegradationLevel = 'normal';
  private degradationStartTime?: Date;
  private config: DegradationConfig;
  private systemMetrics: SystemMetrics = {
    errorRate: 0,
    averageResponseTime: 0,
    cpuUsage: 0,
    memoryUsage: 0,
    databaseHealth: true,
    cacheHealth: true,
    circuitBreakersOpen: 0
  };
  private monitoringInterval?: ReturnType<typeof setInterval>;
  private affectedFeatures: string[] = [];
  private fallbacksActive: string[] = [];

  static getInstance(): GracefulDegradationService {
    if (!this.instance) {
      this.instance = new GracefulDegradationService();
    }
    return this.instance;
  }

  constructor() {
    super();
    this.config = this.getDefaultConfig();
    this.startSystemMonitoring();
  }

  initialize(config?: Partial<DegradationConfig>): void {
    this.config = { ...this.config, ...config };
    
    logger.info('Graceful degradation service initialized', {
      enabled: this.config.enabled,
      autoMode: this.config.autoMode,
      currentLevel: this.currentLevel
    });
  }

  /**
   * Manually set degradation level
   */
  setDegradationLevel(level: DegradationLevel, reason: string): void {
    if (this.currentLevel === level) {
      return;
    }

    const previousLevel = this.currentLevel;
    this.currentLevel = level;
    this.degradationStartTime = new Date();
    
    this.applyDegradationLevel(level);
    
    logger.warn('Degradation level changed', {
      previousLevel,
      newLevel: level,
      reason,
      autoMode: this.config.autoMode
    });

    this.emit('degradationLevelChanged', {
      previousLevel,
      newLevel: level,
      reason,
      status: this.getStatus()
    });
  }

  /**
   * Check if specific feature should be degraded
   */
  shouldDegradeFeature(featureName: string): boolean {
    if (!this.config.enabled) {
      return false;
    }

    switch (this.currentLevel) {
      case 'reduced':
        return this.isNonEssentialFeature(featureName);
      case 'minimal':
        return !this.isEssentialFeature(featureName);
      case 'emergency':
        return !this.isCriticalFeature(featureName);
      default:
        return false;
    }
  }

  /**
   * Get fallback response for degraded features
   */
  getFallbackResponse(featureName: string): any {
    const fallbacks: { [key: string]: any } = {
      'address-search': {
        addresses: [],
        message: 'Address search is temporarily limited. Please try again later.',
        degraded: true
      },
      'spatial-analysis': {
        results: [],
        message: 'Spatial analysis is temporarily unavailable. Basic address validation is still available.',
        degraded: true
      },
      'batch-processing': {
        error: 'Batch processing is temporarily disabled during high load periods.',
        degraded: true
      },
      'export-functionality': {
        error: 'Export functionality is temporarily unavailable.',
        degraded: true
      },
      'advanced-geocoding': {
        message: 'Advanced geocoding features are temporarily limited. Basic geocoding is available.',
        degraded: true
      }
    };

    return fallbacks[featureName] || {
      error: 'This feature is temporarily unavailable.',
      degraded: true
    };
  }

  /**
   * Execute operation with degradation awareness
   */
  async executeWithDegradation<T>(
    featureName: string,
    normalOperation: () => Promise<T>,
    fallbackOperation?: () => Promise<T>
  ): Promise<T> {
    if (!this.shouldDegradeFeature(featureName)) {
      return await normalOperation();
    }

    logger.info('Feature degraded, using fallback', {
      feature: featureName,
      degradationLevel: this.currentLevel
    });

    if (fallbackOperation) {
      return await fallbackOperation();
    }

    throw new Error(`Feature ${featureName} is temporarily unavailable due to system degradation.`);
  }

  /**
   * Cache-only fallback for database operations
   */
  async executeCacheOnlyFallback<T>(
    cacheKey: string,
    databaseOperation: () => Promise<T>,
    fallbackValue?: T
  ): Promise<T> {
    if (this.config.fallbackStrategies.cacheOnly && this.currentLevel !== 'normal') {
      try {
        const cached = await cachingService.get(cacheKey);
        if (cached) {
          logger.debug('Using cache-only fallback', { cacheKey });
          return cached as T;
        }
      } catch (error) {
        logger.warn('Cache fallback failed', {
          cacheKey,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      if (fallbackValue !== undefined) {
        return fallbackValue;
      }

      throw new Error('Data temporarily unavailable - please try again later.');
    }

    return await databaseOperation();
  }

  /**
   * Get current status
   */
  getStatus(): DegradationStatus {
    return {
      level: this.currentLevel,
      reason: this.getDegradationReason(),
      activeSince: this.degradationStartTime || new Date(),
      affectedFeatures: [...this.affectedFeatures],
      fallbacksActive: [...this.fallbacksActive],
      metrics: { ...this.systemMetrics }
    };
  }

  /**
   * Health check for degradation service
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    level: DegradationLevel;
    details: DegradationStatus;
  }> {
    const status = this.getStatus();
    
    let healthStatus: 'healthy' | 'degraded' | 'unhealthy';
    
    if (this.currentLevel === 'emergency') {
      healthStatus = 'unhealthy';
    } else if (this.currentLevel !== 'normal') {
      healthStatus = 'degraded';
    } else {
      healthStatus = 'healthy';
    }

    return {
      status: healthStatus,
      level: this.currentLevel,
      details: status
    };
  }

  private startSystemMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      await this.updateSystemMetrics();
      
      if (this.config.enabled && this.config.autoMode) {
        this.evaluateDegradationLevel();
      }
    }, 10000); // Check every 10 seconds
  }

  private async updateSystemMetrics(): Promise<void> {
    try {
      // Get throttling stats
      const throttlingStats = requestThrottlingService.getStats();
      
      // Get circuit breaker stats
      const circuitBreakerHealth = circuitBreakerService.getHealthStatus();
      
      // Update metrics
      this.systemMetrics = {
        errorRate: this.calculateErrorRate(throttlingStats),
        averageResponseTime: throttlingStats.averageResponseTime,
        cpuUsage: throttlingStats.systemLoad.cpu,
        memoryUsage: throttlingStats.systemLoad.memory,
        databaseHealth: this.checkDatabaseHealth(),
        cacheHealth: await this.checkCacheHealth(),
        circuitBreakersOpen: circuitBreakerHealth.openBreakers
      };

    } catch (error) {
      logger.error('Failed to update system metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private calculateErrorRate(stats: any): number {
    const total = stats.totalRequests;
    const successful = stats.successfulRequests;
    return total > 0 ? ((total - successful) / total) * 100 : 0;
  }

  private checkDatabaseHealth(): boolean {
    const dbBreaker = circuitBreakerService.getCircuitBreaker('database');
    return !dbBreaker || dbBreaker.getStats().state !== 'OPEN';
  }

  private async checkCacheHealth(): Promise<boolean> {
    try {
      // Simple cache health check
      await cachingService.get('health-check-key');
      return true;
    } catch (error) {
      return false;
    }
  }

  private evaluateDegradationLevel(): void {
    const metrics = this.systemMetrics;
    const thresholds = this.config.thresholds;

    let targetLevel: DegradationLevel = 'normal';
    let reason = '';

    // Check emergency thresholds first
    if (metrics.errorRate >= thresholds.emergency.errorRate ||
        metrics.averageResponseTime >= thresholds.emergency.responseTime ||
        metrics.cpuUsage >= thresholds.emergency.cpuUsage ||
        metrics.memoryUsage >= thresholds.emergency.memoryUsage) {
      targetLevel = 'emergency';
      reason = 'Critical system metrics exceeded emergency thresholds';
    }
    // Check minimal thresholds
    else if (metrics.errorRate >= thresholds.minimal.errorRate ||
             metrics.averageResponseTime >= thresholds.minimal.responseTime ||
             metrics.cpuUsage >= thresholds.minimal.cpuUsage ||
             metrics.memoryUsage >= thresholds.minimal.memoryUsage) {
      targetLevel = 'minimal';
      reason = 'System metrics exceeded minimal operation thresholds';
    }
    // Check reduced thresholds
    else if (metrics.errorRate >= thresholds.reduced.errorRate ||
             metrics.averageResponseTime >= thresholds.reduced.responseTime ||
             metrics.cpuUsage >= thresholds.reduced.cpuUsage ||
             metrics.memoryUsage >= thresholds.reduced.memoryUsage) {
      targetLevel = 'reduced';
      reason = 'System metrics exceeded reduced operation thresholds';
    }

    // Additional checks for database and cache health
    if (!metrics.databaseHealth || metrics.circuitBreakersOpen > 0) {
      if (targetLevel === 'normal') {
        targetLevel = 'reduced';
        reason = 'Database connectivity issues detected';
      }
    }

    if (targetLevel !== this.currentLevel) {
      this.setDegradationLevel(targetLevel, reason);
    }
  }

  private applyDegradationLevel(level: DegradationLevel): void {
    this.affectedFeatures = [];
    this.fallbacksActive = [];

    switch (level) {
      case 'normal':
        // No degradation
        break;
      
      case 'reduced':
        this.affectedFeatures = ['export-functionality', 'batch-processing'];
        this.fallbacksActive = ['cache-preferred'];
        break;
      
      case 'minimal':
        this.affectedFeatures = ['export-functionality', 'batch-processing', 'advanced-geocoding', 'spatial-analysis'];
        this.fallbacksActive = ['cache-only', 'simplified-responses'];
        break;
      
      case 'emergency':
        this.affectedFeatures = ['export-functionality', 'batch-processing', 'advanced-geocoding', 'spatial-analysis', 'address-search'];
        this.fallbacksActive = ['cache-only', 'read-only-mode', 'critical-only'];
        break;
    }
  }

  private getDegradationReason(): string {
    const metrics = this.systemMetrics;
    const reasons: string[] = [];

    if (metrics.errorRate > 10) reasons.push(`High error rate: ${metrics.errorRate.toFixed(1)}%`);
    if (metrics.averageResponseTime > 1000) reasons.push(`Slow response time: ${metrics.averageResponseTime.toFixed(0)}ms`);
    if (metrics.cpuUsage > 80) reasons.push(`High CPU usage: ${metrics.cpuUsage.toFixed(1)}%`);
    if (metrics.memoryUsage > 85) reasons.push(`High memory usage: ${metrics.memoryUsage.toFixed(1)}%`);
    if (!metrics.databaseHealth) reasons.push('Database connectivity issues');
    if (!metrics.cacheHealth) reasons.push('Cache connectivity issues');
    if (metrics.circuitBreakersOpen > 0) reasons.push(`${metrics.circuitBreakersOpen} circuit breakers open`);

    return reasons.length > 0 ? reasons.join('; ') : 'Manual degradation';
  }

  private isEssentialFeature(featureName: string): boolean {
    const essentialFeatures = ['address-validation', 'basic-geocoding', 'health-check'];
    return essentialFeatures.includes(featureName);
  }

  private isCriticalFeature(featureName: string): boolean {
    const criticalFeatures = ['health-check', 'basic-address-validation'];
    return criticalFeatures.includes(featureName);
  }

  private isNonEssentialFeature(featureName: string): boolean {
    const nonEssentialFeatures = ['export-functionality', 'batch-processing'];
    return nonEssentialFeatures.includes(featureName);
  }

  private getDefaultConfig(): DegradationConfig {
    return {
      enabled: true,
      autoMode: true,
      thresholds: {
        reduced: {
          errorRate: 5,
          responseTime: 1000,
          cpuUsage: 70,
          memoryUsage: 75
        },
        minimal: {
          errorRate: 10,
          responseTime: 2000,
          cpuUsage: 80,
          memoryUsage: 85
        },
        emergency: {
          errorRate: 20,
          responseTime: 5000,
          cpuUsage: 90,
          memoryUsage: 95
        }
      },
      fallbackStrategies: {
        cacheOnly: true,
        readOnlyMode: true,
        simplifiedResponses: true,
        disableNonEssential: true
      }
    };
  }

  shutdown(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }
}

export const gracefulDegradationService = GracefulDegradationService.getInstance();