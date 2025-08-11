/**
 * Spatial Analytics Routes
 * Route definitions for spatial analytics endpoints
 */

import { Router } from 'express';
import { spatialController } from '../controllers/spatialController';
import { authenticateApiKey } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimiting';
import {
  validateProximityRequest,
  validateBoundaryRequest,
  validateStatisticalAreaRequest,
  validateBatchSpatialRequest
} from '../middleware/spatialValidation';

const router = Router();

// Apply authentication and rate limiting to all spatial routes
router.use(authenticateApiKey);
router.use(rateLimit);

/**
 * POST /api/v1/spatial/proximity
 * Analyze proximity to find nearby properties
 * 
 * Request body:
 * {
 *   coordinates?: { latitude: number, longitude: number },
 *   address?: string,
 *   radius: number, // meters, max 5000
 *   limit?: number, // max 50, default 10
 *   propertyTypes?: string[],
 *   includeDistance?: boolean, // default true
 *   includeBearing?: boolean   // default false
 * }
 * 
 * Response: ProximityResponse with nearby properties and distances
 */
router.post('/proximity', validateProximityRequest, spatialController.analyzeProximity);

/**
 * POST /api/v1/spatial/boundaries
 * Lookup administrative boundaries for coordinates
 * 
 * Request body:
 * {
 *   coordinates: { latitude: number, longitude: number },
 *   includeLGA?: boolean,      // default true
 *   includeElectoral?: boolean, // default false  
 *   includePostal?: boolean    // default true
 * }
 * 
 * Response: BoundaryResponse with administrative boundary information
 * Note: Implementation will be completed in Task 2
 */
router.post('/boundaries', validateBoundaryRequest, spatialController.lookupBoundaries);

/**
 * POST /api/v1/spatial/statistical-areas
 * Classify statistical areas (SA1, SA2, SA3, SA4) for location
 * 
 * Request body:
 * {
 *   coordinates?: { latitude: number, longitude: number },
 *   address?: string,
 *   includeHierarchy?: boolean // default true
 * }
 * 
 * Response: StatisticalAreaResponse with ABS area classification
 * Note: Implementation will be completed in Task 3
 */
router.post('/statistical-areas', validateStatisticalAreaRequest, spatialController.classifyStatisticalAreas);

/**
 * POST /api/v1/spatial/batch/analyze
 * Batch processing for multiple spatial operations
 * 
 * Request body:
 * {
 *   operations: Array<{
 *     id: string,
 *     type: 'proximity' | 'boundary' | 'statistical',
 *     parameters: ProximityRequest | BoundaryLookupParams | StatisticalAreaRequest
 *   }>,
 *   options?: {
 *     batchSize?: number,     // max 100, default 10
 *     progressCallback?: boolean,
 *     failFast?: boolean
 *   }
 * }
 * 
 * Response: BatchSpatialResponse with results for all operations
 * Note: Implementation will be completed in Task 4
 */
router.post('/batch/analyze', validateBatchSpatialRequest, spatialController.batchAnalyze);

/**
 * GET /api/v1/spatial/health
 * Health check for spatial analytics service
 * 
 * Response: Health status including PostGIS availability and performance metrics
 */
router.get('/health', spatialController.healthCheck);

export default router;