import { getDatabase } from '../config/database';
import { AddressValidationRequest, AddressValidationResponse, AddressSearchParams, AddressSearchResponse } from '../types/api';
import { cachingService } from './cachingService';
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
  private readonly CACHE_TTL = {
    SEARCH: 300,      // 5 minutes for search results
    VALIDATION: 3600, // 1 hour for validation results
    SUGGESTIONS: 600  // 10 minutes for suggestions
  };

  async searchAddresses(params: AddressSearchParams): Promise<AddressSearchResponse> {
    const startTime = Date.now();
    const { q, limit = QUERY_LIMITS.DEFAULT, state, postcode, includeCoordinates = false, includeComponents = false } = params;
    
    try {
      const queryLimit = Math.min(limit, QUERY_LIMITS.MAXIMUM);
      
      // Create cache key for search query
      const cacheKey = `address:search:${q}:${limit}:${state || ''}:${postcode || ''}:${includeCoordinates}:${includeComponents}`;
      
      // Try to get from cache first
      const cached = await cachingService.getOrSet(
        cacheKey,
        async () => {
          const searchVector = this.prepareSearchQuery(q);
          
          // Extract potential street number from query for exact matching
          const streetNumber = this.extractStreetNumber(q);
          
          const queryParams: any[] = [searchVector, streetNumber];
          let paramIndex = 3;
          
          let baseQuery = `
            SELECT 
              a.gnaf_pid,
              CONCAT_WS(' ', 
                a.number_first, 
                s.street_name, 
                s.street_type,
                l.locality_name,
                l.state_code,
                l.postcode
              ) as formatted_address,
              a.confidence_score,
              ${includeCoordinates ? 'a.latitude, a.longitude, a.coordinate_precision,' : ''}
              a.number_first as street_number,
              s.street_name,
              s.street_type,
              l.locality_name,
              l.state_code as state_abbreviation,
              l.postcode,
              ts_rank(a.search_vector, to_tsquery('english', $1)) as relevance_score,
              CASE 
                WHEN a.number_first = $2 THEN 100
                ELSE 0 
              END as street_number_bonus
            FROM gnaf.addresses a
            LEFT JOIN gnaf.streets s ON a.street_locality_pid = s.street_locality_pid
            LEFT JOIN gnaf.localities l ON s.locality_pid = l.locality_pid
            WHERE a.search_vector @@ to_tsquery('english', $1)
          `;
          
          if (state) {
            baseQuery += ` AND l.state_code = $${paramIndex}`;
            queryParams.push(state.toUpperCase());
            paramIndex++;
          }
          
          if (postcode) {
            baseQuery += ` AND l.postcode = $${paramIndex}`;
            queryParams.push(postcode);
            paramIndex++;
          }
          
          baseQuery += ` 
            ORDER BY street_number_bonus DESC, relevance_score DESC, confidence_score DESC 
            LIMIT $${paramIndex}
          `;
          queryParams.push(queryLimit);
          
          const result = await this.db.query(baseQuery, queryParams);
          
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
            }),
            ...(includeComponents && {
              components: {
                streetNumber: row.street_number,
                streetName: row.street_name,
                streetType: row.street_type,
                suburb: row.locality_name,
                state: row.state_abbreviation,
                postcode: row.postcode || ''
              }
            })
          }));
          
          return {
            results,
            total: result.rows.length,
            limit: queryLimit
          };
        },
        { ttl: this.CACHE_TTL.SEARCH }
      );
      
      const duration = Date.now() - startTime;
      
      logger.info('Address search completed', {
        query: q,
        resultsCount: cached?.results?.length || 0,
        duration,
        state,
        postcode,
        cached: cached !== null
      });
      
      return cached || {
        results: [],
        total: 0,
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
      
      // Create cache key for validation request
      const cacheKey = `address:validate:${normalizedAddress}:${strictMode}:${includeComponents}:${includeSuggestions}`;
      
      const cached = await cachingService.getOrSet(
        cacheKey,
        async () => {
          const exactMatch = await this.findExactMatch(normalizedAddress);
          if (exactMatch) {
            logger.debug('Address validation - exact match found', {
              address: address.substring(0, 100),
              confidence: exactMatch.confidence_score
            });
            
            return await this.buildValidationResponse(exactMatch, true, includeComponents, includeSuggestions);
          }
          
          if (strictMode) {
            return this.buildInvalidResponse(address, 'No exact match found in strict mode', includeSuggestions);
          }
          
          const fuzzyMatches = await this.findFuzzyMatches(normalizedAddress);
          if (fuzzyMatches.length > 0 && fuzzyMatches[0].confidence_score >= CONFIDENCE_THRESHOLDS.VALID_MATCH) {
            const bestMatch = fuzzyMatches[0];
            logger.debug('Address validation - fuzzy match found', {
              address: address.substring(0, 100),
              confidence: bestMatch.confidence_score
            });
            
            return await this.buildValidationResponse(bestMatch, false, includeComponents, includeSuggestions, fuzzyMatches.slice(1));
          }
          
          const suggestions = includeSuggestions ? await this.generateSuggestions(normalizedAddress) : [];
          logger.debug('Address validation - no valid matches', {
            address: address.substring(0, 100),
            suggestionsCount: suggestions.length
          });
          
          return this.buildInvalidResponse(address, 'No matches found with sufficient confidence', includeSuggestions, suggestions);
        },
        { ttl: this.CACHE_TTL.VALIDATION }
      );
      
      const duration = Date.now() - startTime;
      
      logger.info('Address validation completed', {
        address: address.substring(0, 100),
        isValid: cached?.isValid || false,
        confidence: cached?.confidence || 0,
        duration,
        cached: cached !== null
      });
      
      return cached || this.buildInvalidResponse(address, 'Cache error', includeSuggestions);
      
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
        a.gnaf_pid,
        CONCAT_WS(' ', 
          a.number_first, 
          s.street_name, 
          s.street_type,
          l.locality_name,
          l.state_code,
          l.postcode
        ) as formatted_address,
        a.confidence_score,
        a.latitude, a.longitude, a.coordinate_precision, a.coordinate_reliability,
        a.number_first as street_number, s.street_name, s.street_type, 
        l.locality_name, l.state_code as state_abbreviation, l.postcode
      FROM gnaf.addresses a
      LEFT JOIN gnaf.streets s ON a.street_locality_pid = s.street_locality_pid
      LEFT JOIN gnaf.localities l ON s.locality_pid = l.locality_pid
      WHERE LOWER(CONCAT_WS(' ', 
        a.number_first, 
        s.street_name, 
        s.street_type,
        l.locality_name,
        l.state_code,
        l.postcode
      )) = LOWER($1)
      ORDER BY a.confidence_score DESC
      LIMIT 1
    `;
    
    const result = await this.db.query(query, [address]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  private async findFuzzyMatches(address: string, limit = QUERY_LIMITS.SUGGESTION_DEFAULT): Promise<any[]> {
    const searchVector = this.prepareSearchQuery(address);
    const streetNumber = this.extractStreetNumber(address);
    
    const query = `
      SELECT 
        a.gnaf_pid,
        CONCAT_WS(' ', 
          a.number_first, 
          s.street_name, 
          s.street_type,
          l.locality_name,
          l.state_code,
          l.postcode
        ) as formatted_address,
        a.confidence_score,
        a.latitude, a.longitude, a.coordinate_precision, a.coordinate_reliability,
        a.number_first as street_number, s.street_name, s.street_type,
        l.locality_name, l.state_code as state_abbreviation, l.postcode,
        ts_rank(a.search_vector, to_tsquery('english', $1)) as relevance_score,
        CASE 
          WHEN a.number_first = $3 THEN 100
          ELSE 0 
        END as street_number_bonus
      FROM gnaf.addresses a
      LEFT JOIN gnaf.streets s ON a.street_locality_pid = s.street_locality_pid
      LEFT JOIN gnaf.localities l ON s.locality_pid = l.locality_pid
      WHERE a.search_vector @@ to_tsquery('english', $1)
      ORDER BY 
        street_number_bonus DESC,
        GREATEST(a.confidence_score * 0.6, ts_rank(a.search_vector, to_tsquery('english', $1)) * 40) DESC
      LIMIT $2
    `;
    
    const result = await this.db.query(query, [searchVector, limit, streetNumber]);
    return result.rows;
  }

  private async generateSuggestions(address: string, limit = QUERY_LIMITS.SUGGESTION_DEFAULT): Promise<any[]> {
    const words = address.toLowerCase().split(/\s+/).filter(word => word.length > QUERY_LIMITS.MIN_WORD_LENGTH);
    if (words.length === 0) return [];
    
    const searchTerms = words.join(' & ');
    const streetNumber = this.extractStreetNumber(address);
    
    const query = `
      SELECT 
        a.gnaf_pid,
        CONCAT_WS(' ', 
          a.number_first, 
          s.street_name, 
          s.street_type,
          l.locality_name,
          l.state_code,
          l.postcode
        ) as formatted_address,
        a.confidence_score,
        ts_rank(a.search_vector, to_tsquery('english', $1)) as relevance_score,
        CASE 
          WHEN a.number_first = $3 THEN 100
          ELSE 0 
        END as street_number_bonus
      FROM gnaf.addresses a
      LEFT JOIN gnaf.streets s ON a.street_locality_pid = s.street_locality_pid
      LEFT JOIN gnaf.localities l ON s.locality_pid = l.locality_pid
      WHERE a.search_vector @@ to_tsquery('english', $1)
        AND a.confidence_score >= ${CONFIDENCE_THRESHOLDS.MIN_SUGGESTION}
      ORDER BY street_number_bonus DESC, relevance_score DESC, a.confidence_score DESC
      LIMIT $2
    `;
    
    const result = await this.db.query(query, [searchTerms, limit, streetNumber]);
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
    // Common Australian street types that might not be in search vectors
    const streetTypes = new Set([
      'street', 'st', 'road', 'rd', 'avenue', 'ave', 'place', 'pl', 'court', 'ct',
      'drive', 'dr', 'lane', 'ln', 'way', 'close', 'cl', 'circuit', 'cct',
      'grove', 'parade', 'pde', 'terrace', 'tce', 'boulevard', 'blvd', 'highway', 'hwy',
      'crescent', 'cres', 'square', 'sq', 'esplanade', 'esp', 'walk'
    ]);

    const words = input
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0 && (word.length > QUERY_LIMITS.MIN_WORD_LENGTH || /^\d+$/.test(word)));

    // Filter out street types as they may not be in search vectors
    const filteredWords = words.filter(word => !streetTypes.has(word));
    
    // If we removed street types but still have meaningful words, use filtered version
    // Otherwise, use original words (in case the "street type" word is actually part of a street name)
    const finalWords = filteredWords.length > 0 ? filteredWords : words;
    
    // Create search query with stemming support (PostgreSQL will handle plural/singular)
    return finalWords.map(word => {
      // For numeric words, keep as-is for exact matching
      if (/^\d+$/.test(word)) {
        return word;
      }
      // For text words, let PostgreSQL handle stemming by using the word as-is
      return word;
    }).join(' & ');
  }

  private extractStreetNumber(input: string): string | null {
    // Extract the first number from the query, which is likely the street number
    const match = input.trim().match(/^\d+/);
    return match ? match[0] : null;
  }

  private normalizeAddress(address: string): string {
    return address
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/,+/g, ',')
      .replace(/\.$/, '');
  }
}