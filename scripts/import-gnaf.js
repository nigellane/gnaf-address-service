#!/usr/bin/env node

/**
 * G-NAF Dataset Import Script
 * Implements bulk data import with progress monitoring and validation
 */

// Load environment variables
require('dotenv').config();

const { createReadStream } = require('fs');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');
const { parse } = require('csv-parse');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

// Import database manager
const { getDatabase } = require('../dist/config/database');

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../logs/import.log'),
      level: 'debug'
    })
  ]
});

class GNAFImporter {
  constructor() {
    this.dataPath = process.env.GNAF_DATASET_PATH || path.join(__dirname, '../data');
    this.batchSize = parseInt(process.env.IMPORT_BATCH_SIZE || '100');
    this.maxConcurrentBatches = parseInt(process.env.MAX_CONCURRENT_BATCHES || '3');
    this.importId = uuidv4();
    this.db = getDatabase();
    
    this.stats = {
      startTime: null,
      endTime: null,
      totalRecords: 0,
      processedRecords: 0,
      validRecords: 0,
      invalidRecords: 0,
      insertedRecords: 0,
      failedRecords: 0,
      currentBatch: 0,
      totalBatches: 0,
      avgProcessingTime: 0,
      currentFile: null
    };

    this.validationErrors = new Map();
  }

  async import() {
    try {
      await this.ensureLogsDirectory();
      await this.validateDatabaseConnection();
      
      this.stats.startTime = Date.now();
      logger.info(`Starting G-NAF import with ID: ${this.importId}`);
      
      // Import in order: States, Localities, Streets, then Addresses
      await this.importStates();
      await this.importLocalities();
      await this.importStreets(); 
      await this.importAddresses();
      
      await this.createIndexes();
      await this.generateStatistics();
      await this.optimizeDatabase();
      
      this.stats.endTime = Date.now();
      await this.logImportSummary();
      
      logger.info('G-NAF import completed successfully');

    } catch (error) {
      logger.error(`Import failed: ${error.message}`);
      await this.cleanup();
      throw error;
    }
  }

