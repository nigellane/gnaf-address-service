import { getDatabase } from '../config/database';
import { AddressValidationRequest, AddressValidationResponse, AddressSearchParams, AddressSearchResponse } from '../types/api';
import Logger from '../utils/logger';

const logger = Logger.createServiceLogger('AddressService');

// Constants for better maintainability
const CONFIDENCE_THRESHOLDS = {
  VALID_MATCH: 80,
  HIGH_CONFIDENCE: 90,
  MIN_SUGGESTION: 70
} as const;

const QUERY_LIMITS = {
  DEFAULT: 10,
  MAXIMUM: 50,
  SUGGESTION_DEFAULT: 5,
  MIN_WORD_LENGTH: 2
} as const;

export class AddressService {
  private db = getDatabase();

  async searchAddresses(params: AddressSearchParams): Promise<AddressSearchResponse> {
    const startTime = Date.now();
    const { q, limit = QUERY_LIMITS.DEFAULT, state, postcode, includeCoordinates = false } = params;
    
    try {
      const queryLimit = Math.min(limit, QUERY_LIMITS.MAXIMUM);
      const searchVector = this.prepareSearchQuery(q);
      
      let baseQuery = `
        SELECT 
          gnaf_pid,
          formatted_address,
          confidence_score,
          ${includeCoordinates ? 'latitude, longitude, coordinate_precision,' : ''}
          ts_rank(search_vector, to_tsquery('english', $1)) as relevance_score
        FROM gnaf.addresses 
        WHERE search_vector @@ to_tsquery('english', $1)
      `;
      
      const queryParams: any[] = [searchVector];
      let paramIndex = 2;
      
      if (state) {
        baseQuery += ` AND state_abbreviation = $${paramIndex}`;
        queryParams.push(state.toUpperCase());
        paramIndex++;
      }
      
      if (postcode) {
        baseQuery += ` AND postcode = $${paramIndex}`;
        queryParams.push(postcode);
        paramIndex++;
      }
      
      baseQuery += ` 
        ORDER BY relevance_score DESC, confidence_score DESC 
        LIMIT $${paramIndex}
      `;
      queryParams.push(queryLimit);
      
      const result = await this.db.query(baseQuery, queryParams);
      const duration = Date.now() - startTime;
      
      logger.info('Address search completed', {
        query: q,
        resultsCount: result.rows.length,
        duration,
        state,
        postcode
      });
      
      const results = result.rows.map((row: any) => ({
        gnafPid: row.gnaf_pid,
        formattedAddress: row.formatted_address,
        confidence: row.confidence_score,
        ...(includeCoordinates && {
          coordinates: {
            latitude: parseFloat(row.latitude),
            longitude: parseFloat(row.longitude),
            precision: row.coordinate_precision
          }
        })
      }));
      
      return {
        results,
        total: result.rows.length,
        limit: queryLimit
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Address search failed', {
        query: q,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });
      throw error;
    }
  }

  async validateAddress(request: AddressValidationRequest): Promise<AddressValidationResponse> {
    const startTime = Date.now();
    const { address, strictMode = false, includeComponents = true, includeSuggestions = true } = request;
    
    try {
      const normalizedAddress = this.normalizeAddress(address);
      
      const exactMatch = await this.findExactMatch(normalizedAddress);
      if (exactMatch) {
        const duration = Date.now() - startTime;
        logger.info('Address validation - exact match found', {
          address: address.substring(0, 100),
          confidence: exactMatch.confidence_score,
          duration
        });
        
        return await this.buildValidationResponse(exactMatch, true, includeComponents, includeSuggestions);
      }
      
      if (strictMode) {
        return this.buildInvalidResponse(address, 'No exact match found in strict mode', includeSuggestions);
      }
      
      const fuzzyMatches = await this.findFuzzyMatches(normalizedAddress);
      if (fuzzyMatches.length > 0 && fuzzyMatches[0].confidence_score >= CONFIDENCE_THRESHOLDS.VALID_MATCH) {
        const bestMatch = fuzzyMatches[0];
        const duration = Date.now() - startTime;
        logger.info('Address validation - fuzzy match found', {
          address: address.substring(0, 100),
          confidence: bestMatch.confidence_score,
          duration
        });
        
        return await this.buildValidationResponse(bestMatch, false, includeComponents, includeSuggestions, fuzzyMatches.slice(1));
      }
      
      const suggestions = includeSuggestions ? await this.generateSuggestions(normalizedAddress) : [];
      const duration = Date.now() - startTime;
      logger.info('Address validation - no valid matches', {
        address: address.substring(0, 100),
        suggestionsCount: suggestions.length,
        duration
      });
      
      return this.buildInvalidResponse(address, 'No matches found with sufficient confidence', includeSuggestions, suggestions);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Address validation failed', {
        address: address.substring(0, 100),
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });
      throw error;
    }
  }

  private async findExactMatch(address: string): Promise<any | null> {
    const query = `
      SELECT 
        gnaf_pid, formatted_address, confidence_score,
        latitude, longitude, coordinate_precision, coordinate_reliability,
        street_number, street_name, street_type, 
        locality_name, state_abbreviation, postcode
      FROM gnaf.addresses 
      WHERE LOWER(formatted_address) = LOWER($1)
      ORDER BY confidence_score DESC
      LIMIT 1
    `;
    
    const result = await this.db.query(query, [address]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  private async findFuzzyMatches(address: string, limit = QUERY_LIMITS.SUGGESTION_DEFAULT): Promise<any[]> {
    const searchVector = this.prepareSearchQuery(address);
    
    const query = `
      SELECT 
        gnaf_pid, formatted_address, confidence_score,
        latitude, longitude, coordinate_precision, coordinate_reliability,
        street_number, street_name, street_type,
        locality_name, state_abbreviation, postcode,
        ts_rank(search_vector, to_tsquery('english', $1)) as relevance_score
      FROM gnaf.addresses 
      WHERE search_vector @@ to_tsquery('english', $1)
      ORDER BY 
        GREATEST(confidence_score * 0.6, ts_rank(search_vector, to_tsquery('english', $1)) * 40) DESC
      LIMIT $2
    `;
    
    const result = await this.db.query(query, [searchVector, limit]);
    return result.rows;
  }

  private async generateSuggestions(address: string, limit = QUERY_LIMITS.SUGGESTION_DEFAULT): Promise<any[]> {
    const words = address.toLowerCase().split(/\s+/).filter(word => word.length > QUERY_LIMITS.MIN_WORD_LENGTH);
    if (words.length === 0) return [];
    
    const searchTerms = words.join(' & ');
    
    const query = `
      SELECT 
        gnaf_pid, formatted_address, confidence_score,
        ts_rank(search_vector, to_tsquery('english', $1)) as relevance_score
      FROM gnaf.addresses 
      WHERE search_vector @@ to_tsquery('english', $1)
        AND confidence_score >= ${CONFIDENCE_THRESHOLDS.MIN_SUGGESTION}
      ORDER BY relevance_score DESC, confidence_score DESC
      LIMIT $2
    `;
    
    const result = await this.db.query(query, [searchTerms, limit]);
    return result.rows;
  }

  private async buildValidationResponse(
    match: any, 
    isExact: boolean, 
    includeComponents: boolean, 
    includeSuggestions: boolean,
    additionalSuggestions: any[] = []
  ): Promise<AddressValidationResponse> {
    const response: AddressValidationResponse = {
      isValid: match.confidence_score >= CONFIDENCE_THRESHOLDS.VALID_MATCH,
      confidence: match.confidence_score,
      standardizedAddress: match.formatted_address,
      suggestions: [],
      issues: []
    };
    
    if (includeComponents) {
      response.components = {
        streetNumber: match.street_number,
        streetName: match.street_name,
        streetType: match.street_type,
        suburb: match.locality_name,
        state: match.state_abbreviation,
        postcode: match.postcode,
        coordinates: {
          latitude: parseFloat(match.latitude),
          longitude: parseFloat(match.longitude),
          precision: match.coordinate_precision
        }
      };
    }
    
    if (includeSuggestions && additionalSuggestions.length > 0) {
      response.suggestions = additionalSuggestions.map(suggestion => ({
        address: suggestion.formatted_address,
        confidence: suggestion.confidence_score,
        gnafPid: suggestion.gnaf_pid
      }));
    }
    
    if (!isExact && match.confidence_score < CONFIDENCE_THRESHOLDS.HIGH_CONFIDENCE) {
      response.issues.push({
        type: 'AMBIGUOUS_MATCH',
        message: 'Address match has moderate confidence. Please verify the standardized address.',
        severity: 'WARNING'
      });
    }
    
    if (match.coordinate_reliability > 2) {
      response.issues.push({
        type: 'INVALID_FORMAT',
        message: 'Coordinate precision is lower than street level.',
        severity: 'INFO'
      });
    }
    
    return response;
  }

  private buildInvalidResponse(
    originalAddress: string, 
    reason: string, 
    includeSuggestions: boolean,
    suggestions: any[] = []
  ): AddressValidationResponse {
    const response: AddressValidationResponse = {
      isValid: false,
      confidence: 0,
      suggestions: [],
      issues: [{
        type: 'INVALID_FORMAT',
        message: reason,
        severity: 'ERROR'
      }]
    };
    
    if (includeSuggestions && suggestions.length > 0) {
      response.suggestions = suggestions.map(suggestion => ({
        address: suggestion.formatted_address,
        confidence: suggestion.confidence_score,
        gnafPid: suggestion.gnaf_pid
      }));
    }
    
    if (originalAddress.length < 10) {
      response.issues.push({
        type: 'MISSING_COMPONENT',
        message: 'Address appears to be incomplete. Please provide more details.',
        severity: 'WARNING'
      });
    }
    
    return response;
  }

  private prepareSearchQuery(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > QUERY_LIMITS.MIN_WORD_LENGTH)
      .join(' & ');
  }

  private normalizeAddress(address: string): string {
    return address
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/,+/g, ',')
      .replace(/\.$/, '');
  }
}