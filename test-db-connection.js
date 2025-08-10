#!/usr/bin/env node

// Load environment variables
require('dotenv').config();

const { getDatabase } = require('./dist/config/database');

async function testConnection() {
  console.log('Testing database connection...');
  console.log(`Host: ${process.env.DATABASE_URL}`);
  
  try {
    const db = getDatabase();
    
    // Test basic connectivity
    const healthCheck = await db.healthCheck();
    console.log('Health check:', healthCheck);
    
    // Test a simple query
    const result = await db.query('SELECT version() as version, current_timestamp as time');
    console.log('Database version:', result.rows[0].version);
    console.log('Current time:', result.rows[0].time);
    
    // Test schema access
    const schemaCheck = await db.query('SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1', ['gnaf']);
    console.log('GNAF schema exists:', schemaCheck.rows.length > 0);
    
    // Test PostGIS extension
    const postgisCheck = await db.query('SELECT PostGIS_Version() as postgis_version');
    console.log('PostGIS version:', postgisCheck.rows[0].postgis_version);
    
    console.log('✅ Database connection successful!');
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    process.exit(0);
  }
}

testConnection();