#!/usr/bin/env node

/**
 * System Test Script - Test G-NAF Infrastructure
 * Run this to verify the system is working
 */

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
      name: 'Indexes Performance',
      test: testIndexes
    },
    {
      name: 'Monitoring Service',
      test: testMonitoring
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      logger.info(`🔍 Testing ${test.name}...`);
      await test.test();
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
  } else {
    logger.warn('\n⚠️  Some tests failed. Check your database configuration.');
  }
}

async function testDatabaseConnection() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable not set');
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl });
  
  await client.connect();
  const result = await client.query('SELECT version()');
  
  if (!result.rows[0].version.includes('PostgreSQL')) {
    throw new Error('Not connected to PostgreSQL');
  }
  
  await client.end();
  logger.info(`  📊 Connected to: ${result.rows[0].version.split(',')[0]}`);
}

async function testSchemaExists() {
  const { getDatabase } = require('../dist/config/database');
  const db = getDatabase();
  
  // Check if gnaf schema exists
  const schemaResult = await db.query(`
    SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'gnaf'
  `);
  
  if (schemaResult.rows.length === 0) {
    throw new Error('GNAF schema not found. Run: npm run db:setup && node scripts/create-schema.js');
  }
  
  // Check for required tables
  const tablesResult = await db.query(`
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
  await db.close();
}

async function testPostGIS() {
  const { getDatabase } = require('../dist/config/database');
  const db = getDatabase();
  
  // Test PostGIS version
  const versionResult = await db.query('SELECT PostGIS_Version()');
  const postgisVersion = versionResult.rows[0].postgis_version;
  
  // Test spatial function
  const spatialResult = await db.query(`
    SELECT ST_AsText(ST_MakePoint(151.2093, -33.8688)) as sydney_point
  `);
  
  if (!spatialResult.rows[0].sydney_point.includes('POINT')) {
    throw new Error('PostGIS spatial functions not working');
  }
  
  logger.info(`  🗺️  PostGIS Version: ${postgisVersion}`);
  logger.info(`  📍 Spatial Test: ${spatialResult.rows[0].sydney_point}`);
  await db.close();
}

async function testIndexes() {
  const { getDatabase } = require('../dist/config/database');
  const db = getDatabase();
  
  // Check for spatial indexes
  const spatialIndexQuery = `
    SELECT indexname FROM pg_indexes 
    WHERE schemaname = 'gnaf' 
    AND indexdef ILIKE '%gist%'
  `;
  
  const spatialIndexes = await db.query(spatialIndexQuery);
  
  if (spatialIndexes.rows.length === 0) {
    throw new Error('No spatial indexes found');
  }
  
  // Check for full-text search indexes
  const ftsIndexQuery = `
    SELECT indexname FROM pg_indexes 
    WHERE schemaname = 'gnaf' 
    AND indexdef ILIKE '%gin%'
  `;
  
  const ftsIndexes = await db.query(ftsIndexQuery);
  
  logger.info(`  🔍 Spatial Indexes: ${spatialIndexes.rows.length}`);
  logger.info(`  📝 Full-text Indexes: ${ftsIndexes.rows.length}`);
  
  await db.close();
}

async function testMonitoring() {
  // Test monitoring service
  try {
    const MonitoringService = require('../dist/services/monitoring').default;
    const monitoring = new MonitoringService();
    
    const health = await monitoring.checkSystemHealth();
    
    if (!health || typeof health.overallScore !== 'number') {
      throw new Error('Monitoring service not returning valid health data');
    }
    
    logger.info(`  💚 System Health: ${health.status} (${health.overallScore}%)`);
    logger.info(`  🔧 Health Checks: ${health.checks.length} completed`);
    
  } catch (error) {
    if (error.message.includes('DATABASE_URL')) {
      throw new Error('Monitoring requires database connection');
    }
    throw error;
  }
}

// Run tests if called directly
if (require.main === module) {
  testSystem().catch((error) => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = testSystem;