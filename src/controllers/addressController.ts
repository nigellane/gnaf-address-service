import { Request, Response } from 'express';
import { AddressService } from '../services/addressService';
import { GeocodingService } from '../services/geocodingService';
import { 
  AddressValidationRequest, 
  AddressSearchParams, 
  ApiError, 
  HealthCheckResponse,
  GeocodeRequest,
  ReverseGeocodeParams
} from '../types/api';
import { AuthenticatedRequest } from '../middleware/auth';
import { getDatabase } from '../config/database';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('AddressController');

export class AddressController {
  private addressService = new AddressService();
  private geocodingService = new GeocodingService();

  searchAddresses = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      const params: AddressSearchParams = {
        q: req.query.q as string,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 10,
        state: req.query.state as string | undefined,
        postcode: req.query.postcode as string | undefined,
        includeCoordinates: req.query.includeCoordinates === 'true',
        includeComponents: req.query.includeComponents === 'true'
      };

      if (!params.q || typeof params.q !== 'string' || params.q.trim().length === 0) {
        const error: ApiError = {
          error: {
            code: 'MISSING_QUERY',
            message: 'Query parameter "q" is required and must not be empty.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      if (params.limit && (params.limit < 1 || params.limit > 50)) {
        const error: ApiError = {
          error: {
            code: 'INVALID_LIMIT',
            message: 'Limit must be between 1 and 50.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      const result = await this.addressService.searchAddresses(params);
      const duration = Date.now() - startTime;
      
      logger.info('Address search request completed', {
        requestId,
        clientId: req.clientId,
        query: params.q.substring(0, 100),
        resultsCount: result.results.length,
        duration
      });
      
      res.set('X-Request-ID', requestId);
      res.set('X-Response-Time', `${duration}ms`);
      res.json(result);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Address search request failed', {
        requestId,
        clientId: req.clientId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });
      
      const apiError: ApiError = {
        error: {
          code: 'SEARCH_ERROR',
          message: 'An error occurred while searching for addresses.',
          requestId
        }
      };
      res.status(500).json(apiError);
    }
  };

  validateAddress = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      const validationRequest: AddressValidationRequest = {
        address: req.body.address,
        strictMode: req.body.strictMode || false,
        includeComponents: req.body.includeComponents !== false,
        includeSuggestions: req.body.includeSuggestions !== false
      };

      if (!validationRequest.address || typeof validationRequest.address !== 'string' || validationRequest.address.trim().length === 0) {
        const error: ApiError = {
          error: {
            code: 'MISSING_ADDRESS',
            message: 'Address field is required and must not be empty.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      if (validationRequest.address.length > 500) {
        const error: ApiError = {
          error: {
            code: 'ADDRESS_TOO_LONG',
            message: 'Address must not exceed 500 characters.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      const result = await this.addressService.validateAddress(validationRequest);
      const duration = Date.now() - startTime;
      
      logger.info('Address validation request completed', {
        requestId,
        clientId: req.clientId,
        address: validationRequest.address.substring(0, 100),
        isValid: result.isValid,
        confidence: result.confidence,
        duration
      });
      
      res.set('X-Request-ID', requestId);
      res.set('X-Response-Time', `${duration}ms`);
      res.json(result);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Address validation request failed', {
        requestId,
        clientId: req.clientId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });
      
      const apiError: ApiError = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'An error occurred while validating the address.',
          requestId
        }
      };
      res.status(500).json(apiError);
    }
  };

  healthCheck = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      const db = getDatabase();
      const dbHealth = await db.healthCheck();
      const duration = Date.now() - startTime;
      
      const status = dbHealth.healthy ? 'healthy' : 'degraded';
      
      const response: HealthCheckResponse = {
        status,
        timestamp: new Date().toISOString(),
        services: {
          database: dbHealth
        }
      };
      
      logger.info('Health check completed', {
        requestId,
        status,
        dbHealthy: dbHealth.healthy,
        dbLatency: dbHealth.latency,
        duration
      });
      
      res.set('X-Request-ID', requestId);
      res.set('X-Response-Time', `${duration}ms`);
      
