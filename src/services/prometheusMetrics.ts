/**
 * Prometheus Metrics Service
 * Comprehensive metrics collection and export for monitoring
 */

import { register, collectDefaultMetrics, Counter, Histogram, Gauge, Registry } from 'prom-client';
import { performanceMonitoringService } from './performanceMonitoringService';
import { cachingService } from './cachingService';
import { DatabaseManager } from '../config/database';
import { redisManager } from '../config/redis';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('PrometheusMetrics');

export class PrometheusMetricsService {
  private static instance: PrometheusMetricsService;
  private customRegistry: Registry;
  
  // HTTP request metrics
  private httpRequestsTotal!: Counter<string>;
  private httpRequestDuration!: Histogram<string>;
  private httpResponseSize!: Histogram<string>;
  
  // Database metrics
  private dbConnectionsActive!: Gauge<string>;
  private dbConnectionsIdle!: Gauge<string>;
  private dbConnectionsWaiting!: Gauge<string>;
  private dbQueryDuration!: Histogram<string>;
  private dbSlowQueries!: Counter<string>;
  
  // Cache metrics
  private cacheHitRatio!: Gauge<string>;
  private cacheOperationDuration!: Histogram<string>;
  private cacheMemoryUsage!: Gauge<string>;
  
  // Business metrics
  private addressValidationTotal!: Counter<string>;
  private addressValidationSuccess!: Counter<string>;
  private geocodingTotal!: Counter<string>;
  private geocodingSuccess!: Counter<string>;
  
  // G-NAF dataset metrics
  private gnafRecordCount!: Gauge<string>;
  private gnafLastUpdate!: Gauge<string>;
  private gnafDataHealth!: Gauge<string>;
  
  // System metrics
  private systemResourceUsage!: Gauge<string>;
  
  constructor() {
    // Create a custom registry for application metrics
    this.customRegistry = new Registry();
    
    // Collect default system metrics
    collectDefaultMetrics({
      register: this.customRegistry,
      prefix: 'gnaf_service_',
      labels: {
        service: 'gnaf-address-service',
        version: process.env.npm_package_version || '1.0.0'
      }
    });
    
    // Initialize custom metrics
    this.initializeHttpMetrics();
    this.initializeDatabaseMetrics();
    this.initializeCacheMetrics();
    this.initializeBusinessMetrics();
    this.initializeGnafMetrics();
    this.initializeSystemMetrics();
    
    // Start periodic metrics collection
    this.startPeriodicCollection();
    
    logger.info('Prometheus metrics service initialized');
  }
  
  static getInstance(): PrometheusMetricsService {
    if (!this.instance) {
      this.instance = new PrometheusMetricsService();
    }
    return this.instance;
  }
  
  private initializeHttpMetrics(): void {
    this.httpRequestsTotal = new Counter({
      name: 'gnaf_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code', 'endpoint_type'],
      registers: [this.customRegistry]
    });
    
    this.httpRequestDuration = new Histogram({
      name: 'gnaf_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
      registers: [this.customRegistry]
    });
    
