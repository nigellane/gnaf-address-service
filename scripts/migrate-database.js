#!/usr/bin/env node

/**
 * Database migration script for G-NAF Address Service
 * Handles schema versioning and migration management
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

class MigrationManager {
  constructor(databaseUrl) {
    this.databaseUrl = databaseUrl;
    this.migrationsPath = path.join(__dirname, 'migrations');
    this.client = null;
  }

  async connect() {
    this.client = new Client({
      connectionString: this.databaseUrl
    });
    await this.client.connect();
  }

  async disconnect() {
    if (this.client) {
      await this.client.end();
    }
  }

  async ensureMigrationsTable() {
    const createMigrationsTable = `
      CREATE TABLE IF NOT EXISTS gnaf.migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW(),
        checksum VARCHAR(64) NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_migrations_version ON gnaf.migrations(version);
    `;

    await this.client.query(createMigrationsTable);
    logger.info('Migrations table ensured');
  }

  async getAppliedMigrations() {
    const result = await this.client.query(
      'SELECT version, name, applied_at, checksum FROM gnaf.migrations ORDER BY version'
    );
    return result.rows;
  }

  async getMigrationFiles() {
    try {
      const files = await fs.readdir(this.migrationsPath);
      const migrationFiles = files
        .filter(file => file.endsWith('.sql'))
        .sort()
        .map(file => {
          const match = file.match(/^(\d+)_(.+)\.sql$/);
          if (!match) {
            throw new Error(`Invalid migration filename: ${file}`);
          }
          return {
            version: match[1],
            name: match[2],
            filename: file,
            path: path.join(this.migrationsPath, file)
          };
        });

      return migrationFiles;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('Migrations directory not found, creating it...');
        await fs.mkdir(this.migrationsPath, { recursive: true });
        return [];
      }
      throw error;
    }
  }

  async calculateChecksum(content) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async applyMigration(migration) {
    const content = await fs.readFile(migration.path, 'utf8');
    const checksum = await this.calculateChecksum(content);

    logger.info(`Applying migration ${migration.version}: ${migration.name}`);

    try {
      await this.client.query('BEGIN');

      // Execute migration SQL
      await this.client.query(content);

      // Record migration
      await this.client.query(
        'INSERT INTO gnaf.migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, checksum]
      );

      await this.client.query('COMMIT');
      
      logger.info(`Migration ${migration.version} applied successfully`);
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  async validateMigration(migration, appliedMigration) {
    const content = await fs.readFile(migration.path, 'utf8');
    const checksum = await this.calculateChecksum(content);

    if (checksum !== appliedMigration.checksum) {
      throw new Error(
        `Checksum mismatch for migration ${migration.version}. ` +
        `Expected: ${appliedMigration.checksum}, Got: ${checksum}`
      );
    }
  }

  async migrate() {
    await this.ensureMigrationsTable();

    const appliedMigrations = await this.getAppliedMigrations();
    const migrationFiles = await this.getMigrationFiles();

    logger.info(`Found ${migrationFiles.length} migration files`);
    logger.info(`${appliedMigrations.length} migrations already applied`);

    const appliedVersions = new Set(appliedMigrations.map(m => m.version));

    // Validate existing migrations haven't changed
    for (const applied of appliedMigrations) {
      const migrationFile = migrationFiles.find(f => f.version === applied.version);
      if (migrationFile) {
        await this.validateMigration(migrationFile, applied);
      } else {
        logger.warn(`Applied migration ${applied.version} not found in files`);
      }
    }

    // Apply new migrations
    const pendingMigrations = migrationFiles.filter(m => !appliedVersions.has(m.version));

    if (pendingMigrations.length === 0) {
      logger.info('No pending migrations');
      return;
    }

    logger.info(`Applying ${pendingMigrations.length} pending migrations`);

    for (const migration of pendingMigrations) {
      await this.applyMigration(migration);
    }

    logger.info('All migrations applied successfully');
  }

  async rollback(targetVersion) {
    const appliedMigrations = await this.getAppliedMigrations();
    const migrationsToRollback = appliedMigrations
      .filter(m => m.version > targetVersion)
      .reverse();

    if (migrationsToRollback.length === 0) {
      logger.info(`No migrations to rollback to version ${targetVersion}`);
      return;
    }

    logger.info(`Rolling back ${migrationsToRollback.length} migrations`);

    for (const migration of migrationsToRollback) {
      const rollbackPath = path.join(
        this.migrationsPath, 
        'rollbacks', 
        `${migration.version}_${migration.name}.sql`
      );

      try {
        const rollbackSql = await fs.readFile(rollbackPath, 'utf8');
        
        logger.info(`Rolling back migration ${migration.version}: ${migration.name}`);

        await this.client.query('BEGIN');
        await this.client.query(rollbackSql);
        await this.client.query(
          'DELETE FROM gnaf.migrations WHERE version = $1',
          [migration.version]
        );
        await this.client.query('COMMIT');

        logger.info(`Migration ${migration.version} rolled back successfully`);
      } catch (error) {
        await this.client.query('ROLLBACK');
        if (error.code === 'ENOENT') {
          logger.error(`Rollback script not found: ${rollbackPath}`);
        }
        throw error;
      }
    }
  }

  async status() {
    await this.ensureMigrationsTable();
    
    const appliedMigrations = await this.getAppliedMigrations();
    const migrationFiles = await this.getMigrationFiles();

    console.log('\n=== Migration Status ===');
    console.log(`Applied migrations: ${appliedMigrations.length}`);
    console.log(`Available migrations: ${migrationFiles.length}`);

    const appliedVersions = new Set(appliedMigrations.map(m => m.version));

    for (const file of migrationFiles) {
      const status = appliedVersions.has(file.version) ? 'APPLIED' : 'PENDING';
      const appliedInfo = appliedVersions.has(file.version) 
        ? appliedMigrations.find(m => m.version === file.version)
        : null;
      
      console.log(
        `  ${file.version}_${file.name}: ${status}` +
        (appliedInfo ? ` (${appliedInfo.applied_at})` : '')
      );
    }
    console.log('');
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    logger.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const command = process.argv[2] || 'migrate';
  const manager = new MigrationManager(databaseUrl);

  try {
    await manager.connect();
    
    switch (command) {
      case 'migrate':
        await manager.migrate();
        break;
      case 'rollback':
        const targetVersion = process.argv[3];
        if (!targetVersion) {
          logger.error('Target version required for rollback');
          process.exit(1);
        }
        await manager.rollback(targetVersion);
        break;
      case 'status':
        await manager.status();
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        logger.info('Available commands: migrate, rollback <version>, status');
        process.exit(1);
    }
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    process.exit(1);
  } finally {
    await manager.disconnect();
  }
}

// Create initial migration if migrations directory doesn't exist
async function createInitialMigration() {
  const migrationsPath = path.join(__dirname, 'migrations');
  
  try {
    await fs.mkdir(migrationsPath, { recursive: true });
    await fs.mkdir(path.join(migrationsPath, 'rollbacks'), { recursive: true });

    const initialMigration = `-- Initial G-NAF schema migration
-- Version: 001
-- Description: Create initial schema with PostGIS support

-- This migration is handled by create-schema.js
-- This file serves as a placeholder for the migration system

SELECT 'Initial migration placeholder' as status;
`;

    const initialMigrationPath = path.join(migrationsPath, '001_initial_schema.sql');
    
    try {
      await fs.access(initialMigrationPath);
      logger.info('Initial migration already exists');
    } catch {
      await fs.writeFile(initialMigrationPath, initialMigration);
      logger.info('Created initial migration file');
    }

  } catch (error) {
    logger.error(`Failed to create migrations directory: ${error.message}`);
  }
}

// Run migration if called directly
if (require.main === module) {
  createInitialMigration().then(() => {
    main().catch((error) => {
      console.error('Unhandled error:', error);
      process.exit(1);
    });
  });
}

module.exports = MigrationManager;