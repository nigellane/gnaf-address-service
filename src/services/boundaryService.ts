/**
 * Boundary Service
 * Administrative boundary mapping and lookup functionality
 */

import { DatabaseManager } from '../config/database';
import { SpatialOptimizer } from '../utils/spatialOptimizer';
import Logger from '../utils/logger';
import { BoundaryLookupParams, BoundaryResponse, SpatialPerformanceMetrics } from '../types/spatial';

const logger = Logger.createServiceLogger('BoundaryService');

export class BoundaryService {
  private static instance: BoundaryService;
  private db: DatabaseManager;
  private boundaryCache: Map<string, { data: BoundaryResponse; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.db = DatabaseManager.getInstance();
  }

  static getInstance(): BoundaryService {
    if (!this.instance) {
      this.instance = new BoundaryService();
    }
    return this.instance;
  }

  /**
   * Lookup administrative boundaries for given coordinates
   */
  async lookupBoundaries(params: BoundaryLookupParams): Promise<BoundaryResponse> {
    const startTime = Date.now();
    
    try {
      // Validate coordinates
      if (!SpatialOptimizer.validateAustralianCoordinates(params.coordinates.latitude, params.coordinates.longitude)) {
        throw new Error('Coordinates must be within Australian territory');
      }

      // Normalize coordinates
      const latitude = SpatialOptimizer.validateCoordinatePrecision(params.coordinates.latitude);
      const longitude = SpatialOptimizer.validateCoordinatePrecision(params.coordinates.longitude);

      // Check cache first
      const cacheKey = this.generateCacheKey(latitude, longitude, params);
      const cached = this.getCachedBoundary(cacheKey);
      if (cached) {
        logger.debug('Boundary lookup cache hit', { latitude, longitude });
        return cached;
      }

      // Apply spatial optimization hints
      await this.db.query(SpatialOptimizer.getSpatialOptimizationQuery());

      // Build response structure
      const response: BoundaryResponse = {
        coordinates: { latitude, longitude },
        boundaries: {
          locality: {
            name: '',
            pid: '',
            postcode: ''
          }
        }
      };

      // Get locality information (always included)
      const localityResult = await this.db.query(
        SpatialOptimizer.getBoundaryQuery(),
        [latitude, longitude]
      );

      if (localityResult.rows.length > 0) {
        const locality = localityResult.rows[0];
        response.boundaries.locality = {
          name: locality.locality_name,
          pid: locality.locality_pid,
          postcode: locality.postcode || ''
        };

        // Add LGA if requested (default: true)
        if (params.includeLGA !== false) {
          if (locality.local_government_area) {
            response.boundaries.localGovernmentArea = {
              name: locality.local_government_area,
              category: this.extractLGACategory(locality.local_government_area)
            };
          }
        }

        // Add postal area if requested (default: true)
        if (params.includePostal !== false && locality.postcode) {
          response.boundaries.postalArea = {
            postcode: locality.postcode,
            deliveryOffice: await this.getDeliveryOffice(locality.postcode)
          };
        }
      } else {
        throw new Error(`No locality found for coordinates: ${latitude}, ${longitude}`);
      }

      // Add electoral districts if requested
      if (params.includeElectoral === true) {
        const electoralInfo = await this.getElectoralDistricts(latitude, longitude);
        response.boundaries.electoralDistrict = electoralInfo || undefined;
      }

      // Cache the result
      this.setCachedBoundary(cacheKey, response);

      // Record performance metrics
      const executionTime = Date.now() - startTime;
      this.recordPerformanceMetrics({
        queryType: 'boundary',
        executionTime,
        resultCount: 1,
        usesSpatialIndex: true
      });

      logger.info('Boundary lookup completed', {
        latitude,
        longitude,
        executionTime: `${executionTime}ms`,
        hasLGA: !!response.boundaries.localGovernmentArea,
        hasElectoral: !!response.boundaries.electoralDistrict,
        hasPostal: !!response.boundaries.postalArea
      });

      return response;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('Boundary lookup failed', {
        coordinates: params.coordinates,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: `${executionTime}ms`
      });
      throw error;
    }
  }

