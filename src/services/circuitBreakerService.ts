/**
 * Circuit Breaker Service
 * Implements circuit breaker patterns for external dependencies and database connections
 */

import Logger from '../utils/logger';
import { EventEmitter } from 'events';

const logger = Logger.createServiceLogger('CircuitBreaker');

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
  minimumRequests: number;
  successThreshold?: number; // For half-open state
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  totalRequests: number;
  lastFailureTime?: Date;
  lastStateChangeTime: Date;
  nextAttemptTime?: Date;
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitBreakerState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private totalRequests = 0;
  private lastFailureTime?: Date;
  private lastStateChangeTime = new Date();
  private nextAttemptTime?: Date;
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    super();
    this.config = {
      successThreshold: 3,
      ...config
    };

    logger.info('Circuit breaker initialized', {
      name: this.config.name,
      failureThreshold: this.config.failureThreshold,
      recoveryTimeout: this.config.recoveryTimeout
    });
  }

  async execute<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.setState('HALF_OPEN');
      } else {
        logger.debug('Circuit breaker OPEN - executing fallback', {
          name: this.config.name,
          nextAttemptTime: this.nextAttemptTime
        });
        
        if (fallback) {
          return await fallback();
        }
        throw new Error(`Circuit breaker is OPEN for ${this.config.name}`);
      }
    }

    return this.executeOperation(operation, fallback);
  }

  private async executeOperation<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    this.totalRequests++;
    
    try {
      const startTime = Date.now();
      const result = await operation();
      const executionTime = Date.now() - startTime;
      
      this.onSuccess();
      
      logger.debug('Circuit breaker operation successful', {
        name: this.config.name,
        state: this.state,
        executionTime: `${executionTime}ms`
      });

      return result;

    } catch (error) {
      this.onFailure();
      
      logger.warn('Circuit breaker operation failed', {
        name: this.config.name,
        state: this.state,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (fallback && this.state === 'OPEN') {
        logger.info('Executing fallback operation', { name: this.config.name });
        return await fallback();
      }

      throw error;
    }
  }

  private onSuccess(): void {
    this.successCount++;
    
    if (this.state === 'HALF_OPEN') {
      if (this.successCount >= (this.config.successThreshold || 3)) {
        this.setState('CLOSED');
        this.resetCounters();
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on successful operations in closed state
      if (this.failureCount > 0) {
        this.failureCount = Math.max(0, this.failureCount - 1);
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.state === 'HALF_OPEN') {
      this.setState('OPEN');
    } else if (this.state === 'CLOSED' && this.shouldOpenCircuit()) {
      this.setState('OPEN');
    }
  }

  private shouldOpenCircuit(): boolean {
    return this.failureCount >= this.config.failureThreshold &&
           this.totalRequests >= this.config.minimumRequests;
  }

  private shouldAttemptReset(): boolean {
    if (!this.nextAttemptTime) {
      return false;
    }
    return Date.now() >= this.nextAttemptTime.getTime();
  }

  private setState(newState: CircuitBreakerState): void {
    const previousState = this.state;
    this.state = newState;
    this.lastStateChangeTime = new Date();

    if (newState === 'OPEN') {
      this.nextAttemptTime = new Date(Date.now() + this.config.recoveryTimeout);
    } else if (newState === 'CLOSED') {
      this.nextAttemptTime = undefined;
    }

    logger.info('Circuit breaker state changed', {
      name: this.config.name,
      previousState,
      newState,
      failureCount: this.failureCount,
      nextAttemptTime: this.nextAttemptTime
    });

    this.emit('stateChange', {
      name: this.config.name,
      previousState,
      newState,
      stats: this.getStats()
    });
  }

  private resetCounters(): void {
    this.failureCount = 0;
    this.successCount = 0;
    // Keep totalRequests for monitoring
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequests: this.totalRequests,
      lastFailureTime: this.lastFailureTime,
      lastStateChangeTime: this.lastStateChangeTime,
      nextAttemptTime: this.nextAttemptTime
    };
  }

  reset(): void {
    this.setState('CLOSED');
    this.resetCounters();
    this.totalRequests = 0;
    this.lastFailureTime = undefined;
    this.nextAttemptTime = undefined;
    
    logger.info('Circuit breaker reset', { name: this.config.name });
  }

  forceOpen(): void {
    this.setState('OPEN');
    logger.warn('Circuit breaker forced open', { name: this.config.name });
  }

  forceClose(): void {
    this.setState('CLOSED');
    this.resetCounters();
    logger.info('Circuit breaker forced closed', { name: this.config.name });
  }
}

export class CircuitBreakerService {
  private static instance: CircuitBreakerService;
  private breakers = new Map<string, CircuitBreaker>();
  private monitoringInterval?: ReturnType<typeof setInterval>;

  static getInstance(): CircuitBreakerService {
    if (!this.instance) {
      this.instance = new CircuitBreakerService();
    }
    return this.instance;
  }

  createCircuitBreaker(config: CircuitBreakerConfig): CircuitBreaker {
    if (this.breakers.has(config.name)) {
      throw new Error(`Circuit breaker with name ${config.name} already exists`);
    }

    const breaker = new CircuitBreaker(config);
    this.breakers.set(config.name, breaker);

    // Set up monitoring
    breaker.on('stateChange', (event) => {
      this.onBreakerStateChange(event);
    });

    return breaker;
  }

  getCircuitBreaker(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  getAllStats(): { [name: string]: CircuitBreakerStats } {
    const stats: { [name: string]: CircuitBreakerStats } = {};
    
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }
    
    return stats;
  }

  getHealthStatus(): {
    healthy: boolean;
    totalBreakers: number;
    openBreakers: number;
    halfOpenBreakers: number;
    details: { [name: string]: CircuitBreakerStats };
  } {
    const stats = this.getAllStats();
    const openBreakers = Object.values(stats).filter(s => s.state === 'OPEN').length;
    const halfOpenBreakers = Object.values(stats).filter(s => s.state === 'HALF_OPEN').length;
    
    return {
      healthy: openBreakers === 0,
      totalBreakers: this.breakers.size,
      openBreakers,
      halfOpenBreakers,
      details: stats
    };
  }

  startMonitoring(intervalMs: number = 30000): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      const stats = this.getAllStats();
      const openCount = Object.values(stats).filter(s => s.state === 'OPEN').length;
      
      if (openCount > 0) {
        logger.warn('Circuit breaker monitoring alert', {
          openBreakers: openCount,
          totalBreakers: this.breakers.size,
          openBreakerNames: Object.keys(stats).filter(name => stats[name] && stats[name].state === 'OPEN')
        });
      }
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }

  private onBreakerStateChange(event: any): void {
    if (event.newState === 'OPEN') {
      // Could trigger alerts, notifications, etc.
      logger.error('Circuit breaker opened', {
        name: event.name,
        stats: event.stats
      });
    } else if (event.newState === 'CLOSED' && event.previousState === 'HALF_OPEN') {
      logger.info('Circuit breaker recovered', {
        name: event.name,
        stats: event.stats
      });
    }
  }

  // Pre-configured circuit breakers for common services
  createDatabaseCircuitBreaker(): CircuitBreaker {
    if (this.breakers.has('database')) {
      return this.breakers.get('database')!;
    }
    
    return this.createCircuitBreaker({
      name: 'database',
      failureThreshold: 5,
      recoveryTimeout: 30000, // 30 seconds
      monitoringPeriod: 60000, // 1 minute
      minimumRequests: 10,
      successThreshold: 3
    });
  }

  createRedisCircuitBreaker(): CircuitBreaker {
    if (this.breakers.has('redis')) {
      return this.breakers.get('redis')!;
    }
    
    return this.createCircuitBreaker({
      name: 'redis',
      failureThreshold: 3,
      recoveryTimeout: 15000, // 15 seconds
      monitoringPeriod: 30000, // 30 seconds
      minimumRequests: 5,
      successThreshold: 2
    });
  }

  createExternalApiCircuitBreaker(name: string): CircuitBreaker {
    if (this.breakers.has(`external-api-${name}`)) {
      return this.breakers.get(`external-api-${name}`)!;
    }
    
    return this.createCircuitBreaker({
      name: `external-api-${name}`,
      failureThreshold: 5,
      recoveryTimeout: 60000, // 1 minute
      monitoringPeriod: 120000, // 2 minutes
      minimumRequests: 10,
      successThreshold: 3
    });
  }
}

export const circuitBreakerService = CircuitBreakerService.getInstance();