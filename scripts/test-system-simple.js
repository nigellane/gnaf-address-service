#!/usr/bin/env node

/**
 * Simple System Test Script - Test G-NAF Infrastructure
 * Works directly with pg library, no TypeScript compilation needed
 */

const { Client } = require('pg');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

async function testSystem() {
  logger.info('🧪 Starting G-NAF System Test...\n');

  const tests = [
    {
      name: 'Database Connection',
      test: testDatabaseConnection
    },
    {
      name: 'Schema Validation', 
      test: testSchemaExists
    },
    {
      name: 'PostGIS Functionality',
      test: testPostGIS
    },
    {
      name: 'Spatial Indexes',
      test: testSpatialIndexes
    },
    {
      name: 'Full-text Search Indexes',
      test: testFullTextIndexes
    },
    {
      name: 'Database Performance',
      test: testPerformance
    }
  ];

  let passed = 0;
  let failed = 0;
  let client;

  try {
    // Create database connection
    client = new Client({
      connectionString: process.env.DATABASE_URL
    });
    await client.connect();

    for (const test of tests) {
      try {
        logger.info(`🔍 Testing ${test.name}...`);
        await test.test(client);
        logger.info(`✅ ${test.name} - PASSED\n`);
        passed++;
      } catch (error) {
        logger.error(`❌ ${test.name} - FAILED: ${error.message}\n`);
        failed++;
      }
    }

    logger.info('📊 Test Results:');
    logger.info(`✅ Passed: ${passed}`);
    logger.info(`❌ Failed: ${failed}`);
    logger.info(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);

    if (failed === 0) {
      logger.info('\n🎉 All tests passed! G-NAF infrastructure is ready.');
      logger.info('\n🚀 Next steps:');
      logger.info('  1. Import real G-NAF dataset: npm run gnaf:download && npm run gnaf:import');
      logger.info('  2. Build REST API endpoints for address search');
      logger.info('  3. Create web frontend for address queries');
    } else {
      logger.warn('\n⚠️  Some tests failed. Check your database configuration.');
    }

  } finally {
    if (client) {
      await client.end();
    }
  }
}

async function testDatabaseConnection(client) {
  const result = await client.query('SELECT version()');
  
  if (!result.rows[0].version.includes('PostgreSQL')) {
    throw new Error('Not connected to PostgreSQL');
  }
  
  logger.info(`  📊 Connected to: ${result.rows[0].version.split(',')[0]}`);
}

