/**
 * Statistical Area Service
 * ABS statistical area classification (SA1, SA2, SA3, SA4) functionality
 */

import { DatabaseManager } from '../config/database';
import { SpatialOptimizer } from '../utils/spatialOptimizer';
import { geocodingService } from './geocodingService';
import Logger from '../utils/logger';
import { StatisticalAreaRequest, StatisticalAreaResponse, SpatialPerformanceMetrics } from '../types/spatial';

const logger = Logger.createServiceLogger('StatisticalAreaService');

export class StatisticalAreaService {
  private static instance: StatisticalAreaService;
  private db: DatabaseManager;

  constructor() {
    this.db = DatabaseManager.getInstance();
  }

  static getInstance(): StatisticalAreaService {
    if (!this.instance) {
      this.instance = new StatisticalAreaService();
    }
    return this.instance;
  }

  /**
   * Classify statistical areas for given coordinates or address
   */
  async classifyStatisticalAreas(request: StatisticalAreaRequest): Promise<StatisticalAreaResponse> {
    const startTime = Date.now();
    
    try {
      // Resolve coordinates (either directly provided or via geocoding)
      const coordinates = await this.resolveCoordinates(request);

      // Validate coordinates
      if (!SpatialOptimizer.validateAustralianCoordinates(coordinates.latitude, coordinates.longitude)) {
        throw new Error('Coordinates must be within Australian territory');
      }

      // Normalize coordinates
      const latitude = SpatialOptimizer.validateCoordinatePrecision(coordinates.latitude);
      const longitude = SpatialOptimizer.validateCoordinatePrecision(coordinates.longitude);

      // Apply spatial optimization hints
      await this.db.query(SpatialOptimizer.getSpatialOptimizationQuery());

      // Get statistical area classification data
      const statisticalResult = await this.db.query(
        SpatialOptimizer.getStatisticalAreaQuery(),
        [latitude, longitude]
      );

      if (statisticalResult.rows.length === 0) {
        throw new Error(`No statistical area data found for coordinates: ${latitude}, ${longitude}`);
      }

      const statData = statisticalResult.rows[0];

      // Build response structure
      const response: StatisticalAreaResponse = {
        coordinates: { latitude, longitude },
        classification: {
          sa1: {
            code: statData.statistical_area_1 || 'Unknown',
            name: await this.getStatisticalAreaName(statData.statistical_area_1, 'SA1')
          },
          sa2: {
            code: statData.statistical_area_2 || 'Unknown',
            name: await this.getStatisticalAreaName(statData.statistical_area_2, 'SA2')
          },
          sa3: {
            code: this.deriveSA3FromSA2(statData.statistical_area_2),
            name: await this.getStatisticalAreaName(this.deriveSA3FromSA2(statData.statistical_area_2), 'SA3')
          },
          sa4: {
            code: this.deriveSA4FromSA2(statData.statistical_area_2),
            name: await this.getStatisticalAreaName(this.deriveSA4FromSA2(statData.statistical_area_2), 'SA4')
          }
        },
        hierarchy: {},
        metadata: {
          dataSource: 'G-NAF',
          accuracy: 'EXACT'
        }
      };

      // Add hierarchy information if requested (default: true)
      if (request.includeHierarchy !== false) {
        response.hierarchy = {
          meshBlock: statData.mesh_block_code || undefined,
          censusCollectionDistrict: this.deriveCCDFromMeshBlock(statData.mesh_block_code) || undefined
        };
      }

      // Record performance metrics
      const executionTime = Date.now() - startTime;
      this.recordPerformanceMetrics({
        queryType: 'statistical',
        executionTime,
        resultCount: 1,
        usesSpatialIndex: true
      });

      logger.info('Statistical area classification completed', {
        latitude,
        longitude,
        executionTime: `${executionTime}ms`,
        sa1: response.classification.sa1.code,
        sa2: response.classification.sa2.code,
        sa3: response.classification.sa3.code,
        sa4: response.classification.sa4.code
      });

      return response;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('Statistical area classification failed', {
        request,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: `${executionTime}ms`
      });
      throw error;
    }
  }

