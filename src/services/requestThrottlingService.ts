/**
 * Request Throttling Service
 * Implements rate limiting, priority queuing, and load shedding during high load periods
 */

import Logger from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';

const logger = Logger.createServiceLogger('RequestThrottling');

export interface ThrottleConfig {
  windowMs: number;          // Time window in milliseconds
  maxRequests: number;       // Max requests per window
  skipSuccessful?: boolean;  // Skip counting successful requests
  skipFailedRequests?: boolean;
  keyGenerator?: (req: Request) => string;
  onLimitReached?: (req: Request, res: Response) => void;
}

export interface PriorityConfig {
  high: string[];    // URL patterns for high priority
  medium: string[];  // URL patterns for medium priority
  low: string[];     // URL patterns for low priority
}

export interface LoadSheddingConfig {
  enabled: boolean;
  cpuThreshold: number;      // CPU usage percentage threshold
  memoryThreshold: number;   // Memory usage percentage threshold
  responseTimeThreshold: number; // Response time threshold in ms
  maxQueueSize: number;      // Maximum queue size
}

export interface RequestStats {
  totalRequests: number;
  successfulRequests: number;
  throttledRequests: number;
  queuedRequests: number;
  averageResponseTime: number;
  currentQueueSize: number;
  systemLoad: {
    cpu: number;
    memory: number;
    averageResponseTime: number;
  };
}

interface QueuedRequest {
  req: Request;
  res: Response;
  next: NextFunction;
  priority: 'high' | 'medium' | 'low';
  timestamp: number;
  resolve: (value?: any) => void;
  reject: (error: Error) => void;
}

interface ThrottleStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

export class RequestThrottlingService extends EventEmitter {
  private static instance: RequestThrottlingService;
  private throttleStore: ThrottleStore = {};
  private requestQueue: QueuedRequest[] = [];
  private processingQueue = false;
  private stats: RequestStats = {
    totalRequests: 0,
    successfulRequests: 0,
    throttledRequests: 0,
    queuedRequests: 0,
    averageResponseTime: 0,
    currentQueueSize: 0,
    systemLoad: { cpu: 0, memory: 0, averageResponseTime: 0 }
  };
  private responseTimes: number[] = [];
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private monitoringInterval?: ReturnType<typeof setInterval>;

  static getInstance(): RequestThrottlingService {
    if (!this.instance) {
      this.instance = new RequestThrottlingService();
    }
    return this.instance;
  }

  constructor() {
    super();
    this.startCleanupInterval();
    this.startSystemMonitoring();
  }

  /**
   * Rate limiting middleware
   */
  createRateLimitMiddleware(config: ThrottleConfig) {
    const keyGenerator = config.keyGenerator || ((req: Request) => req.ip || 'anonymous');
    
    return (req: Request, res: Response, next: NextFunction) => {
      const key = keyGenerator(req);
      const now = Date.now();
      const windowStart = now - config.windowMs;

      // Clean up old entries
      if (this.throttleStore[key] && this.throttleStore[key].resetTime <= now) {
        delete this.throttleStore[key];
      }

      // Initialize or get current count
      if (!this.throttleStore[key]) {
        this.throttleStore[key] = {
          count: 0,
          resetTime: now + config.windowMs
        };
      }

      const store = this.throttleStore[key];
      
      // Check if limit exceeded
      if (store.count >= config.maxRequests) {
        this.stats.throttledRequests++;
        this.stats.totalRequests++;
        
        logger.warn('Rate limit exceeded', {
          key,
          count: store.count,
          limit: config.maxRequests,
          windowMs: config.windowMs
        });

        if (config.onLimitReached) {
          config.onLimitReached(req, res);
          return;
        }

        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: Math.ceil((store.resetTime - now) / 1000)
        });
        return;
      }

      // Increment count
      store.count++;
      this.stats.totalRequests++;

      // Add headers
      res.set({
        'X-RateLimit-Limit': config.maxRequests.toString(),
        'X-RateLimit-Remaining': (config.maxRequests - store.count).toString(),
        'X-RateLimit-Reset': Math.ceil(store.resetTime / 1000).toString()
      });