async function testSchemaExists(client) {
  // Check if gnaf schema exists
  const schemaResult = await client.query(`
    SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'gnaf'
  `);
  
  if (schemaResult.rows.length === 0) {
    throw new Error('GNAF schema not found');
  }
  
  // Check for required tables
  const tablesResult = await client.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'gnaf' ORDER BY table_name
  `);
  
  const tables = tablesResult.rows.map(r => r.table_name);
  const requiredTables = ['addresses', 'localities', 'streets', 'states'];
  
  for (const table of requiredTables) {
    if (!tables.includes(table)) {
      throw new Error(`Required table '${table}' not found`);
    }
  }
  
  logger.info(`  📋 Found tables: ${tables.join(', ')}`);
}

async function testPostGIS(client) {
  // Test PostGIS version
  const versionResult = await client.query('SELECT PostGIS_Version()');
  const postgisVersion = versionResult.rows[0].postgis_version;
  
  // Test spatial function
  const spatialResult = await client.query(`
    SELECT ST_AsText(ST_MakePoint(151.2093, -33.8688)) as sydney_point
  `);
  
  if (!spatialResult.rows[0].sydney_point.includes('POINT')) {
    throw new Error('PostGIS spatial functions not working');
  }
  
  // Test geometry creation and spatial query
  const geometryTest = await client.query(`
    SELECT ST_Distance(
      ST_SetSRID(ST_MakePoint(151.2093, -33.8688), 4326),
      ST_SetSRID(ST_MakePoint(151.2193, -33.8788), 4326)
    ) as distance_meters
  `);
  
  const distance = parseFloat(geometryTest.rows[0].distance_meters);
  if (distance <= 0) {
    throw new Error('Spatial distance calculation failed');
  }
  
  logger.info(`  🗺️  PostGIS Version: ${postgisVersion}`);
  logger.info(`  📍 Spatial Test: ${spatialResult.rows[0].sydney_point}`);
  logger.info(`  📏 Distance Calculation: ${distance.toFixed(2)} meters`);
}

async function testSpatialIndexes(client) {
  // Check for spatial indexes
  const spatialIndexQuery = `
    SELECT indexname, tablename FROM pg_indexes 
    WHERE schemaname = 'gnaf' 
    AND indexdef ILIKE '%gist%'
    ORDER BY indexname
  `;
  
  const spatialIndexes = await client.query(spatialIndexQuery);
  
  if (spatialIndexes.rows.length === 0) {
    throw new Error('No spatial (GIST) indexes found');
  }
  
  const indexNames = spatialIndexes.rows.map(row => `${row.tablename}.${row.indexname}`);
  logger.info(`  🔍 Spatial Indexes (${spatialIndexes.rows.length}): ${indexNames.join(', ')}`);
}

async function testFullTextIndexes(client) {
  // Check for full-text search indexes
  const ftsIndexQuery = `
    SELECT indexname, tablename FROM pg_indexes 
    WHERE schemaname = 'gnaf' 
    AND indexdef ILIKE '%gin%'
    ORDER BY indexname
  `;
  
  const ftsIndexes = await client.query(ftsIndexQuery);
  
  if (ftsIndexes.rows.length === 0) {
    throw new Error('No full-text search (GIN) indexes found');
  }
  
  const indexNames = ftsIndexes.rows.map(row => `${row.tablename}.${row.indexname}`);
  logger.info(`  📝 Full-text Indexes (${ftsIndexes.rows.length}): ${indexNames.join(', ')}`);
  
  // Test text search functionality
  const searchTest = await client.query(`
    SELECT to_tsvector('english', 'Sydney Australia NSW 2000') @@ to_tsquery('english', 'sydney') as search_works
  `);
  
  if (!searchTest.rows[0].search_works) {
    throw new Error('Full-text search functionality not working');
  }
  
  logger.info(`  🔎 Full-text Search: Working`);
}

async function testPerformance(client) {
  // Test query performance
  const startTime = Date.now();
  
  // Test spatial query performance
  await client.query(`
    SELECT ST_DWithin(
      ST_SetSRID(ST_MakePoint(151.2093, -33.8688), 4326),
      ST_SetSRID(ST_MakePoint(151.2193, -33.8788), 4326),
      1000
    ) as within_distance
  `);
  
  const spatialDuration = Date.now() - startTime;
  
  // Test connection pool info
  const connectionTest = Date.now();
  await client.query('SELECT 1 as connection_test');
  const connectionDuration = Date.now() - connectionTest;
  
  // Test database size
  const sizeQuery = `
    SELECT 
      pg_size_pretty(pg_database_size(current_database())) as db_size,
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'gnaf') as table_count
  `;
  
  const sizeResult = await client.query(sizeQuery);
  const dbInfo = sizeResult.rows[0];
  
  logger.info(`  ⚡ Spatial Query: ${spatialDuration}ms`);
  logger.info(`  🔌 Connection: ${connectionDuration}ms`);  
  logger.info(`  💾 Database Size: ${dbInfo.db_size}`);
  logger.info(`  📊 Tables Created: ${dbInfo.table_count}`);
  
  // Warn if performance is concerning
  if (spatialDuration > 100) {
    logger.warn(`    ⚠️  Spatial query took ${spatialDuration}ms (>100ms)`);
  }
}

// Run tests if called directly
if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    console.log('💡 Make sure you have created a .env file with DATABASE_URL');
    process.exit(1);
  }

  testSystem().catch((error) => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = testSystem;