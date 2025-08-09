/**
 * G-NAF CSV Parser and Data Transformer
 * Processes G-NAF CSV files and transforms data for database import
 */

import { parse } from 'csv-parse';
import { Transform } from 'stream';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import winston from 'winston';
import path from 'path';
import fs from 'fs/promises';
import { GNAFAddress, StateCode, AddressLifecycleStatus, CoordinatePrecision, ReliabilityCode, ValidationStatus } from '../types/address';

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
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

// G-NAF CSV column mappings based on official G-NAF data structure
interface GNAFRawRecord {
  ADDRESS_DETAIL_PID: string;
  STREET_LOCALITY_PID?: string;
  LOCALITY_PID: string;
  BUILDING_NAME?: string;
  LOT_NUMBER_PREFIX?: string;
  LOT_NUMBER?: string;
  LOT_NUMBER_SUFFIX?: string;
  FLAT_TYPE?: string;
  FLAT_NUMBER_PREFIX?: string;
  FLAT_NUMBER?: string;
  FLAT_NUMBER_SUFFIX?: string;
  LEVEL_TYPE?: string;
  LEVEL_NUMBER_PREFIX?: string;
  LEVEL_NUMBER?: string;
  LEVEL_NUMBER_SUFFIX?: string;
  NUMBER_FIRST_PREFIX?: string;
  NUMBER_FIRST?: string;
  NUMBER_FIRST_SUFFIX?: string;
  NUMBER_LAST_PREFIX?: string;
  NUMBER_LAST?: string;
  NUMBER_LAST_SUFFIX?: string;
  STREET_NAME?: string;
  STREET_CLASS_CODE?: string;
  STREET_TYPE_CODE?: string;
  STREET_SUFFIX_CODE?: string;
  LOCALITY_NAME: string;
  STATE_ABBREVIATION: string;
  POSTCODE?: string;
  LATITUDE: string;
  LONGITUDE: string;
  GEOCODE_TYPE?: string;
  RELIABILITY?: string;
  ADDRESS_SITE_PID?: string;
  LEGAL_PARCEL_ID?: string;
  DATE_CREATED: string;
  DATE_LAST_MODIFIED?: string;
  DATE_RETIRED?: string;
  ADDRESS_STATUS?: string;
  GNAF_PID?: string;
}

interface LocalityRecord {
  LOCALITY_PID: string;
  LOCALITY_NAME: string;
  LOCALITY_CLASS_CODE: string;
  STATE_ABBREVIATION: string;
  POSTCODE?: string;
  LATITUDE?: string;
  LONGITUDE?: string;
}

interface StreetRecord {
  STREET_LOCALITY_PID: string;
  STREET_NAME: string;
  STREET_TYPE_CODE?: string;
  STREET_SUFFIX_CODE?: string;
  LOCALITY_PID: string;
}

export class GNAFParser {
  private dataPath: string;
  private batchSize: number;
  private validationRules: ValidationRules;

  constructor(dataPath?: string, batchSize = 10000) {
    this.dataPath = dataPath || process.env.GNAF_DATASET_PATH || path.join(__dirname, '../../data');
    this.batchSize = batchSize;
    this.validationRules = new ValidationRules();
  }

  /**
   * Parse addresses from G-NAF CSV files
   */
  async parseAddresses(csvFilePath: string): Promise<AsyncGenerator<GNAFAddress[], void, unknown>> {
    logger.info(`Starting address parsing from: ${csvFilePath}`);

    const parseOptions = {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: false
    };

    let batch: GNAFAddress[] = [];
    let recordCount = 0;
    let errorCount = 0;

    const parser = parse(parseOptions);
    const transformer = new Transform({
      objectMode: true,
      transform: (record: GNAFRawRecord, encoding, callback) => {
        try {
          const address = this.transformAddressRecord(record);
          if (address) {
            batch.push(address);
            recordCount++;

            if (batch.length >= this.batchSize) {
              const currentBatch = [...batch];
              batch = [];
              this.emit('batch', currentBatch);
            }
          }
        } catch (error) {
          errorCount++;
          logger.error(`Error parsing record ${recordCount + 1}:`, error);
          
          if (errorCount > 1000) {
            callback(new Error(`Too many parsing errors (${errorCount}). Stopping import.`));
            return;
          }
        }
        callback();
      },
      flush(callback) {
        if (batch.length > 0) {
          this.emit('batch', [...batch]);
        }
        logger.info(`Parsing completed. Records: ${recordCount}, Errors: ${errorCount}`);
        callback();
      }
    });

    const stream = createReadStream(csvFilePath)
      .pipe(parser)
      .pipe(transformer);

    return this.createAsyncGenerator(stream);
  }