    this.httpResponseSize = new Histogram({
      name: 'gnaf_http_response_size_bytes',
      help: 'HTTP response size in bytes',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [100, 1000, 10000, 100000, 1000000],
      registers: [this.customRegistry]
    });
  }
  
  private initializeDatabaseMetrics(): void {
    this.dbConnectionsActive = new Gauge({
      name: 'gnaf_db_connections_active',
      help: 'Number of active database connections',
      registers: [this.customRegistry]
    });
    
    this.dbConnectionsIdle = new Gauge({
      name: 'gnaf_db_connections_idle',
      help: 'Number of idle database connections',
      registers: [this.customRegistry]
    });
    
    this.dbConnectionsWaiting = new Gauge({
      name: 'gnaf_db_connections_waiting',
      help: 'Number of waiting database connections',
      registers: [this.customRegistry]
    });
    
    this.dbQueryDuration = new Histogram({
      name: 'gnaf_db_query_duration_seconds',
      help: 'Database query duration in seconds',
      labelNames: ['query_type', 'table'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
      registers: [this.customRegistry]
    });
    
    this.dbSlowQueries = new Counter({
      name: 'gnaf_db_slow_queries_total',
      help: 'Total number of slow database queries',
      labelNames: ['query_type'],
      registers: [this.customRegistry]
    });
  }
  
  private initializeCacheMetrics(): void {
    this.cacheHitRatio = new Gauge({
      name: 'gnaf_cache_hit_ratio',
      help: 'Cache hit ratio (0-1)',
      labelNames: ['cache_layer'],
      registers: [this.customRegistry]
    });
    
    this.cacheOperationDuration = new Histogram({
      name: 'gnaf_cache_operation_duration_seconds',
      help: 'Cache operation duration in seconds',
      labelNames: ['operation', 'cache_layer'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
      registers: [this.customRegistry]
    });
    
    this.cacheMemoryUsage = new Gauge({
      name: 'gnaf_cache_memory_usage_bytes',
      help: 'Cache memory usage in bytes',
      labelNames: ['cache_layer'],
      registers: [this.customRegistry]
    });
  }
  
  private initializeBusinessMetrics(): void {
    this.addressValidationTotal = new Counter({
      name: 'gnaf_address_validation_total',
      help: 'Total number of address validation requests',
      labelNames: ['validation_type', 'confidence_level'],
      registers: [this.customRegistry]
    });
    
    this.addressValidationSuccess = new Counter({
      name: 'gnaf_address_validation_success_total',
      help: 'Total number of successful address validations',
      labelNames: ['validation_type', 'confidence_level'],
      registers: [this.customRegistry]
    });
    
    this.geocodingTotal = new Counter({
      name: 'gnaf_geocoding_total',
      help: 'Total number of geocoding requests',
      labelNames: ['geocoding_type', 'precision_level'],
      registers: [this.customRegistry]
    });
    
    this.geocodingSuccess = new Counter({
      name: 'gnaf_geocoding_success_total',
      help: 'Total number of successful geocoding requests',
      labelNames: ['geocoding_type', 'precision_level'],
      registers: [this.customRegistry]
    });
  }
  
  private initializeGnafMetrics(): void {
    this.gnafRecordCount = new Gauge({
      name: 'gnaf_dataset_records_total',
      help: 'Total number of G-NAF records in dataset',
      labelNames: ['state', 'record_type'],
      registers: [this.customRegistry]
    });
    
    this.gnafLastUpdate = new Gauge({
      name: 'gnaf_dataset_last_update_timestamp',
      help: 'Timestamp of last G-NAF dataset update',
      registers: [this.customRegistry]
    });
    
    this.gnafDataHealth = new Gauge({
      name: 'gnaf_dataset_health',
      help: 'G-NAF dataset health status (1=healthy, 0=unhealthy)',
      registers: [this.customRegistry]
    });
  }
  
  private initializeSystemMetrics(): void {
    this.systemResourceUsage = new Gauge({
      name: 'gnaf_system_resource_usage',
      help: 'System resource usage percentage',
      labelNames: ['resource_type'],
      registers: [this.customRegistry]
    });
  }
  
  private startPeriodicCollection(): void {
    // Update metrics every 15 seconds
    setInterval(() => {
      this.collectDatabaseMetrics();
      this.collectCacheMetrics();
      this.collectSystemMetrics();
      this.collectGnafMetrics();
    }, 15000);
    
    logger.info('Started periodic metrics collection (15s interval)');
  }
  
  private async collectDatabaseMetrics(): Promise<void> {
    try {
      const db = DatabaseManager.getInstance();
      const metrics = await db.getMetrics();
      
      this.dbConnectionsActive.set(metrics.totalConnections - metrics.idleConnections);
      this.dbConnectionsIdle.set(metrics.idleConnections);
      this.dbConnectionsWaiting.set(metrics.waitingClients);
      
      if (metrics.slowQueries > 0) {
        this.dbSlowQueries.inc({ query_type: 'slow' }, metrics.slowQueries);
      }
    } catch (error) {
      logger.error('Failed to collect database metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  private async collectCacheMetrics(): Promise<void> {
    try {
      const cacheMetrics = cachingService.getMetrics();
      
      // L1 Cache metrics
      this.cacheHitRatio.set(
        { cache_layer: 'l1' },
        cacheMetrics.l1.hits / (cacheMetrics.l1.hits + cacheMetrics.l1.misses) || 0
      );
      this.cacheMemoryUsage.set({ cache_layer: 'l1' }, cacheMetrics.l1.memoryUsage);
      
      // L2 Cache metrics
      this.cacheHitRatio.set(
        { cache_layer: 'l2' },
        cacheMetrics.l2.hits / (cacheMetrics.l2.hits + cacheMetrics.l2.misses) || 0
      );
      
      // Overall cache metrics
      this.cacheHitRatio.set(
        { cache_layer: 'overall' },
        cacheMetrics.overall.hitRatio
      );
    } catch (error) {
      logger.error('Failed to collect cache metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  private collectSystemMetrics(): void {
    try {
      const memoryUsage = process.memoryUsage();
      const memoryPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      
      this.systemResourceUsage.set({ resource_type: 'memory' }, memoryPercent);
      this.systemResourceUsage.set({ resource_type: 'uptime' }, process.uptime());
    } catch (error) {
      logger.error('Failed to collect system metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  private async collectGnafMetrics(): Promise<void> {
    try {
      const db = DatabaseManager.getInstance();
      
      // Query G-NAF dataset information
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_addresses,
          MAX(created_at) as last_updated
        FROM gnaf.addresses
      `);
      
      if (result.rows && result.rows.length > 0) {
        const row = result.rows[0];
        this.gnafRecordCount.set({ state: 'all', record_type: 'addresses' }, parseInt(row.total_addresses));
        
        if (row.last_updated) {
          this.gnafLastUpdate.set(new Date(row.last_updated).getTime() / 1000);
        }
        
        // Set health based on data availability
        const hasData = parseInt(row.total_addresses) > 1000000;
        this.gnafDataHealth.set(hasData ? 1 : 0);
      }
    } catch (error) {
      logger.error('Failed to collect G-NAF metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.gnafDataHealth.set(0); // Mark as unhealthy
    }
  }
  
  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    responseSize: number,
    endpointType: 'api' | 'health' | 'admin' = 'api'
  ): void {
    const labels = {
      method: method.toUpperCase(),
      route,
      status_code: statusCode.toString(),
      endpoint_type: endpointType
    };
    
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(
      { method: labels.method, route, status_code: labels.status_code },
      duration / 1000 // Convert to seconds
    );
    this.httpResponseSize.observe(
      { method: labels.method, route, status_code: labels.status_code },
      responseSize
    );
  }
  
  /**
   * Record database query metrics
   */
  recordDatabaseQuery(queryType: string, table: string, duration: number, isSlowQuery: boolean = false): void {
    this.dbQueryDuration.observe(
      { query_type: queryType, table },
      duration / 1000 // Convert to seconds
    );
    
    if (isSlowQuery) {
      this.dbSlowQueries.inc({ query_type: queryType });
    }
  }
  
  /**
   * Record cache operation metrics
   */
  recordCacheOperation(operation: 'get' | 'set' | 'delete', cacheLayer: string, duration: number): void {
    this.cacheOperationDuration.observe(
      { operation, cache_layer: cacheLayer },
      duration / 1000 // Convert to seconds
    );
  }
  
  /**
   * Record business metrics
   */
  recordAddressValidation(validationType: string, success: boolean, confidenceLevel: string): void {
    const labels = { validation_type: validationType, confidence_level: confidenceLevel };
    
    this.addressValidationTotal.inc(labels);
    if (success) {
      this.addressValidationSuccess.inc(labels);
    }
  }
  
  recordGeocoding(geocodingType: string, success: boolean, precisionLevel: string): void {
    const labels = { geocoding_type: geocodingType, precision_level: precisionLevel };
    
    this.geocodingTotal.inc(labels);
    if (success) {
      this.geocodingSuccess.inc(labels);
    }
  }
  
  /**
   * Get Prometheus metrics string
   */
  async getMetrics(): Promise<string> {
    return this.customRegistry.metrics();
  }
  
  /**
   * Get registry for middleware integration
   */
  getRegistry(): Registry {
    return this.customRegistry;
  }
}

export const prometheusMetrics = PrometheusMetricsService.getInstance();