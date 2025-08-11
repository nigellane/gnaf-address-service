/**
 * Spatial Analytics Controller
 * Handles HTTP requests for spatial analytics endpoints
 */

import { Request, Response } from 'express';
import { spatialAnalyticsService } from '../services/spatialAnalyticsService';
import { boundaryService } from '../services/boundaryService';
import { statisticalAreaService } from '../services/statisticalAreaService';
import { batchSpatialService } from '../services/batchSpatialService';
import Logger from '../utils/logger';
import { ProximityRequest, BoundaryLookupParams, StatisticalAreaRequest, BatchSpatialRequest } from '../types/spatial';

const logger = Logger.createServiceLogger('SpatialController');

export class SpatialController {
  private static instance: SpatialController;

  static getInstance(): SpatialController {
    if (!this.instance) {
      this.instance = new SpatialController();
    }
    return this.instance;
  }

  /**
   * POST /api/v1/spatial/proximity
   * Analyze proximity to find nearby properties
   */
  analyzeProximity = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = req.body.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    try {
      logger.info('Proximity analysis request received', { requestId });

      const proximityRequest: ProximityRequest = req.body;
      const result = await spatialAnalyticsService.analyzeProximity(proximityRequest);

      const responseTime = Date.now() - startTime;

      res.status(200)
        .header('X-Response-Time', `${responseTime}ms`)
        .header('X-Request-ID', requestId)
        .json({
          success: true,
          data: result,
          meta: {
            requestId,
            responseTime,
            timestamp: new Date().toISOString()
          }
        });

      logger.info('Proximity analysis completed successfully', { 
        requestId, 
        resultCount: result.results.length,
        responseTime: `${responseTime}ms`
      });

    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Proximity analysis failed', { requestId, error: error instanceof Error ? error.message : 'Unknown error', responseTime });

      // Determine appropriate error status code
      let statusCode = 500;
      let errorCode = 'INTERNAL_ERROR';

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('coordinates') || errorMessage.includes('territory')) {
        statusCode = 400;
        errorCode = 'INVALID_COORDINATES';
      } else if (errorMessage.includes('geocode') || errorMessage.includes('address')) {
        statusCode = 400;
        errorCode = 'GEOCODING_FAILED';
      }

