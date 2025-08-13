/**
 * Redis Configuration and Management
 * Provides clustered Redis connection with failover and monitoring
 */

import { createClient, RedisClientType, RedisClusterType, createCluster } from 'redis';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('RedisConfig');

export interface RedisMetrics {
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  totalConnections: number;
  activeConnections: number;
  commandsProcessed: number;
  cacheHits: number;
  cacheMisses: number;
  averageResponseTime: number;
  memoryUsage: number;
}

export class RedisManager {
  private static instance: RedisManager;
  private client: RedisClientType | RedisClusterType | null = null;
  private metrics: RedisMetrics;
  private commandTimes: number[] = [];
  private isClusterMode: boolean;

  constructor() {
    this.metrics = {
      connectionStatus: 'disconnected',
      totalConnections: 0,
      activeConnections: 0,
      commandsProcessed: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageResponseTime: 0,
      memoryUsage: 0
    };

    this.isClusterMode = process.env.REDIS_CLUSTER_MODE === 'true';
    this.initializeConnection();
  }

  static getInstance(): RedisManager {
    if (!this.instance) {
      this.instance = new RedisManager();
    }
    return this.instance;
  }

  private async initializeConnection(): Promise<void> {
    try {
      if (this.isClusterMode) {
        await this.initializeCluster();
      } else {
        await this.initializeSingleNode();
      }

      this.setupEventListeners();
      await this.connect();
      
      logger.info('Redis connection initialized successfully', {
        mode: this.isClusterMode ? 'cluster' : 'single',
        status: this.metrics.connectionStatus
      });
    } catch (error) {
      logger.warn('Redis connection not available, running with L1 cache only', {
        error: error instanceof Error ? error.message : 'Unknown error',
        mode: this.isClusterMode ? 'cluster' : 'single'
      });
      // Don't throw error - allow application to continue without Redis
      this.metrics.connectionStatus = 'disconnected';
    }
  }

  private async initializeCluster(): Promise<void> {
    const clusterNodes = process.env.REDIS_CLUSTER_NODES?.split(',') || ['localhost:6379'];
    
    this.client = createCluster({
      rootNodes: clusterNodes.map(node => {
        const [host, port] = node.split(':');
        return { url: `redis://${host}:${port || 6379}` };
      }),
      defaults: {
        password: process.env.REDIS_PASSWORD,
        socket: {
          connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000'),
          keepAlive: 30000,
          reconnectStrategy: (retries) => {
            if (retries > 3) {
              logger.warn('Redis cluster connection failed after 3 attempts, giving up');
              return false; // Stop reconnecting after 3 attempts
            }
            return Math.min(retries * 50, 1000);
          }
        }
      }
    });
  }