  /**
   * Parse localities from G-NAF CSV files
   */
  async parseLocalities(csvFilePath: string): Promise<LocalityRecord[]> {
    logger.info(`Parsing localities from: ${csvFilePath}`);

    const localities: LocalityRecord[] = [];
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    await pipeline(
      createReadStream(csvFilePath),
      parser,
      new Transform({
        objectMode: true,
        transform(record: LocalityRecord, encoding, callback) {
          if (record.LOCALITY_PID && record.LOCALITY_NAME) {
            localities.push(record);
          }
          callback();
        }
      })
    );

    logger.info(`Parsed ${localities.length} localities`);
    return localities;
  }

  /**
   * Parse streets from G-NAF CSV files
   */
  async parseStreets(csvFilePath: string): Promise<StreetRecord[]> {
    logger.info(`Parsing streets from: ${csvFilePath}`);

    const streets: StreetRecord[] = [];
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    await pipeline(
      createReadStream(csvFilePath),
      parser,
      new Transform({
        objectMode: true,
        transform(record: StreetRecord, encoding, callback) {
          if (record.STREET_LOCALITY_PID && record.STREET_NAME) {
            streets.push(record);
          }
          callback();
        }
      })
    );

    logger.info(`Parsed ${streets.length} streets`);
    return streets;
  }

  /**
   * Transform raw G-NAF record to GNAFAddress interface
   */
  private transformAddressRecord(record: GNAFRawRecord): GNAFAddress | null {
    try {
      // Validate required fields
      if (!record.ADDRESS_DETAIL_PID || !record.LOCALITY_PID || 
          !record.LOCALITY_NAME || !record.STATE_ABBREVIATION ||
          !record.LATITUDE || !record.LONGITUDE) {
        return null;
      }

      // Parse coordinates
      const latitude = parseFloat(record.LATITUDE);
      const longitude = parseFloat(record.LONGITUDE);

      if (isNaN(latitude) || isNaN(longitude)) {
        return null;
      }

      // Validate coordinate bounds for Australia
      if (!this.validationRules.validateCoordinates(latitude, longitude)) {
        return null;
      }

      // Build formatted address
      const formattedAddress = this.buildFormattedAddress(record);
      
      // Calculate confidence and completeness
      const quality = this.calculateAddressQuality(record);

      const address: GNAFAddress = {
        gnafPid: record.GNAF_PID || record.ADDRESS_DETAIL_PID,
        address: formattedAddress,
        
        components: {
          buildingName: record.BUILDING_NAME || undefined,
          lotNumber: this.combineLotNumber(record),
          flatType: record.FLAT_TYPE || undefined,
          flatNumber: this.combineFlatNumber(record),
          numberFirst: this.combineNumber(
            record.NUMBER_FIRST_PREFIX, 
            record.NUMBER_FIRST, 
            record.NUMBER_FIRST_SUFFIX
          ),
          numberLast: this.combineNumber(
            record.NUMBER_LAST_PREFIX,
            record.NUMBER_LAST,
            record.NUMBER_LAST_SUFFIX
          ),
          street: {
            name: record.STREET_NAME || '',
            type: record.STREET_TYPE_CODE as any || 'ST',
            suffix: record.STREET_SUFFIX_CODE as any || undefined
          },
          locality: {
            name: record.LOCALITY_NAME,
            class: this.mapLocalityClass(record.LOCALITY_NAME)
          },
          state: this.mapStateCode(record.STATE_ABBREVIATION),
          postcode: record.POSTCODE || ''
        },

        coordinates: {
          latitude,
          longitude,
          precision: this.mapCoordinatePrecision(record.GEOCODE_TYPE),
          crs: 'GDA2020'
        },

        quality,

        boundaries: {
          // These would be populated from additional G-NAF files
          lga: undefined,
          electoral: undefined,
          statistical: undefined
        },

        metadata: {
          dateCreated: record.DATE_CREATED,
          dateLastModified: record.DATE_LAST_MODIFIED || undefined,
          dateRetired: record.DATE_RETIRED || undefined,
          legalParcelId: record.LEGAL_PARCEL_ID || undefined,
          status: this.mapAddressStatus(record.ADDRESS_STATUS)
        }
      };

      return address;

    } catch (error) {
      logger.error('Error transforming address record:', error);
      return null;
    }
  }

