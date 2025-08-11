#!/usr/bin/env node

/**
 * Database setup script for G-NAF Address Service
 * Sets up PostgreSQL database with PostGIS extension
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

async function setupDatabase() {
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

    // Check PostgreSQL version
    const versionResult = await client.query('SELECT version()');
    logger.info(`PostgreSQL version: ${versionResult.rows[0].version}`);

    // Enable PostGIS extension
    logger.info('Enabling PostGIS extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
    
    // Verify PostGIS installation
    const postgisVersion = await client.query('SELECT PostGIS_Version()');
    logger.info(`PostGIS version: ${postgisVersion.rows[0].postgis_version}`);

    // Enable additional extensions for spatial functionality
    logger.info('Enabling additional spatial extensions...');
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis_topology');
    await client.query('CREATE EXTENSION IF NOT EXISTS fuzzystrmatch');
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder');

    // Create schema for G-NAF data if not exists
    logger.info('Creating gnaf schema...');
    await client.query('CREATE SCHEMA IF NOT EXISTS gnaf');
    
    // Set search path to include PostGIS functions
    const dbName = new URL(databaseUrl).pathname.substring(1);
    await client.query(`ALTER DATABASE ${dbName} SET search_path TO gnaf, public, postgis`);

    logger.info('Database setup completed successfully');

  } catch (error) {
    logger.error(`Database setup failed: ${error.message}`);
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
      logger.info('Database connection closed');
    }
  }
}

// Run setup if called directly
if (require.main === module) {
  setupDatabase().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = setupDatabase;