      next();
    };
  }

  /**
   * Priority queue middleware
   */
  createPriorityQueueMiddleware(priorityConfig: PriorityConfig, loadSheddingConfig: LoadSheddingConfig) {
    return async (req: Request, res: Response, next: NextFunction) => {
      const priority = this.determinePriority(req.path, priorityConfig);
      
      // Check if we need to queue the request
      if (this.shouldQueueRequest(loadSheddingConfig)) {
        await this.queueRequest(req, res, next, priority);
      } else {
        this.trackRequestStart(req);
        next();
      }
    };
  }

  /**
   * Load shedding middleware
   */
  createLoadSheddingMiddleware(config: LoadSheddingConfig) {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!config.enabled) {
        next();
        return;
      }

      const systemLoad = this.getSystemLoad();
      
      // Check if system is overloaded
      if (this.isSystemOverloaded(config, systemLoad)) {
        this.stats.throttledRequests++;
        
        logger.warn('Load shedding activated', {
          path: req.path,
          method: req.method,
          systemLoad,
          thresholds: {
            cpu: config.cpuThreshold,
            memory: config.memoryThreshold,
            responseTime: config.responseTimeThreshold
          }
        });

        res.status(503).json({
          error: 'Service Unavailable',
          message: 'System is currently overloaded. Please try again later.',
          retryAfter: 30
        });
        return;
      }

      next();
    };
  }

  private shouldQueueRequest(config: LoadSheddingConfig): boolean {
    const systemLoad = this.getSystemLoad();
    const queueSize = this.requestQueue.length;
    
    return config.enabled && (
      queueSize > 0 || // If there's already a queue, join it
      systemLoad.cpu > config.cpuThreshold * 0.8 || // Queue at 80% of threshold
      systemLoad.memory > config.memoryThreshold * 0.8 ||
      systemLoad.averageResponseTime > config.responseTimeThreshold * 0.8
    ) && queueSize < config.maxQueueSize;
  }

  private async queueRequest(
    req: Request, 
    res: Response, 
    next: NextFunction, 
    priority: 'high' | 'medium' | 'low'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        req,
        res,
        next,
        priority,
        timestamp: Date.now(),
        resolve,
        reject
      };

      // Insert based on priority
      this.insertByPriority(queuedRequest);
      this.stats.queuedRequests++;
      this.stats.currentQueueSize = this.requestQueue.length;

      logger.debug('Request queued', {
        path: req.path,
        method: req.method,
        priority,
        queueSize: this.requestQueue.length
      });

      // Start processing if not already running
      if (!this.processingQueue) {
        this.processQueue();
      }

      // Set timeout for queued request
      setTimeout(() => {
        const index = this.requestQueue.indexOf(queuedRequest);
        if (index !== -1) {
          this.requestQueue.splice(index, 1);
          this.stats.currentQueueSize = this.requestQueue.length;
          reject(new Error('Request timeout while queued'));
        }
      }, 30000); // 30 second timeout
    });
  }

  private insertByPriority(request: QueuedRequest): void {
    const priorities = { high: 0, medium: 1, low: 2 };
    const requestPriorityValue = priorities[request.priority];
    
    let insertIndex = this.requestQueue.length;
    
    for (let i = 0; i < this.requestQueue.length; i++) {
      const existingRequest = this.requestQueue[i];
      if (existingRequest) {
        const existingPriorityValue = priorities[existingRequest.priority];
        if (requestPriorityValue < existingPriorityValue) {
          insertIndex = i;
          break;
        }
      }
    }
    
    this.requestQueue.splice(insertIndex, 0, request);
  }

  private async processQueue(): Promise<void> {
    this.processingQueue = true;
    
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (!request) break;
      this.stats.currentQueueSize = this.requestQueue.length;
      
      try {
        // Check if response hasn't been sent already
        if (!request.res.headersSent) {
          this.trackRequestStart(request.req);
          request.next();
          request.resolve();
        }
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error('Unknown queue processing error'));
      }
      
      // Small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.processingQueue = false;
  }

  private determinePriority(path: string, config: PriorityConfig): 'high' | 'medium' | 'low' {
    for (const pattern of config.high) {
      if (this.matchesPattern(path, pattern)) return 'high';
    }
    for (const pattern of config.medium) {
      if (this.matchesPattern(path, pattern)) return 'medium';
    }
    return 'low';
  }

  private matchesPattern(path: string, pattern: string): boolean {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return regex.test(path);
  }

  private trackRequestStart(req: Request): void {
    (req as any).requestStartTime = Date.now();
  }

  trackRequestEnd(req: Request, statusCode: number): void {
    const startTime = (req as any).requestStartTime;
    if (startTime) {
      const responseTime = Date.now() - startTime;
      this.responseTimes.push(responseTime);
      
      // Keep only last 1000 response times
      if (this.responseTimes.length > 1000) {
        this.responseTimes = this.responseTimes.slice(-1000);
      }
      
      this.stats.averageResponseTime = this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
      
      if (statusCode < 400) {
        this.stats.successfulRequests++;
      }
    }
  }

  private isSystemOverloaded(config: LoadSheddingConfig, systemLoad: any): boolean {
    return systemLoad.cpu > config.cpuThreshold ||
           systemLoad.memory > config.memoryThreshold ||
           systemLoad.averageResponseTime > config.responseTimeThreshold;
  }

  private getSystemLoad(): { cpu: number; memory: number; averageResponseTime: number } {
    const memoryUsage = process.memoryUsage();
    const memoryPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    
    return {
      cpu: this.stats.systemLoad.cpu, // This would need a proper CPU monitoring implementation
      memory: memoryPercent,
      averageResponseTime: this.stats.averageResponseTime
    };
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];
      
      for (const key in this.throttleStore) {
        const entry = this.throttleStore[key];
        if (entry && entry.resetTime <= now) {
          keysToDelete.push(key);
        }
      }
      
      keysToDelete.forEach(key => delete this.throttleStore[key]);
      
      if (keysToDelete.length > 0) {
        logger.debug('Cleaned up throttle store entries', { count: keysToDelete.length });
      }
    }, 60000); // Clean up every minute
  }

  private startSystemMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      // Simple CPU usage monitoring (this would need a proper implementation)
      const startUsage = process.cpuUsage();
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const cpuPercent = ((endUsage.user + endUsage.system) / 1000000 / 100) * 100;
        this.stats.systemLoad.cpu = Math.min(100, cpuPercent);
      }, 100);
      
      // Update system load stats
      this.stats.systemLoad = this.getSystemLoad();
      
      // Emit stats for monitoring
      this.emit('stats', this.getStats());
    }, 5000); // Monitor every 5 seconds
  }

  getStats(): RequestStats {
    return { ...this.stats };
  }

  getQueueStats(): {
    totalQueued: number;
    currentQueueSize: number;
    queueByPriority: { high: number; medium: number; low: number };
  } {
    const queueByPriority = { high: 0, medium: 0, low: 0 };
    
    this.requestQueue.forEach(req => {
      queueByPriority[req.priority]++;
    });
    
    return {
      totalQueued: this.stats.queuedRequests,
      currentQueueSize: this.requestQueue.length,
      queueByPriority
    };
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    // Reject all queued requests
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        request.reject(new Error('Service shutting down'));
      }
    }
  }

  // Predefined configurations
  static getDefaultRateLimitConfig(): ThrottleConfig {
    return {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 1000,
      keyGenerator: (req) => req.ip || 'anonymous'
    };
  }

  static getDefaultPriorityConfig(): PriorityConfig {
    return {
      high: ['/api/v1/health', '/api/v1/addresses/validate'],
      medium: ['/api/v1/addresses/*', '/api/v1/spatial/*'],
      low: ['/api/v1/bulk/*', '/api/v1/export/*']
    };
  }

  static getDefaultLoadSheddingConfig(): LoadSheddingConfig {
    return {
      enabled: true,
      cpuThreshold: 80,
      memoryThreshold: 85,
      responseTimeThreshold: 1000,
      maxQueueSize: 100
    };
  }
}

export const requestThrottlingService = RequestThrottlingService.getInstance();