      if (status === 'healthy') {
        res.json(response);
      } else {
        res.status(503).json(response);
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Health check failed', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });
      
      const response: HealthCheckResponse = {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        services: {
          database: {
            healthy: false,
            latency: duration,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      };
      
      res.set('X-Request-ID', requestId);
      res.set('X-Response-Time', `${duration}ms`);
      res.status(503).json(response);
    }
  };

  geocodeAddress = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      const geocodeRequest: GeocodeRequest = {
        address: req.body.address,
        coordinateSystem: req.body.coordinateSystem || 'WGS84',
        includePrecision: req.body.includePrecision !== false,
        includeComponents: req.body.includeComponents !== false
      };

      if (!geocodeRequest.address || typeof geocodeRequest.address !== 'string' || geocodeRequest.address.trim().length === 0) {
        const error: ApiError = {
          error: {
            code: 'MISSING_ADDRESS',
            message: 'Address field is required and must not be empty.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      if (geocodeRequest.address.length > 500) {
        const error: ApiError = {
          error: {
            code: 'ADDRESS_TOO_LONG',
            message: 'Address must not exceed 500 characters.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      if (geocodeRequest.coordinateSystem && !['WGS84', 'GDA2020'].includes(geocodeRequest.coordinateSystem)) {
        const error: ApiError = {
          error: {
            code: 'INVALID_COORDINATE_SYSTEM',
            message: 'Coordinate system must be either WGS84 or GDA2020.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      const result = await this.geocodingService.geocodeAddress(geocodeRequest);
      const duration = Date.now() - startTime;
      
      logger.info('Geocoding request completed', {
        requestId,
        clientId: req.clientId,
        address: geocodeRequest.address.substring(0, 100),
        success: result.success,
        confidence: result.confidence,
        duration
      });
      
      res.set('X-Request-ID', requestId);
      res.set('X-Response-Time', `${duration}ms`);
      res.json(result);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Geocoding request failed', {
        requestId,
        clientId: req.clientId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });
      
      const apiError: ApiError = {
        error: {
          code: 'GEOCODING_ERROR',
          message: 'An error occurred while geocoding the address.',
          requestId
        }
      };
      res.status(500).json(apiError);
    }
  };

  reverseGeocode = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      const params: ReverseGeocodeParams = {
        latitude: parseFloat(req.query.latitude as string),
        longitude: parseFloat(req.query.longitude as string),
        coordinateSystem: (req.query.coordinateSystem as 'WGS84' | 'GDA2020') || 'WGS84',
        radius: req.query.radius ? parseInt(req.query.radius as string, 10) : 100,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 1,
        includeDistance: req.query.includeDistance !== 'false'
      };

      if (isNaN(params.latitude) || isNaN(params.longitude)) {
        const error: ApiError = {
          error: {
            code: 'INVALID_COORDINATES',
            message: 'Latitude and longitude must be valid numbers.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      if (params.latitude < -90 || params.latitude > 90) {
        const error: ApiError = {
          error: {
            code: 'INVALID_LATITUDE',
            message: 'Latitude must be between -90 and 90 degrees.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      if (params.longitude < -180 || params.longitude > 180) {
        const error: ApiError = {
          error: {
            code: 'INVALID_LONGITUDE',
            message: 'Longitude must be between -180 and 180 degrees.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      if (!['WGS84', 'GDA2020'].includes(params.coordinateSystem!)) {
        const error: ApiError = {
          error: {
            code: 'INVALID_COORDINATE_SYSTEM',
            message: 'Coordinate system must be either WGS84 or GDA2020.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      if (params.radius && (params.radius < 1 || params.radius > 1000)) {
        const error: ApiError = {
          error: {
            code: 'INVALID_RADIUS',
            message: 'Radius must be between 1 and 1000 meters.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      if (params.limit && (params.limit < 1 || params.limit > 10)) {
        const error: ApiError = {
          error: {
            code: 'INVALID_LIMIT',
            message: 'Limit must be between 1 and 10.',
            requestId
          }
        };
        res.status(400).json(error);
        return;
      }

      const result = await this.geocodingService.reverseGeocode(params);
      const duration = Date.now() - startTime;
      
      logger.info('Reverse geocoding request completed', {
        requestId,
        clientId: req.clientId,
        latitude: params.latitude,
        longitude: params.longitude,
        resultsCount: result.results.length,
        duration
      });
      
      res.set('X-Request-ID', requestId);
      res.set('X-Response-Time', `${duration}ms`);
      res.json(result);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Reverse geocoding request failed', {
        requestId,
        clientId: req.clientId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });
      
      const apiError: ApiError = {
        error: {
          code: 'REVERSE_GEOCODING_ERROR',
          message: 'An error occurred while reverse geocoding the coordinates.',
          requestId
        }
      };
      res.status(500).json(apiError);
    }
  };

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
}