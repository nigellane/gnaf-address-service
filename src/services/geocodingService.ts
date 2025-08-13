import { getDatabase } from '../config/database';
import { 
  GeocodeRequest, 
  GeocodeResponse, 
  ReverseGeocodeParams, 
  ReverseGeocodeResponse,
  AddressComponents
} from '../types/api';
import coordinateTransform, { CoordinatePoint } from '../utils/coordinateTransform';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('GeocodingService');

// Constants for geocoding configuration
const GEOCODING_CONSTANTS = {
  MAX_ADDRESS_LENGTH: 500,
  DEFAULT_COORDINATE_SYSTEM: 'WGS84' as const,
  MIN_RADIUS: 1,
  MAX_RADIUS: 1000,
  DEFAULT_RADIUS: 100,
  MIN_LIMIT: 1,
  MAX_LIMIT: 10,
  DEFAULT_LIMIT: 1,
  // Confidence scoring thresholds
  CONFIDENCE_THRESHOLDS: {
    HIGH: 0.8,    // 90% confidence
    MEDIUM: 0.6,  // 75% confidence  
    LOW: 0.4,     // 60% confidence
    FALLBACK: 40  // Default confidence
  }
} as const;

export class GeocodingService {
  constructor() {}

  private async query(text: string, params?: any[]): Promise<any> {
    return await getDatabase().query(text, params);
  }

  async geocodeAddress(request: GeocodeRequest): Promise<GeocodeResponse> {
    const startTime = Date.now();
    
    try {
      if (!request.address || request.address.trim().length === 0) {
        throw new Error('Address is required');
      }

      if (request.address.length > GEOCODING_CONSTANTS.MAX_ADDRESS_LENGTH) {
        throw new Error(`Address must not exceed ${GEOCODING_CONSTANTS.MAX_ADDRESS_LENGTH} characters`);
      }

      const targetSystem = request.coordinateSystem || GEOCODING_CONSTANTS.DEFAULT_COORDINATE_SYSTEM;
      
      if (!coordinateTransform.validateCoordinateSystem(targetSystem)) {
        throw new Error(`Invalid coordinate system: ${targetSystem}`);
      }

      // Try to use the existing search_vector first for better performance
      logger.debug('Attempting vector search for geocoding', { address: request.address });
      const searchResult = await this.performVectorSearch(request.address);
      
      if (searchResult && searchResult.length > 0) {
        logger.info('Vector search successful, using best match', { 
          address: request.address, 
          resultCount: searchResult.length,
          bestMatchPid: searchResult[0].gnaf_pid 
        });
        
        // Use best match from vector search
        const bestMatch = searchResult[0];
        
        const result = await this.query(`
          SELECT 
            a.address_detail_pid,
            a.gnaf_pid,
            a.formatted_address,
            a.latitude,
            a.longitude,
            a.coordinate_precision,
            a.coordinate_reliability,
            a.number_first as street_number,
            COALESCE(s.street_name, '') as street_name,
            COALESCE(s.street_type, '') as street_type,
            COALESCE(l.locality_name, '') as locality_name,
            COALESCE(l.state_code, '') as state_code,
            COALESCE(l.postcode, '') as postcode,
            a.confidence_score as confidence
          FROM gnaf.addresses a
          LEFT JOIN gnaf.localities l ON a.locality_pid = l.locality_pid
          LEFT JOIN gnaf.streets s ON a.street_locality_pid = s.street_locality_pid
          WHERE a.gnaf_pid = $1
        `, [bestMatch.gnaf_pid]);
        
        if (result.rows.length > 0) {
          return this.buildGeocodeResponse(result.rows[0], targetSystem, request);
        }
      }
      
      logger.warn('Vector search failed or returned no results, falling back to component search', { 
        address: request.address,
        vectorResultCount: searchResult?.length || 0
      });
      
      // Fallback to component-based search only if vector search fails
      return this.performComponentSearch(request.address, targetSystem, request);
    } catch (error) {
      logger.error('Geocoding failed', { 
        address: request.address, 
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime 
      });
      
      return {
        success: false,
        coordinates: {
          latitude: 0,
          longitude: 0,
          coordinateSystem: (request.coordinateSystem || 'WGS84') as 'WGS84' | 'GDA2020',
          precision: 'REGION',
          reliability: 3
        },
        confidence: 0,
        gnafPid: ''
      };
    }
  }

