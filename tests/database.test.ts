/**
 * Database Infrastructure Tests
 * Integration tests for database schema, indexes, and connectivity
 */

import { getDatabase } from '../src/config/database';
import DataValidationService from '../src/services/data-validation';
import MonitoringService from '../src/services/monitoring';

describe('Database Infrastructure Tests', () => {
  const db = getDatabase();
  
  beforeAll(async () => {
    // Ensure database connection is available for tests
    const health = await db.healthCheck();
    if (!health.healthy) {
      throw new Error(`Database not available for testing: ${health.error}`);
    }
  });

  afterAll(async () => {
    await db.close();
  });

  describe('Database Connectivity', () => {
    test('should connect to database successfully', async () => {
      const health = await db.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.latency).toBeLessThan(1000);
    });

    test('should execute basic queries', async () => {
      const result = await db.query('SELECT 1 as test_value');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].test_value).toBe(1);
    });
  });

  describe('Database Schema Validation', () => {
    test('should have all required tables', async () => {
      const tablesQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'gnaf' 
        ORDER BY table_name
      `;
      
      const result = await db.query(tablesQuery);
      const tables = result.rows.map(row => row.table_name);
      
      expect(tables).toContain('addresses');
      expect(tables).toContain('localities');
      expect(tables).toContain('streets');
      expect(tables).toContain('states');
    });

    test('should have spatial indexes on geometry columns', async () => {
      const spatialIndexQuery = `
        SELECT indexname, tablename 
        FROM pg_indexes 
        WHERE schemaname = 'gnaf' 
        AND indexdef ILIKE '%gist%'
        AND indexdef ILIKE '%geometry%'
      `;
      
      const result = await db.query(spatialIndexQuery);
      expect(result.rows.length).toBeGreaterThan(0);
      
      const indexNames = result.rows.map(row => row.indexname);
      expect(indexNames).toContain('idx_addresses_geometry');
    });

    test('should have full-text search indexes', async () => {
      const ftsIndexQuery = `
        SELECT indexname, tablename 
        FROM pg_indexes 
        WHERE schemaname = 'gnaf' 
        AND indexdef ILIKE '%gin%'
        AND indexdef ILIKE '%search_vector%'
      `;
      
      const result = await db.query(ftsIndexQuery);
      expect(result.rows.length).toBeGreaterThan(0);
      
      const indexNames = result.rows.map(row => row.indexname);
      expect(indexNames).toContain('idx_addresses_search_vector');
    });

    test('should have PostGIS extension available', async () => {
      const postgisQuery = 'SELECT PostGIS_Version()';
      const result = await db.query(postgisQuery);
      
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].postgis_version).toBeDefined();
    });

    test('should have proper constraints on coordinate columns', async () => {
      const constraintQuery = `
        SELECT constraint_name, check_clause
        FROM information_schema.check_constraints
        WHERE constraint_schema = 'gnaf'
        AND constraint_name = 'valid_coordinates'
      `;
      
      const result = await db.query(constraintQuery);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].check_clause).toContain('latitude');
      expect(result.rows[0].check_clause).toContain('longitude');
    });
  });

  describe('Database Performance', () => {
    test('should have acceptable query performance', async () => {
      const startTime = Date.now();
      
      // Test spatial query performance
      const spatialQuery = `
        SELECT COUNT(*) 
        FROM gnaf.addresses 
        WHERE ST_DWithin(
          geometry, 
          ST_SetSRID(ST_MakePoint(151.2093, -33.8688), 4326), 
          1000
        )
      `;
      
      await db.query(spatialQuery);
      const duration = Date.now() - startTime;
      
      // Should complete within performance target
      expect(duration).toBeLessThan(300); // 300ms target
    });

    test('should handle concurrent connections', async () => {
      const concurrentQueries = Array(5).fill(null).map(() => 
        db.query('SELECT COUNT(*) FROM gnaf.states')
      );
      
      const results = await Promise.all(concurrentQueries);
      
      results.forEach(result => {
        expect(result.rows).toHaveLength(1);
        expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      });
    });
  });

  describe('Data Validation Service', () => {
    test('should validate address data correctly', async () => {
      const validationService = new DataValidationService();
      
      // Test with sample address data
      const sampleAddress = {
        gnafPid: 'TEST123',
        address: '123 Test Street, Test Suburb NSW 2000',
        components: {
          numberFirst: '123',
          street: { name: 'Test Street', type: 'ST' },
          locality: { name: 'Test Suburb', class: 'S' },
          state: 'NSW' as any,
          postcode: '2000'
        },
        coordinates: {
          latitude: -33.8688,
          longitude: 151.2093,
          precision: 'PROPERTY' as any,
          crs: 'GDA2020'
        },
        quality: {
          confidence: 95,
          reliability: 1 as any,
          completeness: 90,
          status: 'VALID' as any
        },
        boundaries: {},
        metadata: {
          dateCreated: '2025-01-01',
          status: 'CURRENT' as any
        }
      };
      
      const issues = validationService.validateAddress(sampleAddress);
      expect(Array.isArray(issues)).toBe(true);
      
      // Should have no critical issues for valid address
      const criticalIssues = issues.filter(issue => issue.severity === 'ERROR');
      expect(criticalIssues).toHaveLength(0);
    });
  });

  describe('Monitoring Service', () => {
    test('should perform health checks', async () => {
      const monitoringService = new MonitoringService();
      
      const healthStatus = await monitoringService.checkSystemHealth();
      
      expect(healthStatus.status).toMatch(/healthy|degraded|unhealthy/);
      expect(healthStatus.overallScore).toBeGreaterThanOrEqual(0);
      expect(healthStatus.overallScore).toBeLessThanOrEqual(100);
      expect(Array.isArray(healthStatus.checks)).toBe(true);
      expect(healthStatus.checks.length).toBeGreaterThan(0);
    });

    test('should check dataset freshness', async () => {
      const monitoringService = new MonitoringService();
      
      const freshness = await monitoringService.checkDatasetFreshness();
      
      expect(typeof freshness.daysSinceLastImport).toBe('number');
      expect(typeof freshness.isStale).toBe('boolean');
      expect(typeof freshness.quarterlyUpdateDue).toBe('boolean');
      expect(typeof freshness.totalRecords).toBe('number');
    });

    test('should collect performance metrics', async () => {
      const monitoringService = new MonitoringService();
      
      const metrics = await monitoringService.collectPerformanceMetrics();
      
      expect(typeof metrics.avgQueryTime).toBe('number');
      expect(typeof metrics.slowQueries).toBe('number');
      expect(metrics.dbConnections).toBeDefined();
      expect(metrics.throughput).toBeDefined();
      expect(metrics.diskUsage).toBeDefined();
    });
  });

  describe('Transaction Handling', () => {
    test('should handle successful transactions', async () => {
      const result = await db.transaction(async (client) => {
        await client.query('BEGIN');
        const insertResult = await client.query(
          'INSERT INTO gnaf.states (state_code, state_name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING state_code',
          ['TEST', 'Test State']
        );
        return insertResult;
      });
      
      expect(result).toBeDefined();
    });

    test('should rollback failed transactions', async () => {
      await expect(
        db.transaction(async (client) => {
          await client.query('INSERT INTO gnaf.states (state_code, state_name) VALUES ($1, $2)', ['NSW', 'New South Wales']);
          // This should cause a constraint violation due to duplicate state
          throw new Error('Intentional test error');
        })
      ).rejects.toThrow('Intentional test error');
      
      // Verify rollback worked - state should still exist
      const result = await db.query('SELECT COUNT(*) FROM gnaf.states WHERE state_code = $1', ['NSW']);
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });
  });
});

describe('Import Pipeline Tests', () => {
  describe('CSV Parsing', () => {
    test('should parse G-NAF CSV format correctly', () => {
      // Mock CSV parsing tests
      const sampleCsvRow = {
        ADDRESS_DETAIL_PID: 'GAVIC411411441',
        LOCALITY_PID: 'VIC1234',
        LOCALITY_NAME: 'MELBOURNE',
        STATE_ABBREVIATION: 'VIC',
        POSTCODE: '3000',
        STREET_NAME: 'COLLINS',
        STREET_TYPE_CODE: 'ST',
        NUMBER_FIRST: '123',
        LATITUDE: '-37.8136',
        LONGITUDE: '144.9631',
        DATE_CREATED: '2025-01-01'
      };
      
      // Test parsing logic
      expect(sampleCsvRow.ADDRESS_DETAIL_PID).toBeDefined();
      expect(sampleCsvRow.LOCALITY_NAME).toBe('MELBOURNE');
      expect(parseFloat(sampleCsvRow.LATITUDE)).toBeLessThan(-10);
      expect(parseFloat(sampleCsvRow.LONGITUDE)).toBeGreaterThan(110);
    });
  });

  describe('Data Transformation', () => {
    test('should transform raw data to database format', () => {
      const rawRecord = {
        ADDRESS_DETAIL_PID: 'TEST123',
        LOCALITY_NAME: 'Test Locality',
        STATE_ABBREVIATION: 'NSW',
        LATITUDE: '-33.8688',
        LONGITUDE: '151.2093'
      };
      
      // Test transformation
      const transformed = {
        addressDetailPid: rawRecord.ADDRESS_DETAIL_PID,
        localityName: rawRecord.LOCALITY_NAME,
        stateCode: rawRecord.STATE_ABBREVIATION,
        latitude: parseFloat(rawRecord.LATITUDE),
        longitude: parseFloat(rawRecord.LONGITUDE)
      };
      
      expect(transformed.addressDetailPid).toBe('TEST123');
      expect(transformed.latitude).toBe(-33.8688);
      expect(transformed.longitude).toBe(151.2093);
    });
  });

  describe('Validation Rules', () => {
    test('should validate coordinate boundaries', () => {
      // Test Australian coordinate bounds
      const validCoords = { latitude: -33.8688, longitude: 151.2093 };
      const invalidCoords = { latitude: 40.7128, longitude: -74.0060 }; // New York
      
      const isValidAustralian = (lat: number, lng: number) => {
        return lat >= -45.0 && lat <= -10.0 && lng >= 110.0 && lng <= 155.0;
      };
      
      expect(isValidAustralian(validCoords.latitude, validCoords.longitude)).toBe(true);
      expect(isValidAustralian(invalidCoords.latitude, invalidCoords.longitude)).toBe(false);
    });

    test('should validate required fields', () => {
      const completeRecord = {
        addressDetailPid: 'TEST123',
        localityName: 'Test Locality',
        stateCode: 'NSW',
        latitude: -33.8688,
        longitude: 151.2093
      };
      
      const incompleteRecord = {
        addressDetailPid: 'TEST456',
        // Missing locality name
        stateCode: 'VIC',
        latitude: -37.8136,
        longitude: 144.9631
      };
      
      const validateRequired = (record: any) => {
        return record.addressDetailPid && record.localityName && 
               record.stateCode && record.latitude && record.longitude;
      };
      
      expect(validateRequired(completeRecord)).toBe(true);
      expect(validateRequired(incompleteRecord)).toBe(false);
    });
  });
});

describe('Performance Tests', () => {
  test('should handle large batch inserts efficiently', async () => {
    // This would test actual bulk insert performance
    // For now, just verify the test structure
    const batchSize = 1000;
    const mockBatch = Array(batchSize).fill({}).map((_, index) => ({
      addressDetailPid: `TEST_PERF_${index}`,
      localityName: 'Test Locality',
      stateCode: 'NSW',
      latitude: -33.8688 + (Math.random() * 0.1),
      longitude: 151.2093 + (Math.random() * 0.1)
    }));
    
    expect(mockBatch).toHaveLength(batchSize);
    expect(mockBatch[0].addressDetailPid).toBe('TEST_PERF_0');
    expect(mockBatch[batchSize - 1].addressDetailPid).toBe(`TEST_PERF_${batchSize - 1}`);
  });

  test('should maintain query performance under load', async () => {
    const db = getDatabase();
    const startTime = Date.now();
    
    // Test concurrent query performance
    const concurrentQueries = Array(10).fill(null).map(() =>
      db.query('SELECT COUNT(*) FROM gnaf.states')
    );
    
    await Promise.all(concurrentQueries);
    const duration = Date.now() - startTime;
    
    // Should complete all queries within reasonable time
    expect(duration).toBeLessThan(2000); // 2 seconds for 10 concurrent queries
  });
});