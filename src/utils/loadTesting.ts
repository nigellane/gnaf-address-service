/**
 * Load Testing Utilities
 * Performance benchmarking and load testing for GNAF Address Service
 */

import axios, { AxiosInstance } from 'axios';
import { performanceMonitoringService } from '../services/performanceMonitoringService';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('LoadTesting');

export interface LoadTestConfig {
  baseUrl: string;
  concurrentUsers: number;
  testDuration: number; // seconds
  rampUpTime?: number; // seconds
  endpoints: LoadTestEndpoint[];
}

export interface LoadTestEndpoint {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  payload?: any;
  weight: number; // relative frequency (1-10)
  expectedResponseTime: number; // ms
}

export interface LoadTestResult {
  testName: string;
  startTime: Date;
  endTime: Date;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  maxResponseTime: number;
  throughput: number; // requests per second
  errorRate: number;
  endpointResults: Array<{
    endpoint: string;
    requests: number;
    averageResponseTime: number;
    errorRate: number;
  }>;
  performanceScore: number; // 0-100
}

export interface BenchmarkTest {
  name: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST';
  payload?: any;
  expectedMaxResponseTime: number;
  iterations: number;
}

export class LoadTestingService {
  private static instance: LoadTestingService;
  private httpClient: AxiosInstance;
  private isRunning: boolean = false;

  constructor() {
    this.httpClient = axios.create({
      timeout: 30000,
      validateStatus: () => true // Don't throw on error status codes
    });
  }

  static getInstance(): LoadTestingService {
    if (!this.instance) {
      this.instance = new LoadTestingService();
    }
    return this.instance;
  }