  /**
   * Resolve coordinates from request (either direct coordinates or via geocoding)
   */
  private async resolveCoordinates(request: StatisticalAreaRequest): Promise<{ latitude: number; longitude: number }> {
    if (request.coordinates) {
      return request.coordinates;
    }

    if (request.address) {
      const geocodeResult = await geocodingService.geocodeAddress({ address: request.address });
      
      if (!geocodeResult.success) {
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
   * Get statistical area name for given code and level
   */
  private async getStatisticalAreaName(code: string, level: 'SA1' | 'SA2' | 'SA3' | 'SA4'): Promise<string> {
    if (!code || code === 'Unknown') {
      return `Unknown ${level}`;
    }

    try {
      // This would typically come from ABS reference data
      // For now, generate descriptive names based on code patterns
      switch (level) {
        case 'SA1':
          return `SA1 ${code}`;
        case 'SA2':
          return `SA2 ${code}`;
        case 'SA3':
          return this.generateSA3Name(code);
        case 'SA4':
          return this.generateSA4Name(code);
        default:
          return `${level} ${code}`;
      }
    } catch (error) {
      logger.warn('Statistical area name lookup failed', { 
        code, 
        level, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return `${level} ${code}`;
    }
  }

  /**
   * Derive SA3 code from SA2 code (SA2 codes typically start with SA3 digits)
   */
  private deriveSA3FromSA2(sa2Code: string): string {
    if (!sa2Code || sa2Code === 'Unknown') {
      return 'Unknown';
    }

    // SA3 codes are typically the first 5 digits of SA2 codes
    if (sa2Code.length >= 5) {
      return sa2Code.substring(0, 5);
    }

    return sa2Code;
  }

  /**
   * Derive SA4 code from SA2 code (SA2 codes typically start with SA4 digits)  
   */
  private deriveSA4FromSA2(sa2Code: string): string {
    if (!sa2Code || sa2Code === 'Unknown') {
      return 'Unknown';
    }

    // SA4 codes are typically the first 3 digits of SA2 codes
    if (sa2Code.length >= 3) {
      return sa2Code.substring(0, 3);
    }

    return sa2Code;
  }

  /**
   * Derive Census Collection District from Mesh Block code
   */
  private deriveCCDFromMeshBlock(meshBlockCode: string): string | null {
    if (!meshBlockCode) {
      return null;
    }

    // CCD codes are typically derived from mesh block codes
    // This is a simplified implementation
    if (meshBlockCode.length >= 8) {
      return meshBlockCode.substring(0, 8);
    }

    return meshBlockCode;
  }

  /**
   * Generate descriptive SA3 name from code
   */
  private generateSA3Name(code: string): string {
    // This would typically come from ABS reference data
    // For now, generate based on code patterns and state identification
    const statePrefix = this.getStateFromCode(code);
    return `${statePrefix} SA3 ${code}`;
  }

  /**
   * Generate descriptive SA4 name from code
   */
  private generateSA4Name(code: string): string {
    // This would typically come from ABS reference data
    // For now, generate based on code patterns and state identification  
    const statePrefix = this.getStateFromCode(code);
    return `${statePrefix} SA4 ${code}`;
  }

  /**
   * Get state identifier from statistical area code
   */
  private getStateFromCode(code: string): string {
    if (!code || code === 'Unknown') {
      return 'Unknown';
    }

    // Statistical area codes typically start with state indicators
    const firstDigit = code.charAt(0);
    
    switch (firstDigit) {
      case '1': return 'NSW';
      case '2': return 'VIC';
      case '3': return 'QLD';
      case '4': return 'SA';
      case '5': return 'WA';
      case '6': return 'TAS';
      case '7': return 'NT';
      case '8': return 'ACT';
      default: return 'AUS';
    }
  }

  /**
   * Health check for statistical area service
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; statisticalData: boolean; meshBlockData: boolean }> {
    try {
      // Test statistical area data availability with Melbourne coordinates
      const testResult = await this.db.query(
        SpatialOptimizer.getStatisticalAreaQuery(),
        [-37.8136, 144.9631]
      );

      const hasStatisticalData = testResult.rows.length > 0;
      const hasMeshBlockData = testResult.rows.length > 0 && testResult.rows[0].mesh_block_code;
      const status = hasStatisticalData ? 'healthy' : 'degraded';

      return {
        status,
        statisticalData: hasStatisticalData,
        meshBlockData: !!hasMeshBlockData
      };
    } catch (error) {
      logger.error('Statistical area service health check failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      return {
        status: 'unhealthy',
        statisticalData: false,
        meshBlockData: false
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
export const statisticalAreaService = StatisticalAreaService.getInstance();