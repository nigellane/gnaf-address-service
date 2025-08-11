/**
 * Spatial Parameter Validation Middleware
 * Input validation for spatial analytics endpoints
 */

import { Request, Response, NextFunction } from 'express';
import Logger from '../utils/logger';
import { SpatialOptimizer } from '../utils/spatialOptimizer';

const logger = Logger.createServiceLogger('SpatialValidation');
import { SPATIAL_CONSTANTS, AUSTRALIAN_BOUNDS } from '../types/spatial';

/**
 * Validate proximity analysis request parameters
 */
export const validateProximityRequest = (req: Request, res: Response, next: NextFunction) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  req.body.requestId = requestId;

  try {
    const { coordinates, address, radius, limit, propertyTypes, includeDistance, includeBearing } = req.body;

    // Must have either coordinates or address
    if (!coordinates && !address) {
      res.status(400).json({
        error: {
          code: 'MISSING_LOCATION',
          message: 'Either coordinates or address must be provided',
          requestId
        }
      });
      return;
    }

    // Validate coordinates if provided
    if (coordinates) {
      const { latitude, longitude } = coordinates;
      
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        res.status(400).json({
          error: {
            code: 'INVALID_COORDINATES',
            message: 'Coordinates must be valid numbers',
            requestId
          }
        });
        return;
      }

      if (!SpatialOptimizer.validateAustralianCoordinates(latitude, longitude)) {
        res.status(400).json({
          error: {
            code: 'COORDINATES_OUT_OF_BOUNDS',
            message: `Coordinates must be within Australian territory (lat: ${AUSTRALIAN_BOUNDS.minLatitude} to ${AUSTRALIAN_BOUNDS.maxLatitude}, lng: ${AUSTRALIAN_BOUNDS.minLongitude} to ${AUSTRALIAN_BOUNDS.maxLongitude})`,
            requestId
          }
        });
        return;
      }
    }

    // Validate address if provided
    if (address && (typeof address !== 'string' || address.trim().length < 3)) {
      res.status(400).json({
        error: {
          code: 'INVALID_ADDRESS',
          message: 'Address must be a string with at least 3 characters',
          requestId
        }
      });
      return;
    }

    // Validate radius
    if (radius !== undefined) {
      if (!Number.isInteger(radius) || radius < 1 || radius > SPATIAL_CONSTANTS.MAX_RADIUS_METERS) {
        res.status(400).json({
          error: {
            code: 'INVALID_RADIUS',
            message: `Radius must be an integer between 1 and ${SPATIAL_CONSTANTS.MAX_RADIUS_METERS} meters`,
            requestId
          }
        });
        return;
      }
    }

    // Validate limit
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 1 || limit > SPATIAL_CONSTANTS.MAX_PROXIMITY_LIMIT) {
        res.status(400).json({
          error: {
            code: 'INVALID_LIMIT',
            message: `Limit must be an integer between 1 and ${SPATIAL_CONSTANTS.MAX_PROXIMITY_LIMIT}`,
            requestId
          }
        });
        return;
      }
    }

    // Validate propertyTypes if provided
    if (propertyTypes !== undefined) {
      if (!Array.isArray(propertyTypes) || propertyTypes.some(type => typeof type !== 'string')) {
        res.status(400).json({
          error: {
            code: 'INVALID_PROPERTY_TYPES',
            message: 'Property types must be an array of strings',
            requestId
          }
        });
        return;
      }
    }

    // Validate boolean flags
    if (includeDistance !== undefined && typeof includeDistance !== 'boolean') {
      res.status(400).json({
        error: {
          code: 'INVALID_INCLUDE_DISTANCE',
          message: 'includeDistance must be a boolean',
          requestId
        }
      });
      return;
    }

    if (includeBearing !== undefined && typeof includeBearing !== 'boolean') {
      res.status(400).json({
        error: {
          code: 'INVALID_INCLUDE_BEARING',
          message: 'includeBearing must be a boolean',
          requestId
        }
      });
      return;
    }

    logger.debug('Proximity request validation passed', { requestId, hasCoordinates: !!coordinates, hasAddress: !!address });
    next();
    return;

  } catch (error) {
    logger.error('Proximity request validation error', { requestId, error: error instanceof Error ? error.message : 'Unknown error' });
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId
      }
    });
    return;
  }
};

/**
 * Validate boundary lookup request parameters
 */
export const validateBoundaryRequest = (req: Request, res: Response, next: NextFunction) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  req.body.requestId = requestId;

  try {
    const { coordinates, includeLGA, includeElectoral, includePostal } = req.body;

    // Coordinates are required for boundary lookups
    if (!coordinates) {
      res.status(400).json({
        error: {
          code: 'MISSING_COORDINATES',
          message: 'Coordinates are required for boundary lookup',
          requestId
        }
      });
      return;
    }

    const { latitude, longitude } = coordinates;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      res.status(400).json({
        error: {
          code: 'INVALID_COORDINATES',
          message: 'Coordinates must be valid numbers',
          requestId
        }
      });
      return;
    }

    if (!SpatialOptimizer.validateAustralianCoordinates(latitude, longitude)) {
      res.status(400).json({
        error: {
          code: 'COORDINATES_OUT_OF_BOUNDS',
          message: `Coordinates must be within Australian territory (lat: ${AUSTRALIAN_BOUNDS.minLatitude} to ${AUSTRALIAN_BOUNDS.maxLatitude}, lng: ${AUSTRALIAN_BOUNDS.minLongitude} to ${AUSTRALIAN_BOUNDS.maxLongitude})`,
          requestId
        }
      });
      return;
    }

    // Validate boolean flags
    const booleanFlags = { includeLGA, includeElectoral, includePostal };
    for (const [key, value] of Object.entries(booleanFlags)) {
      if (value !== undefined && typeof value !== 'boolean') {
        res.status(400).json({
          error: {
            code: 'INVALID_BOOLEAN_FLAG',
            message: `${key} must be a boolean`,
            requestId
          }
        });
        return;
      }
    }

    logger.debug('Boundary request validation passed', { requestId, coordinates });
    next();
    return;

  } catch (error) {
    logger.error('Boundary request validation error', { requestId, error: error instanceof Error ? error.message : 'Unknown error' });
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId
      }
    });
    return;
  }
};