  /**
   * Run comprehensive load test with multiple concurrent users
   */
  async runLoadTest(config: LoadTestConfig): Promise<LoadTestResult> {
    if (this.isRunning) {
      throw new Error('Load test is already running');
    }

    this.isRunning = true;
    const startTime = new Date();
    
    logger.info('Starting load test', {
      concurrentUsers: config.concurrentUsers,
      testDuration: config.testDuration,
      endpoints: config.endpoints.length
    });

    try {
      const results = await this.executeLoadTest(config);
      const endTime = new Date();

      const loadTestResult: LoadTestResult = {
        testName: `Load Test - ${config.concurrentUsers} users`,
        startTime,
        endTime,
        totalRequests: results.length,
        successfulRequests: results.filter(r => r.success).length,
        failedRequests: results.filter(r => !r.success).length,
        averageResponseTime: this.calculateAverage(results.map(r => r.responseTime)),
        p95ResponseTime: this.calculatePercentile(results.map(r => r.responseTime), 95),
        p99ResponseTime: this.calculatePercentile(results.map(r => r.responseTime), 99),
        maxResponseTime: Math.max(...results.map(r => r.responseTime)),
        throughput: results.length / config.testDuration,
        errorRate: (results.filter(r => !r.success).length / results.length) * 100,
        endpointResults: this.calculateEndpointResults(results),
        performanceScore: this.calculatePerformanceScore(results, config)
      };

      logger.info('Load test completed', {
        totalRequests: loadTestResult.totalRequests,
        successRate: `${100 - loadTestResult.errorRate}%`,
        averageResponseTime: `${loadTestResult.averageResponseTime}ms`,
        throughput: `${loadTestResult.throughput} req/s`,
        performanceScore: loadTestResult.performanceScore
      });

      return loadTestResult;

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run performance benchmark tests for specific endpoints
   */
  async runBenchmarkTests(tests: BenchmarkTest[]): Promise<{
    overallScore: number;
    results: Array<{
      test: BenchmarkTest;
      averageResponseTime: number;
      p95ResponseTime: number;
      successRate: number;
      passed: boolean;
      score: number;
    }>;
  }> {
    logger.info('Starting benchmark tests', { testCount: tests.length });

    const results = [];

    for (const test of tests) {
      logger.info(`Running benchmark: ${test.name}`);

      const responses = [];
      const startTime = Date.now();

      for (let i = 0; i < test.iterations; i++) {
        try {
          const response = await this.makeRequest(test.endpoint, test.method, test.payload);
          responses.push({
            responseTime: response.responseTime,
            success: response.success
          });
        } catch (error) {
          responses.push({
            responseTime: 0,
            success: false
          });
        }
      }

      const avgResponseTime = this.calculateAverage(responses.map(r => r.responseTime));
      const p95ResponseTime = this.calculatePercentile(responses.map(r => r.responseTime), 95);
      const successRate = (responses.filter(r => r.success).length / responses.length) * 100;
      const passed = avgResponseTime <= test.expectedMaxResponseTime && successRate >= 95;
      const score = this.calculateBenchmarkScore(avgResponseTime, test.expectedMaxResponseTime, successRate);

      results.push({
        test,
        averageResponseTime: avgResponseTime,
        p95ResponseTime,
        successRate,
        passed,
        score
      });

      logger.info(`Benchmark completed: ${test.name}`, {
        averageResponseTime: `${avgResponseTime}ms`,
        p95ResponseTime: `${p95ResponseTime}ms`,
        successRate: `${successRate}%`,
        passed
      });
    }

    const overallScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

    logger.info('Benchmark tests completed', {
      overallScore,
      passedTests: results.filter(r => r.passed).length,
      totalTests: results.length
    });

    return { overallScore, results };
  }

  /**
   * Create default load test scenarios for GNAF service
   */
  getDefaultLoadTestConfig(baseUrl: string, concurrentUsers: number = 100): LoadTestConfig {
    return {
      baseUrl,
      concurrentUsers,
      testDuration: 60, // 1 minute
      rampUpTime: 10, // 10 seconds
      endpoints: [
        {
          name: 'Address Search',
          method: 'GET',
          path: '/api/v1/addresses/search?q=collins+street+melbourne&limit=10',
          weight: 5,
          expectedResponseTime: 500
        },
        {
          name: 'Address Validation',
          method: 'POST',
          path: '/api/v1/addresses/validate',
          payload: {
            address: '123 Collins Street Melbourne VIC 3000',
            includeComponents: true,
            includeSuggestions: true
          },
          weight: 8,
          expectedResponseTime: 300
        },
        {
          name: 'Spatial Proximity',
          method: 'POST',
          path: '/api/v1/spatial/proximity',
          payload: {
            coordinates: { latitude: -37.8136, longitude: 144.9631 },
            radius: 1000,
            limit: 20
          },
          weight: 3,
          expectedResponseTime: 500
        },
        {
          name: 'Health Check',
          method: 'GET',
          path: '/api/v1/health',
          weight: 1,
          expectedResponseTime: 100
        }
      ]
    };
  }

  /**
   * Get default benchmark tests
   */
  getDefaultBenchmarkTests(baseUrl: string): BenchmarkTest[] {
    return [
      {
        name: 'Address Validation Performance',
        description: 'Validate address response time under normal load',
        endpoint: `${baseUrl}/api/v1/addresses/validate`,
        method: 'POST',
        payload: {
          address: '123 Collins Street Melbourne VIC 3000',
          includeComponents: true
        },
        expectedMaxResponseTime: 300,
        iterations: 50
      },
      {
        name: 'Address Search Performance',
        description: 'Search addresses response time',
        endpoint: `${baseUrl}/api/v1/addresses/search?q=collins+street&limit=10`,
        method: 'GET',
        expectedMaxResponseTime: 500,
        iterations: 50
      },
      {
        name: 'Spatial Query Performance',
        description: 'Spatial proximity query performance',
        endpoint: `${baseUrl}/api/v1/spatial/proximity`,
        method: 'POST',
        payload: {
          coordinates: { latitude: -37.8136, longitude: 144.9631 },
          radius: 1000,
          limit: 10
        },
        expectedMaxResponseTime: 500,
        iterations: 30
      },
      {
        name: 'Health Check Performance',
        description: 'Health endpoint response time',
        endpoint: `${baseUrl}/api/v1/health`,
        method: 'GET',
        expectedMaxResponseTime: 100,
        iterations: 100
      }
    ];
  }

  private async executeLoadTest(config: LoadTestConfig): Promise<Array<{
    endpoint: string;
    responseTime: number;
    success: boolean;
    statusCode: number;
  }>> {
    const results: Array<{
      endpoint: string;
      responseTime: number;
      success: boolean;
      statusCode: number;
    }> = [];

    // Create weighted endpoint selector
    const weightedEndpoints = this.createWeightedEndpoints(config.endpoints);

    // Calculate requests per user
    const requestsPerSecond = config.concurrentUsers * 2; // Assume 2 requests per second per user
    const totalRequests = requestsPerSecond * config.testDuration;

    // Execute concurrent requests
    const promises: Promise<void>[] = [];

    for (let i = 0; i < config.concurrentUsers; i++) {
      promises.push(this.simulateUser(config, weightedEndpoints, results));
    }

    await Promise.all(promises);

    return results;
  }

  private async simulateUser(
    config: LoadTestConfig,
    weightedEndpoints: LoadTestEndpoint[],
    results: Array<{ endpoint: string; responseTime: number; success: boolean; statusCode: number }>
  ): Promise<void> {
    const endTime = Date.now() + (config.testDuration * 1000);
    const rampUpDelay = config.rampUpTime ? Math.random() * config.rampUpTime * 1000 : 0;

    // Ramp up delay
    if (rampUpDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, rampUpDelay));
    }

    while (Date.now() < endTime) {
      try {
        // Select random endpoint based on weights
        const endpoint = weightedEndpoints[Math.floor(Math.random() * weightedEndpoints.length)];
        if (!endpoint) continue;
        
        const fullUrl = `${config.baseUrl}${endpoint.path}`;

        const response = await this.makeRequest(fullUrl, endpoint.method, endpoint.payload);
        
        results.push({
          endpoint: endpoint.name,
          responseTime: response.responseTime,
          success: response.success,
          statusCode: response.statusCode
        });

        // Random delay between requests (0.5-2 seconds)
        const delay = 500 + Math.random() * 1500;
        await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error) {
        results.push({
          endpoint: 'unknown',
          responseTime: 0,
          success: false,
          statusCode: 0
        });
      }
    }
  }