  private buildFormattedAddress(record: GNAFRawRecord): string {
    const parts: string[] = [];

    // Unit/Flat
    if (record.FLAT_TYPE && record.FLAT_NUMBER) {
      const flatNumber = this.combineFlatNumber(record);
      parts.push(`${record.FLAT_TYPE} ${flatNumber}`);
    }

    // Building name
    if (record.BUILDING_NAME) {
      parts.push(record.BUILDING_NAME);
    }

    // Street number
    const streetNumber = record.NUMBER_FIRST ? 
      this.combineNumber(record.NUMBER_FIRST_PREFIX, record.NUMBER_FIRST, record.NUMBER_FIRST_SUFFIX) :
      undefined;

    if (streetNumber) {
      parts.push(streetNumber);
    }

    // Street name and type
    if (record.STREET_NAME) {
      let streetPart = record.STREET_NAME;
      if (record.STREET_TYPE_CODE) {
        streetPart += ` ${record.STREET_TYPE_CODE}`;
      }
      if (record.STREET_SUFFIX_CODE) {
        streetPart += ` ${record.STREET_SUFFIX_CODE}`;
      }
      parts.push(streetPart);
    }

    // Locality and postcode
    let localityPart = record.LOCALITY_NAME;
    if (record.STATE_ABBREVIATION) {
      localityPart += ` ${record.STATE_ABBREVIATION}`;
    }
    if (record.POSTCODE) {
      localityPart += ` ${record.POSTCODE}`;
    }
    parts.push(localityPart);

    return parts.join(', ');
  }

  private combineLotNumber(record: GNAFRawRecord): string | undefined {
    if (!record.LOT_NUMBER) return undefined;
    
    return [
      record.LOT_NUMBER_PREFIX,
      record.LOT_NUMBER,
      record.LOT_NUMBER_SUFFIX
    ].filter(Boolean).join('');
  }

  private combineFlatNumber(record: GNAFRawRecord): string | undefined {
    if (!record.FLAT_NUMBER) return undefined;
    
    return [
      record.FLAT_NUMBER_PREFIX,
      record.FLAT_NUMBER,
      record.FLAT_NUMBER_SUFFIX
    ].filter(Boolean).join('');
  }

  private combineNumber(prefix?: string, number?: string, suffix?: string): string | undefined {
    if (!number) return undefined;
    return [prefix, number, suffix].filter(Boolean).join('');
  }

  private calculateAddressQuality(record: GNAFRawRecord) {
    let confidence = 100;
    let completeness = 100;

    // Reduce confidence for missing components
    if (!record.STREET_NAME) confidence -= 20;
    if (!record.NUMBER_FIRST) confidence -= 15;
    if (!record.POSTCODE) confidence -= 10;
    if (!record.STREET_TYPE_CODE) confidence -= 5;

    // Calculate completeness
    const totalFields = 10;
    let presentFields = 0;

    if (record.STREET_NAME) presentFields++;
    if (record.NUMBER_FIRST) presentFields++;
    if (record.POSTCODE) presentFields++;
    if (record.STREET_TYPE_CODE) presentFields++;
    if (record.BUILDING_NAME) presentFields++;
    if (record.FLAT_NUMBER) presentFields++;
    if (record.LOT_NUMBER) presentFields++;
    if (record.LEGAL_PARCEL_ID) presentFields++;
    if (record.GEOCODE_TYPE) presentFields++;
    if (record.RELIABILITY) presentFields++;

    completeness = Math.round((presentFields / totalFields) * 100);

    return {
      confidence: Math.max(0, confidence),
      reliability: this.mapReliability(record.RELIABILITY),
      completeness,
      status: ValidationStatus.PENDING
    };
  }

  private mapStateCode(stateAbbr: string): StateCode {
    const stateMap: { [key: string]: StateCode } = {
      'NSW': StateCode.NSW,
      'VIC': StateCode.VIC,
      'QLD': StateCode.QLD,
      'SA': StateCode.SA,
      'WA': StateCode.WA,
      'TAS': StateCode.TAS,
      'NT': StateCode.NT,
      'ACT': StateCode.ACT
    };

    return stateMap[stateAbbr.toUpperCase()] || StateCode.NSW;
  }

  private mapLocalityClass(localityName: string): any {
    // Simple heuristic - would need proper G-NAF locality class data
    if (localityName.toLowerCase().includes('city')) return 'C';
    if (localityName.toLowerCase().includes('town')) return 'T';
    return 'S'; // Suburb default
  }

