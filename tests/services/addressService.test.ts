import { AddressService } from '../../src/services/addressService';
import { getDatabase } from '../../src/config/database';

jest.mock('../../src/config/database');

describe('AddressService', () => {
  let addressService: AddressService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: jest.fn()
    };
    (getDatabase as jest.Mock).mockReturnValue(mockDb);
    addressService = new AddressService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('searchAddresses', () => {
    it('should search addresses with basic query', async () => {
      const mockResults = [
        {
          gnaf_pid: 'GANSW701G001234',
          formatted_address: '123 Main Street, Sydney NSW 2000',
          confidence_score: 95
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockResults });

      const result = await addressService.searchAddresses({ q: 'Main Street Sydney' });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.gnafPid).toBe('GANSW701G001234');
      expect(result.results[0]?.confidence).toBe(95);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.arrayContaining(['main & street & sydney'])
      );
    });

    it('should handle state and postcode filters', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await addressService.searchAddresses({ 
        q: 'Main Street',
        state: 'NSW',
        postcode: '2000'
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('state_abbreviation = $2'),
        expect.arrayContaining(['NSW', '2000'])
      );
    });

    it('should include coordinates when requested', async () => {
      const mockResults = [
        {
          gnaf_pid: 'GANSW701G001234',
          formatted_address: '123 Main Street, Sydney NSW 2000',
          confidence_score: 95,
          latitude: -33.8688,
          longitude: 151.2093,
          coordinate_precision: 'PROPERTY'
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockResults });

      const result = await addressService.searchAddresses({ 
        q: 'Main Street',
        includeCoordinates: true
      });

      expect(result.results[0]?.coordinates).toEqual({
        latitude: -33.8688,
        longitude: 151.2093,
        precision: 'PROPERTY'
      });
    });

    it('should respect limit parameter', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await addressService.searchAddresses({ 
        q: 'Main Street',
        limit: 25
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([25])
      );
    });

    it('should enforce maximum limit of 50', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await addressService.searchAddresses({ 
        q: 'Main Street',
        limit: 100
      });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([50])
      );
    });
  });

  describe('validateAddress', () => {
    it('should validate exact match address', async () => {
      const mockExactMatch = {
        gnaf_pid: 'GANSW701G001234',
        formatted_address: '123 Main Street, Sydney NSW 2000',
        confidence_score: 100,
        latitude: -33.8688,
        longitude: 151.2093,
        coordinate_precision: 'PROPERTY',
        coordinate_reliability: 1,
        street_number: '123',
        street_name: 'Main',
        street_type: 'Street',
        locality_name: 'Sydney',
        state_abbreviation: 'NSW',
        postcode: '2000'
      };

      mockDb.query.mockResolvedValueOnce({ rows: [mockExactMatch] });

      const result = await addressService.validateAddress({
        address: '123 Main Street, Sydney NSW 2000'
      });

      expect(result.isValid).toBe(true);
      expect(result.confidence).toBe(100);
      expect(result.standardizedAddress).toBe('123 Main Street, Sydney NSW 2000');
      expect(result.components?.streetNumber).toBe('123');
      expect(result.components?.streetName).toBe('Main');
      expect(result.components?.coordinates?.latitude).toBe(-33.8688);
    });

    it('should handle fuzzy match when no exact match found', async () => {
      const mockFuzzyMatch = {
        gnaf_pid: 'GANSW701G001234',
        formatted_address: '123 Main Street, Sydney NSW 2000',
        confidence_score: 85,
        latitude: -33.8688,
        longitude: 151.2093,
        coordinate_precision: 'PROPERTY',
        coordinate_reliability: 1,
        street_number: '123',
        street_name: 'Main',
        street_type: 'Street',
        locality_name: 'Sydney',
        state_abbreviation: 'NSW',
        postcode: '2000'
      };

      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // No exact match
        .mockResolvedValueOnce({ rows: [mockFuzzyMatch] }); // Fuzzy match

      const result = await addressService.validateAddress({
        address: '123 Main St Sydney'
      });

      expect(result.isValid).toBe(true);
      expect(result.confidence).toBe(85);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'AMBIGUOUS_MATCH',
            severity: 'WARNING'
          })
        ])
      );
    });

    it('should return invalid for no matches in strict mode', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await addressService.validateAddress({
        address: 'Invalid Address',
        strictMode: true
      });

      expect(result.isValid).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'INVALID_FORMAT',
            message: 'No exact match found in strict mode',
            severity: 'ERROR'
          })
        ])
      );
    });

    it('should generate suggestions for invalid addresses', async () => {
      const mockSuggestions = [
        {
          gnaf_pid: 'GANSW701G001234',
          formatted_address: '123 Main Street, Sydney NSW 2000',
          confidence_score: 75
        }
      ];

      mockDb.query
        .mockResolvedValueOnce({ rows: [] }) // No exact match
        .mockResolvedValueOnce({ rows: [] }) // No fuzzy matches
        .mockResolvedValueOnce({ rows: mockSuggestions }); // Suggestions

      const result = await addressService.validateAddress({
        address: 'Main Street Sydney',
        includeSuggestions: true
      });

      expect(result.isValid).toBe(false);
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]?.address).toBe('123 Main Street, Sydney NSW 2000');
      expect(result.suggestions[0]?.confidence).toBe(75);
    });

    it('should handle incomplete addresses', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await addressService.validateAddress({
        address: 'Main St'
      });

      expect(result.isValid).toBe(false);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'MISSING_COMPONENT',
            message: 'Address appears to be incomplete. Please provide more details.',
            severity: 'WARNING'
          })
        ])
      );
    });

    it('should exclude components when requested', async () => {
      const mockExactMatch = {
        gnaf_pid: 'GANSW701G001234',
        formatted_address: '123 Main Street, Sydney NSW 2000',
        confidence_score: 100
      };

      mockDb.query.mockResolvedValueOnce({ rows: [mockExactMatch] });

      const result = await addressService.validateAddress({
        address: '123 Main Street, Sydney NSW 2000',
        includeComponents: false
      });

      expect(result.components).toBeUndefined();
    });
  });
});