  private async makeRequest(url: string, method: 'GET' | 'POST', payload?: any): Promise<{
    responseTime: number;
    success: boolean;
    statusCode: number;
  }> {
    const startTime = Date.now();

    try {
      const response = method === 'POST'
        ? await this.httpClient.post(url, payload)
        : await this.httpClient.get(url);

      const responseTime = Date.now() - startTime;
      const success = response.status >= 200 && response.status < 400;

      return {
        responseTime,
        success,
        statusCode: response.status
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        responseTime,
        success: false,
        statusCode: 0
      };
    }
  }

  private createWeightedEndpoints(endpoints: LoadTestEndpoint[]): LoadTestEndpoint[] {
    const weighted: LoadTestEndpoint[] = [];
    
    endpoints.forEach(endpoint => {
      for (let i = 0; i < endpoint.weight; i++) {
        weighted.push(endpoint);
      }
    });

    return weighted;
  }

  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
  }

  private calculatePercentile(numbers: number[], percentile: number): number {
    if (numbers.length === 0) return 0;
    
    const sorted = [...numbers].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] || 0;
  }

  private calculateEndpointResults(results: Array<{
    endpoint: string;
    responseTime: number;
    success: boolean;
    statusCode: number;
  }>): Array<{
    endpoint: string;
    requests: number;
    averageResponseTime: number;
    errorRate: number;
  }> {
    const endpointMap = new Map<string, { times: number[]; errors: number }>();

    results.forEach(result => {
      const existing = endpointMap.get(result.endpoint) || { times: [], errors: 0 };
      existing.times.push(result.responseTime);
      if (!result.success) existing.errors++;
      endpointMap.set(result.endpoint, existing);
    });

    return Array.from(endpointMap.entries()).map(([endpoint, stats]) => ({
      endpoint,
      requests: stats.times.length,
      averageResponseTime: this.calculateAverage(stats.times),
      errorRate: (stats.errors / stats.times.length) * 100
    }));
  }

  private calculatePerformanceScore(results: Array<{
    endpoint: string;
    responseTime: number;
    success: boolean;
    statusCode: number;
  }>, config: LoadTestConfig): number {
    const successRate = (results.filter(r => r.success).length / results.length) * 100;
    const avgResponseTime = this.calculateAverage(results.map(r => r.responseTime));
    
    // Score based on success rate (0-50 points)
    const successScore = Math.min(50, (successRate / 100) * 50);
    
    // Score based on response time (0-50 points)
    // Assume good response time is under 300ms, excellent under 150ms
    const responseTimeScore = Math.max(0, 50 - Math.max(0, (avgResponseTime - 150) / 10));
    
    return Math.round(successScore + responseTimeScore);
  }

  private calculateBenchmarkScore(avgResponseTime: number, expectedMaxTime: number, successRate: number): number {
    const responseTimeScore = Math.max(0, 50 - Math.max(0, (avgResponseTime - expectedMaxTime) / expectedMaxTime * 50));
    const successScore = (successRate / 100) * 50;
    return Math.round(responseTimeScore + successScore);
  }
}

export const loadTestingService = LoadTestingService.getInstance();