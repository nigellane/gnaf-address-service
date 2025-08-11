/**
 * Batch Spatial Processing Service
 * Handles concurrent spatial operations with configurable batch sizes
 */

import { SpatialOptimizer } from '../utils/spatialOptimizer';
import { spatialAnalyticsService } from './spatialAnalyticsService';
import { boundaryService } from './boundaryService';
import { statisticalAreaService } from './statisticalAreaService';
import Logger from '../utils/logger';
import { 
  BatchSpatialRequest, 
  BatchSpatialResponse, 
  ProximityRequest, 
  BoundaryLookupParams, 
  StatisticalAreaRequest,
  SpatialPerformanceMetrics 
} from '../types/spatial';

const logger = Logger.createServiceLogger('BatchSpatialService');

export class BatchSpatialService {
  private static instance: BatchSpatialService;
  private activeJobs: Map<string, { total: number; completed: number; failed: number; startTime: number }> = new Map();

  static getInstance(): BatchSpatialService {
    if (!this.instance) {
      this.instance = new BatchSpatialService();
    }
    return this.instance;
  }

  /**
   * Process batch spatial operations with concurrent execution
   */
  async processBatch(request: BatchSpatialRequest): Promise<BatchSpatialResponse> {
    const startTime = Date.now();
    const jobId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    
    try {
      // Validate and normalize batch size
      const batchSize = this.normalizeBatchSize(request.options?.batchSize, request.operations.length);
      const failFast = request.options?.failFast ?? false;

      logger.info('Starting batch spatial processing', {
        jobId,
        totalOperations: request.operations.length,
        batchSize,
        failFast
      });

      // Initialize job tracking
      this.activeJobs.set(jobId, {
        total: request.operations.length,
        completed: 0,
        failed: 0,
        startTime
      });

      const results: BatchSpatialResponse['results'] = [];
      let successCount = 0;
      let failureCount = 0;

      // Process operations in batches to manage resource usage
      for (let i = 0; i < request.operations.length; i += batchSize) {
        const batch = request.operations.slice(i, i + batchSize);
        
        // Process current batch concurrently
        const batchPromises = batch.map(async (operation) => {
          try {
            const result = await this.processOperation(operation);
            
            // Update job tracking
            const job = this.activeJobs.get(jobId);
            if (job) {
              job.completed++;
              this.activeJobs.set(jobId, job);
            }

            return {
              id: operation.id,
              type: operation.type,
              status: 'success' as const,
              data: result
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            // Update job tracking
            const job = this.activeJobs.get(jobId);
            if (job) {
              job.failed++;
              this.activeJobs.set(jobId, job);
            }

            logger.warn('Batch operation failed', {
              jobId,
              operationId: operation.id,
              operationType: operation.type,
              error: errorMessage
            });

            return {
              id: operation.id,
              type: operation.type,
              status: 'error' as const,
              error: errorMessage
            };
          }
        });

        // Wait for current batch to complete
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Count successes and failures
        batchResults.forEach(result => {
          if (result.status === 'success') {
            successCount++;
          } else {
            failureCount++;
          }
        });

        // Check fail-fast condition
        if (failFast && failureCount > 0) {
          logger.warn('Batch processing stopped due to fail-fast mode', {
            jobId,
            processedOperations: results.length,
            failures: failureCount
          });
          break;
        }

        // Add small delay between batches to prevent resource exhaustion
        if (i + batchSize < request.operations.length) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      const processingTime = Date.now() - startTime;

      // Clean up job tracking
      this.activeJobs.delete(jobId);

      // Record performance metrics
      this.recordPerformanceMetrics({
        queryType: 'batch',
        executionTime: processingTime,
        resultCount: results.length,
        usesSpatialIndex: true
      });

      const response: BatchSpatialResponse = {
        results,
        summary: {
          total: request.operations.length,
          successful: successCount,
          failed: failureCount,
          processingTime,
          batchSize
        }
      };

      logger.info('Batch spatial processing completed', {
        jobId,
        total: response.summary.total,
        successful: response.summary.successful,
        failed: response.summary.failed,
        processingTime: `${processingTime}ms`,
        batchSize: response.summary.batchSize
      });

      return response;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      // Clean up job tracking
      this.activeJobs.delete(jobId);

      logger.error('Batch spatial processing failed', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: `${processingTime}ms`
      });
      throw error;
    }
  }

  /**
   * Process a single spatial operation
   */
  private async processOperation(operation: BatchSpatialRequest['operations'][0]): Promise<any> {
    switch (operation.type) {
      case 'proximity':
        return await spatialAnalyticsService.analyzeProximity(operation.parameters as ProximityRequest);
      
      case 'boundary':
        return await boundaryService.lookupBoundaries(operation.parameters as BoundaryLookupParams);
      
      case 'statistical':
        return await statisticalAreaService.classifyStatisticalAreas(operation.parameters as StatisticalAreaRequest);
      
      default:
        throw new Error(`Unsupported operation type: ${operation.type}`);
    }
  }

  /**
   * Normalize batch size based on operation count and limits
   */
  private normalizeBatchSize(requestedSize: number | undefined, operationCount: number): number {
    if (!requestedSize) {
      return SpatialOptimizer.calculateOptimalBatchSize('proximity', operationCount);
    }

    // Ensure batch size is within limits
    const minBatchSize = 1;
    const maxBatchSize = Math.min(operationCount, 50); // Cap at 50 for resource management
    
    return Math.max(minBatchSize, Math.min(requestedSize, maxBatchSize));
  }

  /**
   * Get status of active batch jobs
   */
  getActiveJobs(): Array<{ jobId: string; total: number; completed: number; failed: number; progress: number; duration: number }> {
    const now = Date.now();
    return Array.from(this.activeJobs.entries()).map(([jobId, job]) => ({
      jobId,
      total: job.total,
      completed: job.completed,
      failed: job.failed,
      progress: Math.round((job.completed / job.total) * 100),
      duration: now - job.startTime
    }));
  }

  /**
   * Get batch processing statistics
   */
  getProcessingStats(): {
    activeJobs: number;
    totalOperationsInProgress: number;
    averageBatchDuration: number;
  } {
    const activeJobs = this.activeJobs.size;
    const totalOperations = Array.from(this.activeJobs.values()).reduce((sum, job) => sum + job.total, 0);
    
    // Calculate average batch duration (simplified)
    const now = Date.now();
    const durations = Array.from(this.activeJobs.values()).map(job => now - job.startTime);
    const averageBatchDuration = durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0;

    return {
      activeJobs,
      totalOperationsInProgress: totalOperations,
      averageBatchDuration: Math.round(averageBatchDuration)
    };
  }

  /**
   * Health check for batch processing service
   */
  async healthCheck(): Promise<{ 
    status: 'healthy' | 'degraded' | 'unhealthy'; 
    activeJobs: number; 
    servicesAvailable: { proximity: boolean; boundary: boolean; statistical: boolean }
  }> {
    try {
      // Check if underlying services are healthy
      const [proximityHealth, boundaryHealth, statisticalHealth] = await Promise.all([
        spatialAnalyticsService.healthCheck(),
        boundaryService.healthCheck(),
        statisticalAreaService.healthCheck()
      ]);

      const servicesAvailable = {
        proximity: proximityHealth.status === 'healthy',
        boundary: boundaryHealth.status === 'healthy',
        statistical: statisticalHealth.status === 'healthy'
      };

      const availableServices = Object.values(servicesAvailable).filter(Boolean).length;
      const activeJobs = this.activeJobs.size;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (availableServices === 0) {
        status = 'unhealthy';
      } else if (availableServices < 3 || activeJobs > 10) {
        status = 'degraded';
      }

      return {
        status,
        activeJobs,
        servicesAvailable
      };
    } catch (error) {
      logger.error('Batch service health check failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      return {
        status: 'unhealthy',
        activeJobs: 0,
        servicesAvailable: {
          proximity: false,
          boundary: false,
          statistical: false
        }
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
export const batchSpatialService = BatchSpatialService.getInstance();