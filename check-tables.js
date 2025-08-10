#!/usr/bin/env node

// Load environment variables
require('dotenv').config();

const { getDatabase } = require('./dist/config/database');

async function checkTables() {
  console.log('Checking database tables...');
  
  try {
    const db = getDatabase();
    
    // Check what schemas exist
    const schemas = await db.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name IN ('gnaf', 'public')
      ORDER BY schema_name
    `);
    console.log('Available schemas:', schemas.rows);
    
    // Check what tables exist in gnaf schema
    const gnafTables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'gnaf'
      ORDER BY table_name
    `);
    console.log('Tables in gnaf schema:', gnafTables.rows);
    
    // Check what tables exist in public schema
    const publicTables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    console.log('Tables in public schema:', publicTables.rows);
    
    // Check migrations table
    const migrations = await db.query(`
      SELECT * FROM migrations ORDER BY id
    `);
    console.log('Applied migrations:', migrations.rows);
    
  } catch (error) {
    console.error('❌ Error checking tables:', error.message);
  } finally {
    process.exit(0);
  }
}

checkTables();