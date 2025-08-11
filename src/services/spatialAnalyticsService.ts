/**
 * Spatial Analytics Service
 * Core business logic for spatial queries and property analysis
 */

import { DatabaseManager } from '../config/database';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('SpatialAnalytics');
import { SpatialOptimizer } from '../utils/spatialOptimizer';
import { 
  ProximityRequest, 
  ProximityResponse, 
  Coordinates,
  SpatialPerformanceMetrics,
  SPATIAL_CONSTANTS
} from '../types/spatial';
import { geocodingService } from './geocodingService';

export class SpatialAnalyticsService {
  private static instance: SpatialAnalyticsService;
  private spatialOptimizer: SpatialOptimizer;
  private db: DatabaseManager;

  constructor() {
    this.spatialOptimizer = SpatialOptimizer.getInstance();
    this.db = DatabaseManager.getInstance();
  }

  static getInstance(): SpatialAnalyticsService {
    if (!this.instance) {
      this.instance = new SpatialAnalyticsService();
    }
    return this.instance;
  }

  /**
   * Perform proximity analysis to find nearby properties
   */
  async analyzeProximity(request: ProximityRequest): Promise<ProximityResponse> {
    const startTime = Date.now();
    const requestId = `proximity_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    try {
      logger.info('Starting proximity analysis', { requestId, request });

      // Validate and get coordinates
      const coordinates = await this.resolveCoordinates(request);
      
      // Validate coordinates are in Australian territory
      if (!SpatialOptimizer.validateAustralianCoordinates(coordinates.latitude, coordinates.longitude)) {
        throw new Error('Coordinates must be within Australian territory');
      }

      // Validate and normalize request parameters
      const normalizedRequest = this.normalizeProximityRequest(request, coordinates);
      
      // Apply spatial optimization settings
      await this.db.query(SpatialOptimizer.getSpatialOptimizationQuery());

      // Execute proximity query with Web Mercator for accuracy
      const proximityQuery = SpatialOptimizer.getProximityQuery(true);
      const queryParams = [
        coordinates.latitude,
        coordinates.longitude,
        normalizedRequest.radius,
        normalizedRequest.limit
      ];

      logger.debug('Executing proximity query', { requestId, queryParams });

      const results = await this.db.query(proximityQuery, queryParams);
      
      // Calculate bearings if requested
      const enrichedResults = normalizedRequest.includeBearing 
        ? this.calculateBearings(results.rows, coordinates)
        : this.formatDistanceResults(results.rows);

      // Calculate summary statistics
      const summary = this.calculateProximitySummary(enrichedResults, startTime);
      
      // Record performance metrics
      const executionTime = Date.now() - startTime;
      this.spatialOptimizer.recordPerformance({
        queryType: 'proximity',
        executionTime,
        resultCount: enrichedResults.length,
        usesSpatialIndex: true // Our query uses ST_DWithin with spatial index
      });

      const response: ProximityResponse = {
        center: coordinates,
        radius: normalizedRequest.radius,
        results: enrichedResults,
        summary
      };

      logger.info('Proximity analysis completed', { 
        requestId, 
        resultCount: enrichedResults.length,
        executionTime: `${executionTime}ms`
      });

      return response;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('Proximity analysis failed', { 
        requestId, 
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: `${executionTime}ms`
      });
      throw error;
    }
  }

  /**
   * Resolve coordinates from address or validate provided coordinates
   */
  private async resolveCoordinates(request: ProximityRequest): Promise<Coordinates> {
    if (request.coordinates) {
      return {
        latitude: SpatialOptimizer.validateCoordinatePrecision(request.coordinates.latitude),
        longitude: SpatialOptimizer.validateCoordinatePrecision(request.coordinates.longitude)
      };
    }

    if (request.address) {
      logger.debug('Resolving coordinates from address', { address: request.address });
      const geocodeResult = await geocodingService.geocodeAddress({ address: request.address });
      
      if (!geocodeResult.success || !geocodeResult.coordinates) {
        throw new Error(`Unable to geocode address: ${request.address}`);
      }

      return {
        latitude: geocodeResult.coordinates.latitude,
        longitude: geocodeResult.coordinates.longitude
      };
    }

    throw new Error('Either coordinates or address must be provided');
  }

  /**
   * Normalize and validate proximity request parameters
   */
  private normalizeProximityRequest(request: ProximityRequest, coordinates: Coordinates): Required<ProximityRequest> {
    const radius = Math.min(
      Math.max(request.radius || 1000, 1), 
      SPATIAL_CONSTANTS.MAX_RADIUS_METERS
    );

    const limit = Math.min(
      Math.max(request.limit || SPATIAL_CONSTANTS.DEFAULT_PROXIMITY_LIMIT, 1),
      SPATIAL_CONSTANTS.MAX_PROXIMITY_LIMIT
    );

    return {
      coordinates,
      address: request.address || '',
      radius,
      propertyTypes: request.propertyTypes || [],
      limit,
      includeDistance: request.includeDistance !== false, // Default true
      includeBearing: request.includeBearing === true // Default false
    };
  }

  /**
   * Calculate bearings for proximity results
   */
  private calculateBearings(rows: any[], centerCoordinates: Coordinates) {
    return rows.map(row => {
      const bearing = SpatialOptimizer.calculateBearing(
        centerCoordinates.latitude,
        centerCoordinates.longitude,
        parseFloat(row.latitude),
        parseFloat(row.longitude)
      );

      return {
        gnafPid: row.gnaf_pid,
        address: row.address,
        coordinates: {
          latitude: parseFloat(row.latitude),
          longitude: parseFloat(row.longitude)
        },
        distance: {
          meters: parseInt(row.distance_meters, 10),
          kilometers: Math.round((parseInt(row.distance_meters, 10) / 1000) * 100) / 100
        },
        bearing: Math.round(bearing * 100) / 100
      };
    });
  }

  /**
   * Format distance results without bearings
   */
  private formatDistanceResults(rows: any[]) {
    return rows.map(row => ({
      gnafPid: row.gnaf_pid,
      address: row.address,
      coordinates: {
        latitude: parseFloat(row.latitude),
        longitude: parseFloat(row.longitude)
      },
      distance: {
        meters: parseInt(row.distance_meters, 10),
        kilometers: Math.round((parseInt(row.distance_meters, 10) / 1000) * 100) / 100
      }
    }));
  }

  /**
   * Calculate proximity analysis summary statistics
   */
  private calculateProximitySummary(results: any[], startTime: number) {
    const total = results.length;
    const searchTime = Date.now() - startTime;
    
    const averageDistance = total > 0 
      ? Math.round(results.reduce((sum, r) => sum + r.distance.meters, 0) / total)
      : 0;

    return {
      total,
      averageDistance,
      searchTime
    };
  }

  /**
   * Get performance statistics for monitoring
   */
  getPerformanceStats() {
    return this.spatialOptimizer.getPerformanceStats();
  }

  /**
   * Health check for spatial analytics service
   */
  async healthCheck(): Promise<{ status: string; spatialExtensions: boolean; indexHealth: string }> {
    try {
      // Check PostGIS extensions
      const extensionCheck = await this.db.query(`
        SELECT EXISTS(
          SELECT 1 FROM pg_extension WHERE extname = 'postgis'
        ) as postgis_available;
      `);

      // Check spatial index health
      const indexCheck = await this.db.query(`
        SELECT schemaname, tablename, indexname, indexdef
        FROM pg_indexes 
        WHERE indexdef ILIKE '%gist%' 
        AND schemaname = 'gnaf' 
        AND tablename = 'addresses'
        LIMIT 1;
      `);

      const spatialExtensions = extensionCheck.rows[0]?.postgis_available || false;
      const indexHealth = indexCheck.rows.length > 0 ? 'healthy' : 'missing';

      return {
        status: spatialExtensions && indexHealth === 'healthy' ? 'healthy' : 'degraded',
        spatialExtensions,
        indexHealth
      };

    } catch (error) {
      logger.error('Spatial analytics health check failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      return {
        status: 'unhealthy',
        spatialExtensions: false,
        indexHealth: 'unknown'
      };
    }
  }
}

// Export singleton instance
export const spatialAnalyticsService = SpatialAnalyticsService.getInstance();