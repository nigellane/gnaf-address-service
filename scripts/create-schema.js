#!/usr/bin/env node

/**
 * Database schema creation script for G-NAF Address Service
 * Creates tables, indexes, and functions for G-NAF data storage
 */

const { Client } = require('pg');
const winston = require('winston');
const fs = require('fs').promises;
const path = require('path');

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

async function createSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    logger.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  let client;

  try {
    // Connect to database
    client = new Client({
      connectionString: databaseUrl
    });

    await client.connect();
    logger.info('Connected to PostgreSQL database');

    // Read schema SQL file
    const schemaPath = path.join(__dirname, 'create-schema.sql');
    const schemaSql = await fs.readFile(schemaPath, 'utf8');
    
    logger.info('Creating G-NAF database schema...');
    
    // Execute schema creation
    await client.query('BEGIN');
    
    // Split SQL file into individual statements and execute
    const statements = schemaSql.split(';').filter(stmt => stmt.trim().length > 0);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (statement.length > 0) {
        try {
          await client.query(statement);
          logger.debug(`Executed statement ${i + 1}/${statements.length}`);
        } catch (error) {
          logger.error(`Error in statement ${i + 1}: ${error.message}`);
          logger.error(`Statement: ${statement.substring(0, 100)}...`);
          throw error;
        }
      }
    }
    
    await client.query('COMMIT');
    
    // Verify schema creation
    logger.info('Verifying schema creation...');
    
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'gnaf' 
      ORDER BY table_name
    `);
    
    const tables = tablesResult.rows.map(row => row.table_name);
    logger.info(`Created tables: ${tables.join(', ')}`);
    
    // Check indexes
    const indexesResult = await client.query(`
      SELECT schemaname, tablename, indexname 
      FROM pg_indexes 
      WHERE schemaname = 'gnaf' 
      ORDER BY tablename, indexname
    `);
    
    logger.info(`Created ${indexesResult.rows.length} indexes`);
    
    // Check PostGIS functionality
    const postgisTest = await client.query(`
      SELECT ST_AsText(ST_MakePoint(151.2093, -33.8688)) as sydney_point
    `);
    
    logger.info(`PostGIS test: ${postgisTest.rows[0].sydney_point}`);
    
    logger.info('Schema creation completed successfully');

  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error(`Rollback failed: ${rollbackError.message}`);
      }
    }
    
    logger.error(`Schema creation failed: ${error.message}`);
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
      logger.info('Database connection closed');
    }
  }
}

// Run schema creation if called directly
if (require.main === module) {
  createSchema().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = createSchema;