  private async performVectorSearch(address: string): Promise<any[]> {
    try {
      // Use the same search preparation as AddressService for consistency
      const searchVector = this.prepareSearchQuery(address);
      
      const query = `
        SELECT 
          gnaf_pid, formatted_address, confidence_score,
          ts_rank(search_vector, to_tsquery('english', $1)) as relevance_score
        FROM gnaf.addresses 
        WHERE search_vector @@ to_tsquery('english', $1)
          AND address_status = 'CURRENT'
          AND confidence_score >= 70
        ORDER BY 
          GREATEST(confidence_score * 0.6, ts_rank(search_vector, to_tsquery('english', $1)) * 40) DESC
        LIMIT 5
      `;
      
      const result = await this.query(query, [searchVector]);
      return result.rows;
    } catch (error) {
      logger.warn('Vector search failed, falling back to component search', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  private prepareSearchQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .map(word => `${word}:*`)
      .join(' & ');
  }

  private async performComponentSearch(address: string, targetSystem: string, request: GeocodeRequest): Promise<GeocodeResponse> {
    // Parse the input address to extract components for better matching
    const addressParts = address.trim().split(/\s+/);
    const streetNumber = addressParts[0];
    const streetName = addressParts.length > 1 ? addressParts[1] : '';
    const locality = addressParts.length > 3 ? addressParts.slice(3).join(' ') : 
                     addressParts.length > 2 ? addressParts[2] : '';
    
    // Optimized query using indexes and avoiding complex JOINs
    const searchQuery = `
      SELECT 
        a.address_detail_pid,
        a.gnaf_pid,
        a.formatted_address,
        a.latitude,
        a.longitude,
        a.coordinate_precision,
        a.coordinate_reliability,
        a.number_first as street_number,
        COALESCE(s.street_name, '') as street_name,
        COALESCE(s.street_type, '') as street_type,
        COALESCE(l.locality_name, '') as locality_name,
        COALESCE(l.state_code, '') as state_code,
        COALESCE(l.postcode, '') as postcode,
        CASE 
          WHEN LOWER(a.number_first) = LOWER($2) 
               AND LOWER(s.street_name) = LOWER($3) THEN 95
          WHEN LOWER(a.number_first) = LOWER($2) 
               AND LOWER(s.street_name) LIKE LOWER('%' || $3 || '%') THEN 85
          ELSE a.confidence_score
        END as confidence
      FROM gnaf.addresses a
      INNER JOIN gnaf.streets s ON a.street_locality_pid = s.street_locality_pid
      INNER JOIN gnaf.localities l ON a.locality_pid = l.locality_pid
      WHERE a.address_status = 'CURRENT' 
        AND a.number_first = $2
        AND LOWER(s.street_name) LIKE LOWER('%' || $3 || '%')
        AND ($4 = '' OR LOWER(l.locality_name) LIKE LOWER('%' || $4 || '%'))
      ORDER BY 
        CASE 
          WHEN LOWER(s.street_name) = LOWER($3) THEN 1
          ELSE 2
        END,
        a.coordinate_reliability ASC,
        a.confidence_score DESC
      LIMIT 5
    `;
    
    const result = await this.query(searchQuery, [
      address.trim(),
      streetNumber,
      streetName,
      locality
    ]);
      
    if (result.rows.length === 0) {
      return {
        success: false,
        coordinates: {
          latitude: 0,
          longitude: 0,
          coordinateSystem: targetSystem as 'WGS84' | 'GDA2020',
          precision: 'REGION',
          reliability: 3
        },
        confidence: 0,
        gnafPid: ''
      };
    }

    return this.buildGeocodeResponse(result.rows[0], targetSystem, request);
  }

  private async buildGeocodeResponse(row: any, targetSystem: string, request: GeocodeRequest): Promise<GeocodeResponse> {
    let coordinates: CoordinatePoint = {
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude)
    };

    if (targetSystem === 'GDA2020') {
      coordinates = await coordinateTransform.transformCoordinates(
        coordinates,
        { fromSystem: 'WGS84', toSystem: 'GDA2020' }
      );
    }

    const response: GeocodeResponse = {
      success: true,
      coordinates: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        coordinateSystem: targetSystem as 'WGS84' | 'GDA2020',
        precision: this.mapPrecision(row.coordinate_precision),
        reliability: parseInt(row.coordinate_reliability) as 1 | 2 | 3
      },
      confidence: parseInt(row.confidence || row.confidence_score),
      gnafPid: row.gnaf_pid
    };

    if (request.includeComponents !== false) {
      response.components = {
        streetNumber: row.street_number,
        streetName: row.street_name,
        streetType: row.street_type,
        suburb: row.locality_name,
        state: row.state_code,
        postcode: row.postcode || null
      };
    }

    return response;
  }