  async ensureLogsDirectory() {
    const logsDir = path.join(__dirname, '../logs');
    try {
      await fs.mkdir(logsDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  async validateDatabaseConnection() {
    const health = await this.db.healthCheck();
    if (!health.healthy) {
      throw new Error(`Database connection failed: ${health.error}`);
    }
    logger.info(`Database connection validated (${health.latency}ms)`);
  }

  async importStates() {
    logger.info('Importing states (static data)...');
    
    // States are predefined in the schema, just verify they exist
    const result = await this.db.query('SELECT COUNT(*) FROM gnaf.states');
    const stateCount = parseInt(result.rows[0].count);
    
    if (stateCount === 0) {
      logger.warn('No states found in database. Running schema creation...');
      // States should be created by the schema
      throw new Error('States table is empty. Please run create-schema script first.');
    }
    
    logger.info(`Verified ${stateCount} states in database`);
  }

  async importLocalities() {
    // Find only LOCALITY files, not STREET_LOCALITY files
    const csvFiles = await this.findSpecificCsvFiles('LOCALITY', ['STREET_LOCALITY', 'LOCALITY_ALIAS', 'LOCALITY_POINT', 'LOCALITY_NEIGHBOUR']);
    if (csvFiles.length === 0) {
      logger.warn('Locality files not found, skipping...');
      return;
    }

    logger.info(`Importing localities from ${csvFiles.length} files`);
    let totalProcessed = 0;
    let totalInserted = 0;

    for (const csvFile of csvFiles) {
      logger.info(`Processing localities file: ${path.basename(csvFile)}`);
      this.stats.currentFile = csvFile;
      
      const { processed, inserted } = await this.processLocalityFile(csvFile);
      totalProcessed += processed;
      totalInserted += inserted;
    }
    
    logger.info(`Localities import completed: ${totalInserted}/${totalProcessed} records from ${csvFiles.length} files`);
  }

  async processLocalityFile(csvFile) {
    let processedCount = 0;
    let insertedCount = 0;
    let batch = [];

    // Determine delimiter based on file extension
    const delimiter = csvFile.endsWith('.psv') ? '|' : ',';
    
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: delimiter
    });

    const transformer = new Transform({
      objectMode: true,
      transform: (record, encoding, callback) => {
        try {
          if (this.validateLocalityRecord(record)) {
            const stateCode = this.mapStatePidToAbbreviation(record.STATE_PID);
            batch.push([
              record.LOCALITY_PID,
              record.LOCALITY_NAME,
              record.LOCALITY_CLASS_CODE || 'S',
              stateCode,
              record.PRIMARY_POSTCODE || null,
              null, // latitude - not in locality file
              null  // longitude - not in locality file
            ]);

            processedCount++;

            if (batch.length >= this.batchSize) {
              this.processBatch(batch, 'localities')
                .then(count => {
                  insertedCount += count;
                  this.logProgress('localities', processedCount, insertedCount);
                })
                .catch(error => logger.error('Batch processing error:', error));
              
              batch = [];
            }
          }
        } catch (error) {
          logger.error('Error processing locality record:', error);
        }
        callback();
      },
      
      flush: async (callback) => {
        if (batch.length > 0) {
          try {
            const count = await this.processBatch(batch, 'localities');
            insertedCount += count;
          } catch (error) {
            logger.error('Final batch processing error:', error);
          }
        }
        
        logger.info(`File ${path.basename(csvFile)}: ${insertedCount}/${processedCount} records`);
        callback();
      }
    });

    await pipeline(
      createReadStream(csvFile),
      parser,
      transformer
    );
    
    return { processed: processedCount, inserted: insertedCount };
  }

  async importStreets() {
    const csvFiles = await this.findCsvFiles('STREET_LOCALITY', 'street');
    if (csvFiles.length === 0) {
      logger.warn('Street files not found, skipping...');
      return;
    }

    logger.info(`Importing streets from ${csvFiles.length} files`);
    let totalProcessed = 0;
    let totalInserted = 0;

    for (const csvFile of csvFiles) {
      logger.info(`Processing streets file: ${path.basename(csvFile)}`);
      this.stats.currentFile = csvFile;
      
      const { processed, inserted } = await this.processStreetFile(csvFile);
      totalProcessed += processed;
      totalInserted += inserted;
    }
    
    logger.info(`Streets import completed: ${totalInserted}/${totalProcessed} records from ${csvFiles.length} files`);
  }

  async processStreetFile(csvFile) {
    let processedCount = 0;
    let insertedCount = 0;
    let batch = [];

    // Determine delimiter based on file extension
    const delimiter = csvFile.endsWith('.psv') ? '|' : ',';
    
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: delimiter
    });

    const transformer = new Transform({
      objectMode: true,
      transform: (record, encoding, callback) => {
        try {
          if (this.validateStreetRecord(record)) {
            batch.push([
              record.STREET_LOCALITY_PID,
              record.STREET_NAME,
              record.STREET_TYPE_CODE || null,
              record.STREET_SUFFIX_CODE || null,
              record.LOCALITY_PID
            ]);

            processedCount++;

            if (batch.length >= this.batchSize) {
              this.processBatch(batch, 'streets')
                .then(count => {
                  insertedCount += count;
                  this.logProgress('streets', processedCount, insertedCount);
                })
                .catch(error => logger.error('Batch processing error:', error));
              
              batch = [];
            }
          }
        } catch (error) {
          logger.error('Error processing street record:', error);
        }
        callback();
      },
      
      flush: async (callback) => {
        if (batch.length > 0) {
          try {
            const count = await this.processBatch(batch, 'streets');
            insertedCount += count;
          } catch (error) {
            logger.error('Final batch processing error:', error);
          }
        }
        
        logger.info(`File ${path.basename(csvFile)}: ${insertedCount}/${processedCount} records`);
        callback();
      }
    });

