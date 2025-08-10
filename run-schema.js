#!/usr/bin/env node

// Load environment variables
require('dotenv').config();

const fs = require('fs');
const { getDatabase } = require('./dist/config/database');

async function runSchema() {
  console.log('Running database schema creation...');
  
  try {
    const db = getDatabase();
    
    // Read the schema file
    const schemaSQL = fs.readFileSync('scripts/create-schema.sql', 'utf8');
    
    console.log('Executing schema creation...');
    await db.query(schemaSQL);
    
    console.log('✅ Schema created successfully!');
    
    // Verify tables were created
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'gnaf'
      ORDER BY table_name
    `);
    
    console.log('Created tables:', tables.rows.map(r => r.table_name));
    
  } catch (error) {
    console.error('❌ Schema creation failed:', error.message);
  } finally {
    process.exit(0);
  }
}

runSchema();