/**
 * Validate statistical area request parameters
 */
export const validateStatisticalAreaRequest = (req: Request, res: Response, next: NextFunction) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  req.body.requestId = requestId;

  try {
    const { coordinates, address, includeHierarchy } = req.body;

    // Must have either coordinates or address
    if (!coordinates && !address) {
      res.status(400).json({
        error: {
          code: 'MISSING_LOCATION',
          message: 'Either coordinates or address must be provided',
          requestId
        }
      });
      return;
    }

    // Validate coordinates if provided
    if (coordinates) {
      const { latitude, longitude } = coordinates;
      
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        res.status(400).json({
          error: {
            code: 'INVALID_COORDINATES',
            message: 'Coordinates must be valid numbers',
            requestId
          }
        });
        return;
      }

      if (!SpatialOptimizer.validateAustralianCoordinates(latitude, longitude)) {
        res.status(400).json({
          error: {
            code: 'COORDINATES_OUT_OF_BOUNDS',
            message: `Coordinates must be within Australian territory`,
            requestId
          }
        });
        return;
      }
    }

    // Validate address if provided
    if (address && (typeof address !== 'string' || address.trim().length < 3)) {
      res.status(400).json({
        error: {
          code: 'INVALID_ADDRESS',
          message: 'Address must be a string with at least 3 characters',
          requestId
        }
      });
      return;
    }

    // Validate includeHierarchy flag
    if (includeHierarchy !== undefined && typeof includeHierarchy !== 'boolean') {
      res.status(400).json({
        error: {
          code: 'INVALID_INCLUDE_HIERARCHY',
          message: 'includeHierarchy must be a boolean',
          requestId
        }
      });
      return;
    }

    logger.debug('Statistical area request validation passed', { requestId, hasCoordinates: !!coordinates, hasAddress: !!address });
    next();
    return;

  } catch (error) {
    logger.error('Statistical area request validation error', { requestId, error: error instanceof Error ? error.message : 'Unknown error' });
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId
      }
    });
    return;
  }
};

/**
 * Validate batch spatial request parameters
 */
export const validateBatchSpatialRequest = (req: Request, res: Response, next: NextFunction) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  req.body.requestId = requestId;

  try {
    const { operations, options } = req.body;

    // Operations array is required
    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      res.status(400).json({
        error: {
          code: 'MISSING_OPERATIONS',
          message: 'Operations array is required and must not be empty',
          requestId
        }
      });
      return;
    }

    if (operations.length > SPATIAL_CONSTANTS.MAX_BATCH_SIZE) {
      res.status(400).json({
        error: {
          code: 'BATCH_TOO_LARGE',
          message: `Batch size cannot exceed ${SPATIAL_CONSTANTS.MAX_BATCH_SIZE} operations`,
          requestId
        }
      });
      return;
    }

    // Validate each operation
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      
      if (!operation.id || typeof operation.id !== 'string') {
        res.status(400).json({
          error: {
            code: 'INVALID_OPERATION_ID',
            message: `Operation ${i} must have a valid string ID`,
            requestId
          }
        });
        return;
      }

      if (!['proximity', 'boundary', 'statistical'].includes(operation.type)) {
        res.status(400).json({
          error: {
            code: 'INVALID_OPERATION_TYPE',
            message: `Operation ${i} type must be 'proximity', 'boundary', or 'statistical'`,
            requestId
          }
        });
        return;
      }

      if (!operation.parameters || typeof operation.parameters !== 'object') {
        res.status(400).json({
          error: {
            code: 'MISSING_PARAMETERS',
            message: `Operation ${i} must have parameters object`,
            requestId
          }
        });
        return;
      }
    }

    // Validate options if provided
    if (options) {
      if (options.batchSize && (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > SPATIAL_CONSTANTS.MAX_BATCH_SIZE)) {
        res.status(400).json({
          error: {
            code: 'INVALID_BATCH_SIZE',
            message: `Batch size must be an integer between 1 and ${SPATIAL_CONSTANTS.MAX_BATCH_SIZE}`,
            requestId
          }
        });
        return;
      }

      if (options.progressCallback !== undefined && typeof options.progressCallback !== 'boolean') {
        res.status(400).json({
          error: {
            code: 'INVALID_PROGRESS_CALLBACK',
            message: 'progressCallback must be a boolean',
            requestId
          }
        });
        return;
      }

      if (options.failFast !== undefined && typeof options.failFast !== 'boolean') {
        res.status(400).json({
          error: {
            code: 'INVALID_FAIL_FAST',
            message: 'failFast must be a boolean',
            requestId
          }
        });
        return;
      }
    }

    logger.debug('Batch spatial request validation passed', { requestId, operationCount: operations.length });
    next();
    return;

  } catch (error) {
    logger.error('Batch spatial request validation error', { requestId, error: error instanceof Error ? error.message : 'Unknown error' });
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId
      }
    });
    return;
  }
};