  /**
   * Get electoral districts for coordinates (placeholder - would need electoral boundary data)
   */
  private async getElectoralDistricts(latitude: number, longitude: number): Promise<{ federal: string; state: string } | null> {
    try {
      // Note: This would require electoral boundary data which may not be in G-NAF
      // For now, return null - electoral data would come from AEC/state sources
      logger.debug('Electoral district lookup not available - requires AEC boundary data', { latitude, longitude });
      return null;
    } catch (error) {
      logger.warn('Electoral district lookup failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      return null;
    }
  }

  /**
   * Get delivery office for postcode
   */
  private async getDeliveryOffice(postcode: string): Promise<string> {
    try {
      // This would typically come from Australia Post data
      // For now, use a simple mapping based on state patterns
      const postcodeNum = parseInt(postcode);
      
      if (postcodeNum >= 1000 && postcodeNum <= 2999) return 'NSW';
      if (postcodeNum >= 3000 && postcodeNum <= 3999) return 'VIC';
      if (postcodeNum >= 4000 && postcodeNum <= 4999) return 'QLD';
      if (postcodeNum >= 5000 && postcodeNum <= 5999) return 'SA';
      if (postcodeNum >= 6000 && postcodeNum <= 6999) return 'WA';
      if (postcodeNum >= 7000 && postcodeNum <= 7999) return 'TAS';
      if (postcodeNum >= 800 && postcodeNum <= 899) return 'NT';
      if (postcodeNum >= 200 && postcodeNum <= 299) return 'ACT';
      
      return 'Unknown';
    } catch (error) {
      logger.warn('Delivery office lookup failed', { postcode, error: error instanceof Error ? error.message : 'Unknown error' });
      return 'Unknown';
    }
  }

  /**
   * Extract LGA category from name (City, Shire, Town, etc.)
   */
  private extractLGACategory(lgaName: string): string {
    const name = lgaName.toLowerCase();
    
    if (name.includes('city')) return 'City';
    if (name.includes('shire')) return 'Shire';
    if (name.includes('town')) return 'Town';
    if (name.includes('borough')) return 'Borough';
    if (name.includes('district')) return 'District';
    if (name.includes('council')) return 'Council';
    if (name.includes('regional')) return 'Regional';
    
    return 'Council'; // Default category
  }

  /**
   * Generate cache key for boundary lookup
   */
  private generateCacheKey(latitude: number, longitude: number, params: BoundaryLookupParams): string {
    const flags = [
      params.includeLGA !== false ? 'lga' : '',
      params.includeElectoral === true ? 'electoral' : '',
      params.includePostal !== false ? 'postal' : ''
    ].filter(Boolean).join('-');
    
    return `boundary:${latitude.toFixed(6)}:${longitude.toFixed(6)}:${flags}`;
  }

  /**
   * Get cached boundary result
   */
  private getCachedBoundary(cacheKey: string): BoundaryResponse | null {
    const cached = this.boundaryCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.data;
    }
    
    // Remove expired entry
    if (cached) {
      this.boundaryCache.delete(cacheKey);
    }
    
    return null;
  }

  /**
   * Set cached boundary result
   */
  private setCachedBoundary(cacheKey: string, data: BoundaryResponse): void {
    // Limit cache size to prevent memory issues
    if (this.boundaryCache.size >= 1000) {
      // Remove oldest entries (simple FIFO)
      const oldestKey = this.boundaryCache.keys().next().value;
      if (oldestKey) {
        this.boundaryCache.delete(oldestKey);
      }
    }
    
    this.boundaryCache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Clear boundary cache
   */
  clearCache(): void {
    this.boundaryCache.clear();
    logger.info('Boundary cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    // This would require tracking hits/misses for accurate hit rate
    // For now, return basic size info
    return {
      size: this.boundaryCache.size,
      hitRate: 0 // Would need hit/miss counters
    };
  }

  /**
   * Health check for boundary service
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; localityData: boolean; cacheHealth: string }> {
    try {
      // Test locality data availability with Melbourne coordinates
      const testResult = await this.db.query(
        SpatialOptimizer.getBoundaryQuery(),
        [-37.8136, 144.9631]
      );

      const hasLocalityData = testResult.rows.length > 0;
      const cacheHealth = this.boundaryCache.size < 1000 ? 'healthy' : 'full';
      const status = hasLocalityData ? 'healthy' : 'degraded';

      return {
        status,
        localityData: hasLocalityData,
        cacheHealth
      };
    } catch (error) {
      logger.error('Boundary service health check failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      return {
        status: 'unhealthy',
        localityData: false,
        cacheHealth: 'unknown'
      };
    }
  }

  /**
   * Record performance metrics
   */
  private recordPerformanceMetrics(metrics: SpatialPerformanceMetrics): void {
    const optimizer = SpatialOptimizer.getInstance();
    optimizer.recordPerformance(metrics);
  }
}

// Export singleton instance
export const boundaryService = BoundaryService.getInstance();