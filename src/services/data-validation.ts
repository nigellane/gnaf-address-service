/**
 * Data Quality and Validation Service for G-NAF Address Data
 * Handles integrity checks, completeness validation, and quality reporting
 */

import winston from 'winston';
import { GNAFAddress, StateCode, CoordinatePrecision, ValidationStatus, ValidationIssue, ValidationIssueType, IssueSeverity } from '../types/address';
import { getDatabase } from '../config/database';

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

export interface ValidationReport {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  warningRecords: number;
  issuesSummary: { [key: string]: number };
  completenessMetrics: CompletenessMetrics;
  coordinateValidation: CoordinateValidation;
  qualityScore: number;
  recommendations: string[];
}

export interface CompletenessMetrics {
  streetNamePresent: number;
  houseNumberPresent: number;
  postcodePresent: number;
  buildingNamePresent: number;
  averageCompleteness: number;
  highQualityAddresses: number; // >80% completeness
}

export interface CoordinateValidation {
  totalCoordinates: number;
  validCoordinates: number;
  outOfBoundsCount: number;
  precisionDistribution: { [key in CoordinatePrecision]: number };
  averagePrecisionScore: number;
}

export class DataValidationService {
  private db = getDatabase();
  private validationRules: ValidationRule[];
  
  constructor() {
    this.validationRules = this.initializeValidationRules();
  }