  private mapCoordinatePrecision(geocodeType?: string): CoordinatePrecision {
    if (!geocodeType) return CoordinatePrecision.LOCALITY;
    
    const type = geocodeType.toUpperCase();
    if (type.includes('PROPERTY') || type.includes('BUILDING')) return CoordinatePrecision.PROPERTY;
    if (type.includes('STREET')) return CoordinatePrecision.STREET;
    if (type.includes('LOCALITY')) return CoordinatePrecision.LOCALITY;
    
    return CoordinatePrecision.REGION;
  }

  private mapReliability(reliability?: string): ReliabilityCode {
    if (!reliability) return ReliabilityCode.MEDIUM;
    
    const rel = parseInt(reliability);
    if (rel === 1) return ReliabilityCode.HIGH;
    if (rel === 2) return ReliabilityCode.MEDIUM;
    if (rel === 3) return ReliabilityCode.LOW;
    
    return ReliabilityCode.MEDIUM;
  }

  private mapAddressStatus(status?: string): AddressLifecycleStatus {
    if (!status) return AddressLifecycleStatus.CURRENT;
    
    const statusUpper = status.toUpperCase();
    if (statusUpper.includes('RETIRED')) return AddressLifecycleStatus.RETIRED;
    if (statusUpper.includes('PROPOSED')) return AddressLifecycleStatus.PROPOSED;
    
    return AddressLifecycleStatus.CURRENT;
  }

  private emit(event: string, data: any) {
    // Event emission for batch processing
    process.nextTick(() => {
      if (event === 'batch') {
        // This would be handled by the import process
        logger.debug(`Batch ready with ${data.length} addresses`);
      }
    });
  }

  private async *createAsyncGenerator(stream: any): AsyncGenerator<GNAFAddress[], void, unknown> {
    const batches: GNAFAddress[][] = [];
    let finished = false;

    stream.on('batch', (batch: GNAFAddress[]) => {
      batches.push(batch);
    });

    stream.on('end', () => {
      finished = true;
    });

    stream.on('error', (error: Error) => {
      throw error;
    });

    while (!finished || batches.length > 0) {
      if (batches.length > 0) {
        yield batches.shift()!;
      } else {
        // Wait a bit for more batches
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }

  /**
   * Get available CSV files in the dataset directory
   */
  async getAvailableFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.dataPath);
      return files.filter(file => file.endsWith('.csv') || file.endsWith('.psv'));
    } catch (error) {
      logger.error(`Error reading dataset directory: ${error}`);
      return [];
    }
  }
}

/**
 * Validation rules for G-NAF data
 */
class ValidationRules {
  validateCoordinates(latitude: number, longitude: number): boolean {
    // Australian coordinate bounds
    return latitude >= -45.0 && latitude <= -10.0 &&
           longitude >= 110.0 && longitude <= 155.0;
  }

  validatePostcode(postcode: string, state: StateCode): boolean {
    const postcodeRanges: { [key in StateCode]: [number, number][] } = {
      [StateCode.NSW]: [[1000, 1999], [2000, 2599], [2619, 2899], [2921, 2999]],
      [StateCode.VIC]: [[3000, 3999], [8000, 8999]],
      [StateCode.QLD]: [[4000, 4999], [9000, 9999]],
      [StateCode.SA]: [[5000, 5799], [5800, 5999]],
      [StateCode.WA]: [[6000, 6797], [6800, 6999]],
      [StateCode.TAS]: [[7000, 7799], [7800, 7999]],
      [StateCode.NT]: [[800, 899], [900, 999]],
      [StateCode.ACT]: [[200, 299], [2600, 2618], [2900, 2920]]
    };

    const code = parseInt(postcode);
    if (isNaN(code)) return false;

    const ranges = postcodeRanges[state] || [];
    return ranges.some(([min, max]) => code >= min && code <= max);
  }

  validateAddressComponents(address: GNAFAddress): string[] {
    const issues: string[] = [];

    if (!address.components.street.name) {
      issues.push('Missing street name');
    }

    if (!address.components.locality.name) {
      issues.push('Missing locality name');
    }

    if (!address.components.postcode) {
      issues.push('Missing postcode');
    } else if (!this.validatePostcode(address.components.postcode, address.components.state)) {
      issues.push('Invalid postcode for state');
    }

    return issues;
  }
}

export default GNAFParser;