    await pipeline(
      createReadStream(csvFile),
      parser,
      transformer
    );
    
    return { processed: processedCount, inserted: insertedCount };
  }

  async importAddresses() {
    const csvFiles = await this.findCsvFiles('ADDRESS_DETAIL', 'address');
    if (csvFiles.length === 0) {
      throw new Error('Address files not found');
    }

    logger.info(`Importing addresses from ${csvFiles.length} files`);
    
    // Count total records across all files for progress tracking
    let totalRecords = 0;
    for (const csvFile of csvFiles) {
      const count = await this.countFileRecords(csvFile);
      totalRecords += count;
    }
    this.stats.totalRecords = totalRecords;
    
    let totalProcessed = 0;
    let totalInserted = 0;

    for (const csvFile of csvFiles) {
      logger.info(`Processing addresses file: ${path.basename(csvFile)}`);
      this.stats.currentFile = csvFile;
      
      // Load geocoding data for this state
      const geocodingData = await this.loadGeocodingData(csvFile);
      logger.info(`Loaded ${Object.keys(geocodingData).length} geocoding records for ${path.basename(csvFile)}`);
      
      const { processed, inserted } = await this.processAddressFile(csvFile, geocodingData);
      totalProcessed += processed;
      totalInserted += inserted;
    }
    
    logger.info(`Addresses import completed: ${totalInserted}/${totalProcessed} records from ${csvFiles.length} files`);
  }

  async countFileRecords(csvFile) {
    try {
      let lineCount = 0;
      const delimiter = csvFile.endsWith('.psv') ? '|' : ',';
      const parser = parse({ columns: false, delimiter });
      
      await pipeline(
        createReadStream(csvFile),
        parser,
        new Transform({
          objectMode: true,
          transform(chunk, encoding, callback) {
            lineCount++;
            callback();
          }
        })
      );

      return Math.max(0, lineCount - 1); // Subtract header
    } catch (error) {
      logger.warn(`Could not count records in ${path.basename(csvFile)}: ${error.message}`);
      return 0;
    }
  }

  async loadGeocodingData(addressFile) {
    // Extract state from address filename (e.g., ACT_ADDRESS_DETAIL_psv.psv -> ACT)
    const addressFileName = path.basename(addressFile);
    const state = addressFileName.split('_')[0];
    
    // Find corresponding geocoding file
    const geocodeFiles = await this.findCsvFiles('ADDRESS_DEFAULT_GEOCODE', 'geocode');
    const stateGeocodeFile = geocodeFiles.find(file => 
      path.basename(file).startsWith(`${state}_ADDRESS_DEFAULT_GEOCODE`)
    );
    
    if (!stateGeocodeFile) {
      logger.warn(`No geocoding file found for state ${state}`);
      return {};
    }
    
    logger.info(`Loading geocoding data from ${path.basename(stateGeocodeFile)}`);
    
    const geocodingData = {};
    const delimiter = stateGeocodeFile.endsWith('.psv') ? '|' : ',';
    
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: delimiter
    });

    const transformer = new Transform({
      objectMode: true,
      transform: (record, encoding, callback) => {
        if (record.ADDRESS_DETAIL_PID && record.LATITUDE && record.LONGITUDE) {
          geocodingData[record.ADDRESS_DETAIL_PID] = {
            latitude: parseFloat(record.LATITUDE),
            longitude: parseFloat(record.LONGITUDE),
            geocodeType: record.GEOCODE_TYPE_CODE || 'UNKNOWN'
          };
        }
        callback();
      }
    });

    await pipeline(
      createReadStream(stateGeocodeFile),
      parser,
      transformer
    );
    
    return geocodingData;
  }

  async processAddressFile(csvFile, geocodingData = {}) {
    let processedCount = 0;
    let insertedCount = 0;
    let batch = [];
    let lastProgressTime = Date.now();

    // Determine delimiter based on file extension
    const delimiter = csvFile.endsWith('.psv') ? '|' : ',';
    
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: delimiter
    });

    const transformer = new Transform({
      objectMode: true,
      transform: (record, encoding, callback) => {
        try {
          const addressData = this.transformAddressRecord(record, geocodingData);
          
          if (addressData) {
            batch.push(addressData);
            this.stats.validRecords++;
          } else {
            this.stats.invalidRecords++;
          }

          processedCount++;
          this.stats.processedRecords = processedCount;

          if (batch.length >= this.batchSize) {
            this.processBatch(batch, 'addresses')
              .then(count => {
                insertedCount += count;
                this.stats.insertedRecords = insertedCount;
                
                // Log progress every 10 seconds
                const now = Date.now();
                if (now - lastProgressTime > 10000) {
                  this.logProgress('addresses', processedCount, insertedCount);
                  lastProgressTime = now;
                }
              })
              .catch(error => {
                logger.error('Batch processing error:', error);
                this.stats.failedRecords += batch.length;
              });
            
            batch = [];
          }
        } catch (error) {
          logger.error('Error processing address record:', error);
          this.stats.invalidRecords++;
        }
        callback();
      },
      
      flush: async (callback) => {
        if (batch.length > 0) {
          try {
            const count = await this.processBatch(batch, 'addresses');
            insertedCount += count;
            this.stats.insertedRecords = insertedCount;
          } catch (error) {
            logger.error('Final batch processing error:', error);
            this.stats.failedRecords += batch.length;
          }
        }
        
        logger.info(`File ${path.basename(csvFile)}: ${insertedCount}/${processedCount} records`);
        callback();
      }
    });

    await pipeline(
      createReadStream(csvFile),
      parser,
      transformer
    );
    
    return { processed: processedCount, inserted: insertedCount };
  }

  async processBatch(batch, tableName) {
    const startTime = Date.now();

    try {
      if (tableName === 'localities') {
        return await this.insertLocalitiesBatch(batch);
      } else if (tableName === 'streets') {
        return await this.insertStreetsBatch(batch);
      } else if (tableName === 'addresses') {
        return await this.insertAddressesBatch(batch);
      }
    } catch (error) {
      logger.error(`Batch insert failed for ${tableName}:`, error);
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      this.updateProcessingTime(duration);
    }
  }

  async insertLocalitiesBatch(batch) {
    const query = `
      INSERT INTO gnaf.localities 
      (locality_pid, locality_name, locality_class, state_code, postcode, latitude, longitude)
      VALUES ${batch.map((_, i) => `($${i*7+1}, $${i*7+2}, $${i*7+3}, $${i*7+4}, $${i*7+5}, $${i*7+6}, $${i*7+7})`).join(', ')}
      ON CONFLICT (locality_pid) DO UPDATE SET
        locality_name = EXCLUDED.locality_name,
        postcode = EXCLUDED.postcode,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        updated_at = NOW()
    `;

    const params = batch.flat();
    await this.db.query(query, params);
    return batch.length;
  }

  async insertStreetsBatch(batch) {
    const query = `
      INSERT INTO gnaf.streets 
      (street_locality_pid, street_name, street_type, street_suffix, locality_pid)
      VALUES ${batch.map((_, i) => `($${i*5+1}, $${i*5+2}, $${i*5+3}, $${i*5+4}, $${i*5+5})`).join(', ')}
      ON CONFLICT (street_locality_pid) DO UPDATE SET
        street_name = EXCLUDED.street_name,
        street_type = EXCLUDED.street_type,
        street_suffix = EXCLUDED.street_suffix,
        updated_at = NOW()
    `;

    const params = batch.flat();
    await this.db.query(query, params);
    return batch.length;
  }

  async insertAddressesBatch(batch) {
    const query = `
      INSERT INTO gnaf.addresses (
        address_detail_pid, gnaf_pid, building_name, lot_number, flat_type, flat_number,
        number_first, number_last, street_locality_pid, locality_pid, address_line,
        formatted_address, latitude, longitude, coordinate_precision, coordinate_reliability,
        coordinate_crs, confidence_score, completeness_score, validation_status,
        lga_code, lga_name, legal_parcel_id, address_status, gnaf_date_created,
        gnaf_date_last_modified, gnaf_date_retired, import_batch_id
      ) VALUES ${batch.map((_, i) => {
        const start = i * 28;
        return `(${Array.from({length: 28}, (_, j) => `$${start + j + 1}`).join(', ')})`;
      }).join(', ')}
      ON CONFLICT (address_detail_pid) DO UPDATE SET
        formatted_address = EXCLUDED.formatted_address,
        confidence_score = EXCLUDED.confidence_score,
        completeness_score = EXCLUDED.completeness_score,
        updated_at = NOW()
    `;

    const params = batch.flat();
    
    if (params.length === 0) {
      logger.error('Empty parameters array for batch insert', { batchSize: batch.length });
      return 0;
    }
    
    if (params.length !== batch.length * 28) {
      logger.error('Parameter count mismatch', { 
        expected: batch.length * 28, 
        actual: params.length,
        batchSize: batch.length 
      });
      return 0;
    }
    
    await this.db.query(query, params);
    return batch.length;
  }

  transformAddressRecord(record, geocodingData = {}) {
    try {
      // Validate required fields
      if (!record.ADDRESS_DETAIL_PID || !record.LOCALITY_PID) {
        return null;
      }

      // Get coordinates from geocoding data
      const geocoding = geocodingData[record.ADDRESS_DETAIL_PID];
      let latitude = null;
      let longitude = null;
      let geocodeType = 'LOCALITY';
      
      if (geocoding) {
        latitude = geocoding.latitude;
        longitude = geocoding.longitude;
        geocodeType = geocoding.geocodeType;
        
        // Validate coordinates are within Australia bounds
        if (latitude < -45 || latitude > -10 || longitude < 110 || longitude > 155) {
          logger.warn(`Invalid coordinates for ${record.ADDRESS_DETAIL_PID}: ${latitude}, ${longitude}`);
          return null; // Skip records with invalid coordinates
        }
      } else {
        // Skip records without coordinates (database requires them)
        if (Math.random() < 0.001) { // Log 0.1% of missing geocode cases to avoid spam
          logger.warn(`No geocoding data for ${record.ADDRESS_DETAIL_PID}`);
        }
        return null;
      }

      // Build formatted address
      const addressParts = [];
      
      if (record.FLAT_TYPE_CODE && record.FLAT_NUMBER) {
        addressParts.push(`${record.FLAT_TYPE_CODE} ${record.FLAT_NUMBER}`);
      }
      
      if (record.BUILDING_NAME) {
        addressParts.push(record.BUILDING_NAME);
      }
      
      if (record.NUMBER_FIRST) {
        addressParts.push(record.NUMBER_FIRST);
      }
      
      if (record.STREET_NAME) {
        let street = record.STREET_NAME;
        if (record.STREET_TYPE_CODE) street += ` ${record.STREET_TYPE_CODE}`;
        addressParts.push(street);
      }
      
      if (record.LOCALITY_NAME) {
        let locality = record.LOCALITY_NAME;
        if (record.STATE_ABBREVIATION) locality += ` ${record.STATE_ABBREVIATION}`;
        if (record.POSTCODE) locality += ` ${record.POSTCODE}`;
        addressParts.push(locality);
      }

      const formattedAddress = addressParts.join(', ');
      const addressLine = addressParts.slice(0, -1).join(', '); // Without locality/state/postcode

      // Calculate quality scores
      let confidence = 100;
      let completeness = 0;
      const totalComponents = 10;
      let presentComponents = 0;

      if (record.STREET_NAME) presentComponents++; else confidence -= 20;
      if (record.NUMBER_FIRST) presentComponents++; else confidence -= 15;
      if (record.POSTCODE) presentComponents++; else confidence -= 10;
      if (record.STREET_TYPE_CODE) presentComponents++;
      if (record.BUILDING_NAME) presentComponents++;
      if (record.FLAT_NUMBER) presentComponents++;
      if (record.LOT_NUMBER) presentComponents++;
      if (record.LEGAL_PARCEL_ID) presentComponents++;
      if (record.GEOCODE_TYPE) presentComponents++;
      if (record.RELIABILITY) presentComponents++;

      completeness = Math.round((presentComponents / totalComponents) * 100);
      confidence = Math.max(0, confidence);

      return [
        record.ADDRESS_DETAIL_PID,              // address_detail_pid
        record.GNAF_PID || record.ADDRESS_DETAIL_PID,  // gnaf_pid
        record.BUILDING_NAME || null,           // building_name
        record.LOT_NUMBER || null,              // lot_number
        record.FLAT_TYPE_CODE || null,          // flat_type
        record.FLAT_NUMBER || null,             // flat_number
        record.NUMBER_FIRST || null,            // number_first
        record.NUMBER_LAST || null,             // number_last
        record.STREET_LOCALITY_PID || null,     // street_locality_pid
        record.LOCALITY_PID,                    // locality_pid
        addressLine,                            // address_line
        formattedAddress,                       // formatted_address
        latitude,                               // latitude
        longitude,                              // longitude
        this.mapCoordinatePrecision(geocodeType), // coordinate_precision
        parseInt(record.RELIABILITY) || 2,      // coordinate_reliability
        'GDA2020',                              // coordinate_crs
        confidence,                             // confidence_score
        completeness,                           // completeness_score
        'PENDING',                              // validation_status
        record.LGA_CODE || null,                // lga_code
        record.LGA_NAME || null,                // lga_name
        record.LEGAL_PARCEL_ID || null,         // legal_parcel_id
        'CURRENT',     // address_status (not in ADDRESS_DETAIL file)
        record.DATE_CREATED || new Date().toISOString().split('T')[0], // gnaf_date_created
        record.DATE_LAST_MODIFIED || null,      // gnaf_date_last_modified
        record.DATE_RETIRED || null,            // gnaf_date_retired
        this.importId                           // import_batch_id
      ];

    } catch (error) {
      logger.error('Error transforming address record:', error);
      return null;
    }
  }

  mapCoordinatePrecision(geocodeType) {
    if (!geocodeType) return 'LOCALITY';
    const type = geocodeType.toUpperCase();
    if (type.includes('PROPERTY')) return 'PROPERTY';
    if (type.includes('STREET')) return 'STREET';
    if (type.includes('LOCALITY')) return 'LOCALITY';
    return 'REGION';
  }

  mapStatePidToAbbreviation(statePid) {
    const stateMap = {
      '1': 'NSW',  // New South Wales
      '2': 'VIC',  // Victoria
      '3': 'QLD',  // Queensland
      '4': 'SA',   // South Australia
      '5': 'WA',   // Western Australia
      '6': 'TAS',  // Tasmania
      '7': 'NT',   // Northern Territory
      '8': 'ACT'   // Australian Capital Territory
    };
    return stateMap[String(statePid)] || 'NSW'; // Default to NSW if not found
  }

  validateLocalityRecord(record) {
    return record.LOCALITY_PID && record.LOCALITY_NAME && record.STATE_PID;
  }

  validateStreetRecord(record) {
    return record.STREET_LOCALITY_PID && record.STREET_NAME && record.LOCALITY_PID;
  }

  async findCsvFiles(pattern1, pattern2) {
    try {
      // Search recursively in G-NAF directory structure
      const gnafDir = path.join(this.dataPath, 'G-NAF');
      const files = await this.findFilesRecursively(gnafDir, pattern1, pattern2);
      
      if (files.length === 0) {
        logger.warn(`No files found matching patterns: ${pattern1}, ${pattern2}`);
        return [];
      }
      
      logger.info(`Found ${files.length} files for ${pattern1}: ${files.map(f => path.basename(f)).join(', ')}`);
      return files;
    } catch (error) {
      logger.error(`Error finding files for ${pattern1}:`, error);
      return [];
    }
  }

  async findSpecificCsvFiles(pattern, excludePatterns = []) {
    try {
      // Search recursively in G-NAF directory structure
      const gnafDir = path.join(this.dataPath, 'G-NAF');
      const allFiles = await this.findFilesRecursivelySpecific(gnafDir, pattern, excludePatterns);
      
      if (allFiles.length === 0) {
        logger.warn(`No files found matching pattern: ${pattern}`);
        return [];
      }
      
      logger.info(`Found ${allFiles.length} files for ${pattern}: ${allFiles.map(f => path.basename(f)).join(', ')}`);
      return allFiles;
    } catch (error) {
      logger.error(`Error finding files for ${pattern}:`, error);
      return [];
    }
  }

  async findFilesRecursively(dir, pattern1, pattern2) {
    let results = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          const subResults = await this.findFilesRecursively(fullPath, pattern1, pattern2);
          results = results.concat(subResults);
        } else if (entry.isFile()) {
          const fileName = entry.name.toLowerCase();
          if ((fileName.includes(pattern1.toLowerCase()) || fileName.includes(pattern2.toLowerCase())) &&
              (fileName.endsWith('.csv') || fileName.endsWith('.psv'))) {
            
            // Apply exclusions only for non-geocode patterns
            if (pattern1.toLowerCase().includes('geocode') || pattern2.toLowerCase().includes('geocode')) {
              // For geocode files, be more permissive
              results.push(fullPath);
            } else {
              // For other files, apply standard exclusions
              if (!fileName.includes('alias') && !fileName.includes('neighbour') && 
                  !fileName.includes('point') && !fileName.includes('authority_code') &&
                  !fileName.includes('geocode') && !fileName.includes('mesh_block') && 
                  !fileName.includes('site') && !fileName.includes('feature') &&
                  !fileName.includes('aut_psv')) {
                results.push(fullPath);
              }
            }
          }
        }
      }
    } catch (error) {
      logger.debug(`Error reading directory ${dir}: ${error.message}`);
    }
    
    return results;
  }

  async findFilesRecursivelySpecific(dir, pattern, excludePatterns = []) {
    let results = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          const subResults = await this.findFilesRecursivelySpecific(fullPath, pattern, excludePatterns);
          results = results.concat(subResults);
        } else if (entry.isFile()) {
          const fileName = entry.name.toLowerCase();
          
          // Check if file matches the pattern and ends with csv/psv
          if (fileName.includes(pattern.toLowerCase()) && 
              (fileName.endsWith('.csv') || fileName.endsWith('.psv'))) {
            
            // Check if any exclude patterns match
            const shouldExclude = excludePatterns.some(excludePattern => 
              fileName.includes(excludePattern.toLowerCase())
            );
            
            // Standard exclusions
            const standardExclusions = [
              'alias', 'neighbour', 'point', 'authority_code', 'geocode', 
              'mesh_block', 'site', 'feature', 'aut_psv'
            ];
            const hasStandardExclusion = standardExclusions.some(exclusion => 
              fileName.includes(exclusion)
            );
            
            if (!shouldExclude && !hasStandardExclusion) {
              results.push(fullPath);
            }
          }
        }
      }
    } catch (error) {
      logger.debug(`Error reading directory ${dir}: ${error.message}`);
    }
    
    return results;
  }


  logProgress(type, processed, inserted) {
    const { totalRecords, processedRecords, avgProcessingTime } = this.stats;
    const progressPercent = totalRecords > 0 ? ((processedRecords / totalRecords) * 100).toFixed(1) : '0.0';
    const recordsPerSecond = avgProcessingTime > 0 ? Math.round(this.batchSize / (avgProcessingTime / 1000)) : 0;
    
    let eta = 'Unknown';
    if (totalRecords > 0 && recordsPerSecond > 0) {
      const remainingRecords = totalRecords - processedRecords;
      const etaSeconds = Math.round(remainingRecords / recordsPerSecond);
      eta = this.formatDuration(etaSeconds * 1000);
    }

    logger.info(`${type.toUpperCase()} Progress: ${progressPercent}% (${processed.toLocaleString()}/${totalRecords.toLocaleString()}) | Inserted: ${inserted.toLocaleString()} | Speed: ${recordsPerSecond}/sec | ETA: ${eta}`);
  }

  updateProcessingTime(duration) {
    if (this.stats.avgProcessingTime === 0) {
      this.stats.avgProcessingTime = duration;
    } else {
      // Exponential moving average
      this.stats.avgProcessingTime = (this.stats.avgProcessingTime * 0.8) + (duration * 0.2);
    }
  }

  async createIndexes() {
    logger.info('Creating additional indexes...');
    
    // These are beyond the indexes created in the schema
    const additionalIndexes = [
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_addresses_import_batch ON gnaf.addresses (import_batch_id)',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_addresses_quality ON gnaf.addresses (confidence_score, completeness_score) WHERE address_status = \'CURRENT\'',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_addresses_date_created ON gnaf.addresses (gnaf_date_created)',
    ];

    for (const indexQuery of additionalIndexes) {
      try {
        await this.db.query(indexQuery);
        logger.debug(`Index created: ${indexQuery.split(' ')[5]}`);
      } catch (error) {
        logger.warn(`Index creation failed: ${error.message}`);
      }
    }
  }

  async generateStatistics() {
    logger.info('Generating import statistics...');
    
    try {
      await this.db.query('REFRESH MATERIALIZED VIEW gnaf.address_statistics');
      logger.info('Address statistics materialized view refreshed');
    } catch (error) {
      logger.error('Failed to refresh statistics:', error.message);
    }
  }

  async optimizeDatabase() {
    logger.info('Optimizing database performance...');
    await this.db.optimize();
  }

  async logImportSummary() {
    const duration = this.stats.endTime - this.stats.startTime;
    const summary = {
      importId: this.importId,
      duration: this.formatDuration(duration),
      totalRecords: this.stats.totalRecords,
      processedRecords: this.stats.processedRecords,
      validRecords: this.stats.validRecords,
      invalidRecords: this.stats.invalidRecords,
      insertedRecords: this.stats.insertedRecords,
      failedRecords: this.stats.failedRecords,
      successRate: this.stats.processedRecords > 0 ? 
        ((this.stats.insertedRecords / this.stats.processedRecords) * 100).toFixed(2) + '%' : '0%',
      avgProcessingTime: Math.round(this.stats.avgProcessingTime) + 'ms',
      recordsPerSecond: duration > 0 ? Math.round((this.stats.processedRecords / duration) * 1000) : 0
    };

    logger.info('=== IMPORT SUMMARY ===');
    Object.entries(summary).forEach(([key, value]) => {
      logger.info(`${key}: ${value}`);
    });
    
    // Save summary to file
    const summaryPath = path.join(__dirname, '../logs', `import-summary-${this.importId}.json`);
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    
    logger.info(`Import summary saved to: ${summaryPath}`);
  }

  async cleanup() {
    logger.info('Cleaning up failed import...');
    
    try {
      // Remove records from this import batch
      await this.db.query('DELETE FROM gnaf.addresses WHERE import_batch_id = $1', [this.importId]);
      logger.info('Cleanup completed');
    } catch (error) {
      logger.error('Cleanup failed:', error.message);
    }
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

async function main() {
  const importer = new GNAFImporter();
  
  try {
    await importer.import();
    process.exit(0);
  } catch (error) {
    logger.error(`Import failed: ${error.message}`);
    process.exit(1);
  }
}

// Run import if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = GNAFImporter;