  async reverseGeocode(params: ReverseGeocodeParams): Promise<ReverseGeocodeResponse> {
    const startTime = Date.now();
    
    try {
      if (!coordinateTransform.validateCoordinates({ 
        latitude: params.latitude, 
        longitude: params.longitude 
      }, params.coordinateSystem || 'WGS84')) {
        throw new Error('Invalid coordinates');
      }

      const sourceSystem = params.coordinateSystem || GEOCODING_CONSTANTS.DEFAULT_COORDINATE_SYSTEM;
      const searchRadius = Math.min(
        Math.max(params.radius || GEOCODING_CONSTANTS.DEFAULT_RADIUS, GEOCODING_CONSTANTS.MIN_RADIUS), 
        GEOCODING_CONSTANTS.MAX_RADIUS
      );
      const limit = Math.min(
        Math.max(params.limit || GEOCODING_CONSTANTS.DEFAULT_LIMIT, GEOCODING_CONSTANTS.MIN_LIMIT), 
        GEOCODING_CONSTANTS.MAX_LIMIT
      );

      let searchCoords: CoordinatePoint = {
        latitude: params.latitude,
        longitude: params.longitude
      };

      if (sourceSystem === 'GDA2020') {
        searchCoords = await coordinateTransform.transformCoordinates(
          searchCoords,
          { fromSystem: 'GDA2020', toSystem: 'WGS84' }
        );
      }

      const spatialQuery = `
        SELECT 
          a.address_detail_pid,
          a.gnaf_pid,
          a.formatted_address,
          a.latitude,
          a.longitude,
          a.coordinate_precision,
          a.coordinate_reliability,
          a.number_first as street_number,
          s.street_name,
          s.street_type,
          l.locality_name,
          l.state_code,
          l.postcode,
          ST_Distance(
            ST_Transform(a.geometry, 3857),
            ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), 3857)
          ) as distance_meters,
          CASE 
            WHEN a.coordinate_reliability = 1 THEN 90
            WHEN a.coordinate_reliability = 2 THEN 75
            ELSE 60
          END as confidence
        FROM gnaf.addresses a
        LEFT JOIN gnaf.localities l ON a.locality_pid = l.locality_pid
        LEFT JOIN gnaf.streets s ON a.street_locality_pid = s.street_locality_pid
        WHERE a.address_status = 'CURRENT'
          AND ST_DWithin(
            ST_Transform(a.geometry, 3857),
            ST_Transform(ST_SetSRID(ST_MakePoint($2, $1), 4326), 3857),
            $3
          )
        ORDER BY distance_meters ASC, a.coordinate_reliability ASC
        LIMIT $4
      `;

      const result = await this.query(spatialQuery, [
        searchCoords.latitude,
        searchCoords.longitude,
        searchRadius,
        limit
      ]);

      const results = result.rows.map((row: any) => {
        const addressCoords: CoordinatePoint = {
          latitude: parseFloat(row.latitude),
          longitude: parseFloat(row.longitude)
        };

        const distance = coordinateTransform.calculateDistance(searchCoords, addressCoords);
        const bearing = coordinateTransform.calculateBearing(searchCoords, addressCoords);

        return {
          gnafPid: row.gnaf_pid,
          formattedAddress: row.formatted_address,
          components: {
            streetNumber: row.street_number,
            streetName: row.street_name,
            streetType: row.street_type,
            suburb: row.locality_name,
            state: row.state_code,
            postcode: row.postcode || null
          } as AddressComponents,
          distance: params.includeDistance !== false ? distance : { meters: 0, kilometers: 0 },
          bearing: bearing,
          confidence: parseInt(row.confidence)
        };
      });

      const response: ReverseGeocodeResponse = {
        success: true,
        results,
        searchRadius,
        coordinateSystem: sourceSystem
      };

      const duration = Date.now() - startTime;
      logger.info('Reverse geocoding completed', {
        latitude: params.latitude,
        longitude: params.longitude,
        radius: searchRadius,
        resultsCount: results.length,
        duration
      });

      return response;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Reverse geocoding failed', {
        latitude: params.latitude,
        longitude: params.longitude,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });
      throw error;
    }
  }

  private mapPrecision(precision: string): 'PROPERTY' | 'STREET' | 'LOCALITY' | 'REGION' {
    switch (precision?.toUpperCase()) {
      case 'PROPERTY':
        return 'PROPERTY';
      case 'STREET':
        return 'STREET';
      case 'LOCALITY':
        return 'LOCALITY';
      case 'REGION':
        return 'REGION';
      default:
        return 'LOCALITY';
    }
  }
}

// Export singleton instance
export const geocodingService = new GeocodingService();