      res.status(statusCode)
        .header('X-Response-Time', `${responseTime}ms`)
        .header('X-Request-ID', requestId)
        .json({
          error: {
            code: errorCode,
            message: errorMessage,
            requestId,
            timestamp: new Date().toISOString()
          }
        });
    }
  };

  /**
   * GET /api/v1/spatial/health
   * Health check for spatial analytics service
   */
  healthCheck = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = `health_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    try {
      logger.debug('Spatial health check requested', { requestId });

      const healthStatus = await spatialAnalyticsService.healthCheck();
      const performanceStats = spatialAnalyticsService.getPerformanceStats();
      const batchServiceHealth = await batchSpatialService.healthCheck();
      const batchStats = batchSpatialService.getProcessingStats();

      const responseTime = Date.now() - startTime;

      const overallStatus = (healthStatus.status === 'healthy' && batchServiceHealth.status === 'healthy') ? 'healthy' : 
                           (healthStatus.status === 'degraded' || batchServiceHealth.status === 'degraded') ? 'degraded' : 'unhealthy';

      res.status(overallStatus === 'unhealthy' ? 503 : 200)
        .header('X-Response-Time', `${responseTime}ms`)
        .header('X-Request-ID', requestId)
        .json({
          status: overallStatus,
          timestamp: new Date().toISOString(),
          version: process.env.npm_package_version || '1.0.0',
          checks: {
            spatialAnalytics: healthStatus,
            batchProcessing: batchServiceHealth,
            performance: {
              averageExecutionTime: performanceStats.averageExecutionTime,
              slowQueries: performanceStats.slowQueries,
              totalQueries: performanceStats.totalQueries,
              spatialIndexUsage: performanceStats.spatialIndexUsage
            },
            batchStats: {
              activeJobs: batchStats.activeJobs,
              totalOperationsInProgress: batchStats.totalOperationsInProgress,
              averageBatchDuration: batchStats.averageBatchDuration
            }
          },
          meta: {
            requestId,
            responseTime
          }
        });

      logger.debug('Spatial health check completed', { 
        requestId, 
        status: overallStatus,
        responseTime: `${responseTime}ms`
      });

    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Spatial health check failed', { requestId, error: error instanceof Error ? error.message : 'Unknown error' });

      res.status(503)
        .header('X-Response-Time', `${responseTime}ms`)
        .header('X-Request-ID', requestId)
        .json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: {
            code: 'HEALTH_CHECK_FAILED',
            message: 'Spatial analytics service health check failed',
            requestId
          }
        });
    }
  };

  /**
   * POST /api/v1/spatial/boundaries
   * Lookup administrative boundaries for given coordinates
   */
  lookupBoundaries = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = req.body.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    try {
      logger.info('Boundary lookup request received', { requestId });

      const boundaryRequest: BoundaryLookupParams = req.body;
      const result = await boundaryService.lookupBoundaries(boundaryRequest);

      const responseTime = Date.now() - startTime;

      res.status(200)
        .header('X-Response-Time', `${responseTime}ms`)
        .header('X-Request-ID', requestId)
        .json({
          success: true,
          data: result,
          meta: {
            requestId,
            responseTime,
            timestamp: new Date().toISOString()
          }
        });

      logger.info('Boundary lookup completed successfully', { 
        requestId, 
        hasLGA: !!result.boundaries.localGovernmentArea,
        hasElectoral: !!result.boundaries.electoralDistrict,
        hasPostal: !!result.boundaries.postalArea,
        responseTime: `${responseTime}ms`
      });

    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Boundary lookup failed', { requestId, error: error instanceof Error ? error.message : 'Unknown error', responseTime });

      // Determine appropriate error status code
      let statusCode = 500;
      let errorCode = 'INTERNAL_ERROR';

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('coordinates') || errorMessage.includes('territory')) {
        statusCode = 400;
        errorCode = 'INVALID_COORDINATES';
      } else if (errorMessage.includes('locality found')) {
        statusCode = 404;
        errorCode = 'LOCATION_NOT_FOUND';
      }

      res.status(statusCode)
        .header('X-Response-Time', `${responseTime}ms`)
        .header('X-Request-ID', requestId)
        .json({
          error: {
            code: errorCode,
            message: errorMessage,
            requestId,
            timestamp: new Date().toISOString()
          }
        });
    }
  };

  /**
   * POST /api/v1/spatial/statistical-areas
   * Classify statistical areas (SA1, SA2, SA3, SA4) for location
   */
  classifyStatisticalAreas = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = req.body.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    try {
      logger.info('Statistical area classification request received', { requestId });

      const statisticalRequest: StatisticalAreaRequest = req.body;
      const result = await statisticalAreaService.classifyStatisticalAreas(statisticalRequest);

      const responseTime = Date.now() - startTime;

      res.status(200)
        .header('X-Response-Time', `${responseTime}ms`)
        .header('X-Request-ID', requestId)
        .json({
          success: true,
          data: result,
          meta: {
            requestId,
            responseTime,
            timestamp: new Date().toISOString()
          }
        });

      logger.info('Statistical area classification completed successfully', { 
        requestId, 
        sa1: result.classification.sa1.code,
        sa2: result.classification.sa2.code,
        sa3: result.classification.sa3.code,
        sa4: result.classification.sa4.code,
        dataSource: result.metadata.dataSource,
        responseTime: `${responseTime}ms`
      });

    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Statistical area classification failed', { requestId, error: error instanceof Error ? error.message : 'Unknown error', responseTime });

      // Determine appropriate error status code
      let statusCode = 500;
      let errorCode = 'INTERNAL_ERROR';

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('coordinates') || errorMessage.includes('territory')) {
        statusCode = 400;
        errorCode = 'INVALID_COORDINATES';
      } else if (errorMessage.includes('geocode') || errorMessage.includes('address')) {
        statusCode = 400;
        errorCode = 'GEOCODING_FAILED';
      } else if (errorMessage.includes('statistical area data found')) {
        statusCode = 404;
        errorCode = 'STATISTICAL_DATA_NOT_FOUND';
      }

      res.status(statusCode)
        .header('X-Response-Time', `${responseTime}ms`)
        .header('X-Request-ID', requestId)
        .json({
          error: {
            code: errorCode,
            message: errorMessage,
            requestId,
            timestamp: new Date().toISOString()
          }
        });
    }
  };

  /**
   * POST /api/v1/spatial/batch/analyze
   * Process multiple spatial operations concurrently
   */
  batchAnalyze = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = req.body.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    try {
      logger.info('Batch spatial processing request received', { 
        requestId, 
        operationCount: req.body.operations?.length || 0 
      });

      const batchRequest: BatchSpatialRequest = req.body;
      const result = await batchSpatialService.processBatch(batchRequest);

      const responseTime = Date.now() - startTime;

      res.status(200)
        .header('X-Response-Time', `${responseTime}ms`)
        .header('X-Request-ID', requestId)
        .json({
          success: true,
          data: result,
          meta: {
            requestId,
            responseTime,
            timestamp: new Date().toISOString()
          }
        });

      logger.info('Batch spatial processing completed successfully', { 
        requestId,
        totalOperations: result.summary.total,
        successful: result.summary.successful,
        failed: result.summary.failed,
        batchSize: result.summary.batchSize,
        processingTime: `${result.summary.processingTime}ms`,
        responseTime: `${responseTime}ms`
      });

    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Batch spatial processing failed', { requestId, error: error instanceof Error ? error.message : 'Unknown error', responseTime });

      // Determine appropriate error status code
      let statusCode = 500;
      let errorCode = 'INTERNAL_ERROR';

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('operations') || errorMessage.includes('batch')) {
        statusCode = 400;
        errorCode = 'INVALID_BATCH_REQUEST';
      } else if (errorMessage.includes('limit') || errorMessage.includes('size')) {
        statusCode = 400;
        errorCode = 'BATCH_SIZE_EXCEEDED';
      }

      res.status(statusCode)
        .header('X-Response-Time', `${responseTime}ms`)
        .header('X-Request-ID', requestId)
        .json({
          error: {
            code: errorCode,
            message: errorMessage,
            requestId,
            timestamp: new Date().toISOString()
          }
        });
    }
  };
}

// Export singleton instance
export const spatialController = SpatialController.getInstance();