  /**
   * Validate a single G-NAF address record
   */
  validateAddress(address: GNAFAddress): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const rule of this.validationRules) {
      try {
        const ruleIssues = rule.validate(address);
        issues.push(...ruleIssues);
      } catch (error) {
        logger.error(`Validation rule error: ${rule.name}`, error);
      }
    }

    return issues;
  }

  /**
   * Batch validate multiple addresses
   */
  async validateBatch(addresses: GNAFAddress[]): Promise<{ address: GNAFAddress; issues: ValidationIssue[] }[]> {
    const results: { address: GNAFAddress; issues: ValidationIssue[] }[] = [];

    for (const address of addresses) {
      const issues = this.validateAddress(address);
      results.push({ address, issues });
    }

    return results;
  }

  /**
   * Run comprehensive data integrity checks on imported data
   */
  async runIntegrityChecks(importBatchId?: string): Promise<ValidationReport> {
    logger.info('Starting comprehensive data integrity checks...');

    const whereClause = importBatchId ? 'WHERE import_batch_id = $1' : '';
    const params = importBatchId ? [importBatchId] : [];

    // Get basic statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE validation_status = 'VALID') as valid_records,
        COUNT(*) FILTER (WHERE validation_status = 'INVALID') as invalid_records,
        COUNT(*) FILTER (WHERE validation_status = 'PARTIAL') as warning_records,
        AVG(confidence_score) as avg_confidence,
        AVG(completeness_score) as avg_completeness
      FROM gnaf.addresses ${whereClause}
    `;

    const statsResult = await this.db.query(statsQuery, params);
    const stats = statsResult.rows[0];

    // Run detailed validations
    const completenessMetrics = await this.analyzeCompleteness(importBatchId);
    const coordinateValidation = await this.analyzeCoordinates(importBatchId);
    const issuesSummary = await this.analyzeIssues(importBatchId);

    // Calculate overall quality score
    const qualityScore = this.calculateOverallQuality(
      parseFloat(stats.avg_confidence),
      parseFloat(stats.avg_completeness),
      completenessMetrics,
      coordinateValidation
    );

    const report: ValidationReport = {
      totalRecords: parseInt(stats.total_records),
      validRecords: parseInt(stats.valid_records),
      invalidRecords: parseInt(stats.invalid_records),
      warningRecords: parseInt(stats.warning_records),
      issuesSummary,
      completenessMetrics,
      coordinateValidation,
      qualityScore,
      recommendations: this.generateRecommendations(completenessMetrics, coordinateValidation, qualityScore)
    };

    logger.info(`Integrity check completed. Quality score: ${qualityScore.toFixed(1)}%`);
    return report;
  }

  /**
   * Analyze address completeness metrics
   */
  private async analyzeCompleteness(importBatchId?: string): Promise<CompletenessMetrics> {
    const whereClause = importBatchId ? 'WHERE import_batch_id = $1' : '';
    const params = importBatchId ? [importBatchId] : [];

    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(s.street_name) as street_name_present,
        COUNT(a.number_first) as house_number_present,
        COUNT(l.postcode) as postcode_present,
        COUNT(a.building_name) as building_name_present,
        AVG(a.completeness_score) as avg_completeness,
        COUNT(*) FILTER (WHERE a.completeness_score >= 80) as high_quality_addresses
      FROM gnaf.addresses a
      LEFT JOIN gnaf.localities l ON a.locality_pid = l.locality_pid
      LEFT JOIN gnaf.streets s ON a.street_locality_pid = s.street_locality_pid
      ${whereClause}
    `;

    const result = await this.db.query(query, params);
    const row = result.rows[0];

    return {
      streetNamePresent: (parseInt(row.street_name_present) / parseInt(row.total)) * 100,
      houseNumberPresent: (parseInt(row.house_number_present) / parseInt(row.total)) * 100,
      postcodePresent: (parseInt(row.postcode_present) / parseInt(row.total)) * 100,
      buildingNamePresent: (parseInt(row.building_name_present) / parseInt(row.total)) * 100,
      averageCompleteness: parseFloat(row.avg_completeness) || 0,
      highQualityAddresses: parseInt(row.high_quality_addresses)
    };
  }

  /**
   * Analyze coordinate quality and precision
   */
  private async analyzeCoordinates(importBatchId?: string): Promise<CoordinateValidation> {
    const whereClause = importBatchId ? 'WHERE import_batch_id = $1' : '';
    const params = importBatchId ? [importBatchId] : [];

    // Basic coordinate statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_coordinates,
        COUNT(*) FILTER (WHERE 
          latitude BETWEEN -45.0 AND -10.0 AND 
          longitude BETWEEN 110.0 AND 155.0
        ) as valid_coordinates,
        COUNT(*) FILTER (WHERE 
          latitude < -45.0 OR latitude > -10.0 OR 
          longitude < 110.0 OR longitude > 155.0
        ) as out_of_bounds_count
      FROM gnaf.addresses ${whereClause}
    `;

    const statsResult = await this.db.query(statsQuery, params);
    const stats = statsResult.rows[0];

    // Precision distribution
    const precisionQuery = `
      SELECT 
        coordinate_precision,
        COUNT(*) as count
      FROM gnaf.addresses 
      ${whereClause}
      GROUP BY coordinate_precision
    `;

    const precisionResult = await this.db.query(precisionQuery, params);
    const precisionDistribution: { [key in CoordinatePrecision]: number } = {
      [CoordinatePrecision.PROPERTY]: 0,
      [CoordinatePrecision.STREET]: 0,
      [CoordinatePrecision.LOCALITY]: 0,
      [CoordinatePrecision.REGION]: 0
    };

    precisionResult.rows.forEach(row => {
      precisionDistribution[row.coordinate_precision as CoordinatePrecision] = parseInt(row.count);
    });

    // Calculate average precision score (Property=4, Street=3, Locality=2, Region=1)
    const precisionScores = {
      [CoordinatePrecision.PROPERTY]: 4,
      [CoordinatePrecision.STREET]: 3,
      [CoordinatePrecision.LOCALITY]: 2,
      [CoordinatePrecision.REGION]: 1
    };

    let totalWeightedScore = 0;
    let totalRecords = 0;

    Object.entries(precisionDistribution).forEach(([precision, count]) => {
      totalWeightedScore += precisionScores[precision as CoordinatePrecision] * count;
      totalRecords += count;
    });

    const averagePrecisionScore = totalRecords > 0 ? (totalWeightedScore / totalRecords) / 4 * 100 : 0;

    return {
      totalCoordinates: parseInt(stats.total_coordinates),
      validCoordinates: parseInt(stats.valid_coordinates),
      outOfBoundsCount: parseInt(stats.out_of_bounds_count),
      precisionDistribution,
      averagePrecisionScore
    };
  }

  /**
   * Analyze validation issues summary
   */
  private async analyzeIssues(importBatchId?: string): Promise<{ [key: string]: number }> {
    // For now, return a mock analysis since we don't store detailed issues yet
    // In a full implementation, this would query a validation_issues table
    
    const whereClause = importBatchId ? 'WHERE import_batch_id = $1' : '';
    const params = importBatchId ? [importBatchId] : [];

    const query = `
      SELECT 
        COUNT(*) FILTER (WHERE 
          NOT EXISTS (
            SELECT 1 FROM gnaf.streets s WHERE s.street_locality_pid = addresses.street_locality_pid
          )
        ) as missing_street,
        COUNT(*) FILTER (WHERE number_first IS NULL) as missing_house_number,
        COUNT(*) FILTER (WHERE building_name IS NULL AND flat_number IS NULL AND number_first IS NULL) as insufficient_addressing,
        COUNT(*) FILTER (WHERE 
          latitude < -45.0 OR latitude > -10.0 OR 
          longitude < 110.0 OR longitude > 155.0
        ) as invalid_coordinates,
        COUNT(*) FILTER (WHERE confidence_score < 50) as low_confidence
      FROM gnaf.addresses ${whereClause}
    `;

    const result = await this.db.query(query, params);
    const issues = result.rows[0];

    return {
      'Missing Street Reference': parseInt(issues.missing_street),
      'Missing House Number': parseInt(issues.missing_house_number),
      'Insufficient Addressing': parseInt(issues.insufficient_addressing),
      'Invalid Coordinates': parseInt(issues.invalid_coordinates),
      'Low Confidence Score': parseInt(issues.low_confidence)
    };
  }

  /**
   * Calculate overall data quality score
   */
  private calculateOverallQuality(
    avgConfidence: number,
    avgCompleteness: number,
    completeness: CompletenessMetrics,
    coordinates: CoordinateValidation
  ): number {
    // Weighted quality score calculation
    const confidenceWeight = 0.3;
    const completenessWeight = 0.3;
    const coordinateValidityWeight = 0.2;
    const precisionWeight = 0.2;

    const confidenceScore = avgConfidence || 0;
    const completenessScore = avgCompleteness || 0;
    const coordinateValidityScore = coordinates.totalCoordinates > 0 ? 
      (coordinates.validCoordinates / coordinates.totalCoordinates) * 100 : 0;
    const precisionScore = coordinates.averagePrecisionScore;

    const overallScore = (
      (confidenceScore * confidenceWeight) +
      (completenessScore * completenessWeight) +
      (coordinateValidityScore * coordinateValidityWeight) +
      (precisionScore * precisionWeight)
    );

    return Math.round(overallScore * 100) / 100;
  }

  /**
   * Generate quality improvement recommendations
   */
  private generateRecommendations(
    completeness: CompletenessMetrics,
    coordinates: CoordinateValidation,
    qualityScore: number
  ): string[] {
    const recommendations: string[] = [];

    if (qualityScore < 70) {
      recommendations.push('Overall data quality is below acceptable threshold (70%). Consider data cleansing.');
    }

    if (completeness.streetNamePresent < 95) {
      recommendations.push(`${(100 - completeness.streetNamePresent).toFixed(1)}% of addresses missing street names. Review source data quality.`);
    }

    if (completeness.houseNumberPresent < 80) {
      recommendations.push(`${(100 - completeness.houseNumberPresent).toFixed(1)}% of addresses missing house numbers. This affects addressability.`);
    }

    if (completeness.postcodePresent < 98) {
      recommendations.push(`${(100 - completeness.postcodePresent).toFixed(1)}% of addresses missing postcodes. Essential for delivery addressing.`);
    }

    if (coordinates.outOfBoundsCount > 0) {
      recommendations.push(`${coordinates.outOfBoundsCount} addresses have coordinates outside Australian boundaries. Review coordinate data.`);
    }

    if (coordinates.averagePrecisionScore < 60) {
      recommendations.push(`Average coordinate precision is ${coordinates.averagePrecisionScore.toFixed(1)}%. Consider improving geocoding accuracy.`);
    }

    if (completeness.highQualityAddresses / (completeness.highQualityAddresses + 1) * 100 < 70) {
      recommendations.push('Less than 70% of addresses meet high quality standards. Implement data enrichment processes.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Data quality meets acceptable standards. Continue monitoring for quality degradation.');
    }

    return recommendations;
  }

  /**
   * Generate detailed quality report
   */
  async generateQualityReport(importBatchId?: string): Promise<string> {
    const report = await this.runIntegrityChecks(importBatchId);

    let reportText = '=== G-NAF DATA QUALITY REPORT ===\n\n';
    
    reportText += `Overall Quality Score: ${report.qualityScore.toFixed(1)}%\n\n`;

    reportText += '--- RECORD SUMMARY ---\n';
    reportText += `Total Records: ${report.totalRecords.toLocaleString()}\n`;
    reportText += `Valid Records: ${report.validRecords.toLocaleString()} (${(report.validRecords/report.totalRecords*100).toFixed(1)}%)\n`;
    reportText += `Invalid Records: ${report.invalidRecords.toLocaleString()} (${(report.invalidRecords/report.totalRecords*100).toFixed(1)}%)\n`;
    reportText += `Warning Records: ${report.warningRecords.toLocaleString()} (${(report.warningRecords/report.totalRecords*100).toFixed(1)}%)\n\n`;

    reportText += '--- COMPLETENESS METRICS ---\n';
    reportText += `Street Names Present: ${report.completenessMetrics.streetNamePresent.toFixed(1)}%\n`;
    reportText += `House Numbers Present: ${report.completenessMetrics.houseNumberPresent.toFixed(1)}%\n`;
    reportText += `Postcodes Present: ${report.completenessMetrics.postcodePresent.toFixed(1)}%\n`;
    reportText += `Building Names Present: ${report.completenessMetrics.buildingNamePresent.toFixed(1)}%\n`;
    reportText += `Average Completeness: ${report.completenessMetrics.averageCompleteness.toFixed(1)}%\n`;
    reportText += `High Quality Addresses: ${report.completenessMetrics.highQualityAddresses.toLocaleString()}\n\n`;

    reportText += '--- COORDINATE VALIDATION ---\n';
    reportText += `Total Coordinates: ${report.coordinateValidation.totalCoordinates.toLocaleString()}\n`;
    reportText += `Valid Coordinates: ${report.coordinateValidation.validCoordinates.toLocaleString()}\n`;
    reportText += `Out of Bounds: ${report.coordinateValidation.outOfBoundsCount.toLocaleString()}\n`;
    reportText += `Average Precision Score: ${report.coordinateValidation.averagePrecisionScore.toFixed(1)}%\n\n`;

    reportText += '--- PRECISION DISTRIBUTION ---\n';
    Object.entries(report.coordinateValidation.precisionDistribution).forEach(([precision, count]) => {
      const percentage = report.coordinateValidation.totalCoordinates > 0 ? 
        (count / report.coordinateValidation.totalCoordinates * 100).toFixed(1) : '0.0';
      reportText += `${precision}: ${count.toLocaleString()} (${percentage}%)\n`;
    });

    reportText += '\n--- IDENTIFIED ISSUES ---\n';
    Object.entries(report.issuesSummary).forEach(([issue, count]) => {
      if (count > 0) {
        reportText += `${issue}: ${count.toLocaleString()}\n`;
      }
    });

    reportText += '\n--- RECOMMENDATIONS ---\n';
    report.recommendations.forEach((rec, index) => {
      reportText += `${index + 1}. ${rec}\n`;
    });

    return reportText;
  }

  /**
   * Initialize validation rules
   */
  private initializeValidationRules(): ValidationRule[] {
    return [
      new RequiredFieldsRule(),
      new CoordinateBoundsRule(),
      new PostcodeValidationRule(),
      new AddressFormatRule(),
      new DuplicateCheckRule()
    ];
  }
}

// Validation Rule Interface and Implementations
abstract class ValidationRule {
  abstract name: string;
  abstract validate(address: GNAFAddress): ValidationIssue[];
}

class RequiredFieldsRule extends ValidationRule {
  name = 'Required Fields';

  validate(address: GNAFAddress): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!address.components.locality.name) {
      issues.push({
        type: ValidationIssueType.MISSING_COMPONENT,
        message: 'Locality name is required',
        severity: IssueSeverity.ERROR,
        component: 'locality'
      });
    }

    if (!address.components.street.name && !address.components.buildingName) {
      issues.push({
        type: ValidationIssueType.MISSING_COMPONENT,
        message: 'Street name or building name is required for addressing',
        severity: IssueSeverity.ERROR,
        component: 'street'
      });
    }

    return issues;
  }
}

class CoordinateBoundsRule extends ValidationRule {
  name = 'Coordinate Bounds';

  validate(address: GNAFAddress): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const { latitude, longitude } = address.coordinates;

    // Australian coordinate bounds
    if (latitude < -45.0 || latitude > -10.0 || longitude < 110.0 || longitude > 155.0) {
      issues.push({
        type: ValidationIssueType.INVALID_FORMAT,
        message: `Coordinates (${latitude}, ${longitude}) are outside Australian boundaries`,
        severity: IssueSeverity.ERROR
      });
    }

    return issues;
  }
}

class PostcodeValidationRule extends ValidationRule {
  name = 'Postcode Validation';

  validate(address: GNAFAddress): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!address.components.postcode) {
      issues.push({
        type: ValidationIssueType.MISSING_COMPONENT,
        message: 'Postcode is missing',
        severity: IssueSeverity.WARNING,
        component: 'postcode'
      });
      return issues;
    }

    const postcode = parseInt(address.components.postcode);
    if (isNaN(postcode) || postcode < 100 || postcode > 9999) {
      issues.push({
        type: ValidationIssueType.INVALID_FORMAT,
        message: 'Invalid postcode format',
        severity: IssueSeverity.ERROR,
        component: 'postcode'
      });
    }

    return issues;
  }
}

class AddressFormatRule extends ValidationRule {
  name = 'Address Format';

  validate(address: GNAFAddress): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (address.address.length < 10) {
      issues.push({
        type: ValidationIssueType.INVALID_FORMAT,
        message: 'Address appears to be too short or incomplete',
        severity: IssueSeverity.WARNING
      });
    }

    if (address.address.length > 500) {
      issues.push({
        type: ValidationIssueType.INVALID_FORMAT,
        message: 'Address exceeds maximum length',
        severity: IssueSeverity.WARNING
      });
    }

    return issues;
  }
}

class DuplicateCheckRule extends ValidationRule {
  name = 'Duplicate Check';

  validate(address: GNAFAddress): ValidationIssue[] {
    // This would require database access for duplicate checking
    // For now, return empty array - would be implemented with actual duplicate detection
    return [];
  }
}

export default DataValidationService;