  private async initializeSingleNode(): Promise<void> {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    this.client = createClient({
      url: redisUrl,
      password: process.env.REDIS_PASSWORD,
      database: parseInt(process.env.REDIS_DATABASE || '0'),
      socket: {
        connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000'),
        keepAlive: 30000,
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            logger.warn('Redis single-node connection failed after 3 attempts, giving up');
            return false; // Stop reconnecting after 3 attempts
          }
          return Math.min(retries * 50, 1000);
        }
      }
    });
  }

  private setupEventListeners(): void {
    if (!this.client) return;

    this.client.on('connect', () => {
      this.metrics.connectionStatus = 'connected';
      this.metrics.totalConnections++;
      logger.info('Redis connected');
    });

    this.client.on('ready', () => {
      this.metrics.connectionStatus = 'connected';
      this.metrics.activeConnections++;
      logger.info('Redis ready for commands');
    });

    this.client.on('error', (error) => {
      this.metrics.connectionStatus = 'disconnected';
      logger.error('Redis connection error', { error: error.message });
    });

    this.client.on('reconnecting', () => {
      this.metrics.connectionStatus = 'reconnecting';
      logger.warn('Redis reconnecting');
    });

    this.client.on('end', () => {
      this.metrics.connectionStatus = 'disconnected';
      this.metrics.activeConnections = 0;
      logger.warn('Redis connection ended');
    });
  }

  async connect(): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.metrics.connectionStatus = 'disconnected';
      this.metrics.activeConnections = 0;
    }
  }

  async get(key: string): Promise<string | null> {
    const startTime = Date.now();
    
    try {
      if (!this.client) throw new Error('Redis client not connected');
      
      const result = await this.client.get(key);
      this.recordCommand(Date.now() - startTime);
      
      if (result) {
        this.metrics.cacheHits++;
      } else {
        this.metrics.cacheMisses++;
      }
      
      return result;
    } catch (error) {
      logger.error('Redis GET error', { key, error: error instanceof Error ? error.message : 'Unknown error' });
      this.metrics.cacheMisses++;
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      if (!this.client) throw new Error('Redis client not connected');
      
      let result;
      if (ttl) {
        result = await this.client.setEx(key, ttl, value);
      } else {
        result = await this.client.set(key, value);
      }
      
      this.recordCommand(Date.now() - startTime);
      return result === 'OK';
    } catch (error) {
      logger.error('Redis SET error', { key, error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    }
  }

  async del(key: string | string[]): Promise<number> {
    const startTime = Date.now();
    
    try {
      if (!this.client) throw new Error('Redis client not connected');
      
      const result = await this.client.del(key);
      this.recordCommand(Date.now() - startTime);
      return result;
    } catch (error) {
      logger.error('Redis DEL error', { key, error: error instanceof Error ? error.message : 'Unknown error' });
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      if (!this.client) throw new Error('Redis client not connected');
      
      const result = await this.client.exists(key);
      return result > 0;
    } catch (error) {
      logger.error('Redis EXISTS error', { key, error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    }
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    const startTime = Date.now();
    
    try {
      if (!this.client) throw new Error('Redis client not connected');
      
      const results = await this.client.mGet(keys);
      this.recordCommand(Date.now() - startTime);
      
      // Count hits and misses
      results.forEach(result => {
        if (result) {
          this.metrics.cacheHits++;
        } else {
          this.metrics.cacheMisses++;
        }
      });
      
      return results;
    } catch (error) {
      logger.error('Redis MGET error', { keys, error: error instanceof Error ? error.message : 'Unknown error' });
      keys.forEach(() => this.metrics.cacheMisses++);
      return keys.map(() => null);
    }
  }

  async flushPattern(pattern: string): Promise<number> {
    try {
      if (!this.client) throw new Error('Redis client not connected');
      
      // Use SCAN instead of KEYS for better performance
      let cursor = 0;
      const keys: string[] = [];
      
      do {
        const result = await (this.client as any).scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = result.cursor;
        keys.push(...result.keys);
      } while (cursor !== 0);
      
      if (keys.length === 0) return 0;
      
      return await this.del(keys);
    } catch (error) {
      logger.error('Redis flush pattern error', { pattern, error: error instanceof Error ? error.message : 'Unknown error' });
      return 0;
    }
  }

  private recordCommand(duration: number): void {
    this.metrics.commandsProcessed++;
    this.commandTimes.push(duration);
    
    // Keep only last 1000 command times for average calculation
    if (this.commandTimes.length > 1000) {
      this.commandTimes = this.commandTimes.slice(-1000);
    }
    
    this.metrics.averageResponseTime = this.commandTimes.reduce((sum, time) => sum + time, 0) / this.commandTimes.length;
  }

  async healthCheck(): Promise<{ status: string; metrics: RedisMetrics }> {
    try {
      if (!this.client) {
        return { status: 'disconnected', metrics: this.metrics };
      }

      // Test connection with PING
      const startTime = Date.now();
      if ('ping' in this.client) {
        await this.client.ping();
        this.recordCommand(Date.now() - startTime);
      }

      // Get memory usage if available
      try {
        if ('info' in this.client) {
          const info = await this.client.info('memory');
          if (info) {
            const memoryMatch = info.match(/used_memory:(\d+)/);
            if (memoryMatch && memoryMatch[1]) {
              this.metrics.memoryUsage = parseInt(memoryMatch[1]);
            }
          }
        }
      } catch (infoError) {
        // Memory info not critical for health check
      }

      return { status: 'healthy', metrics: this.metrics };
    } catch (error) {
      logger.error('Redis health check failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      return { status: 'unhealthy', metrics: this.metrics };
    }
  }

  getMetrics(): RedisMetrics {
    return { ...this.metrics };
  }

  getCacheHitRatio(): number {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    return total > 0 ? this.metrics.cacheHits / total : 0;
  }
}

export const redisManager = RedisManager.getInstance();