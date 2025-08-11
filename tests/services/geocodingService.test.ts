import { GeocodingService } from '../../src/services/geocodingService';
import { GeocodeRequest, ReverseGeocodeParams } from '../../src/types/api';

const mockQuery = jest.fn();

jest.mock('../../src/config/database', () => ({
  getDatabase: () => ({
    query: mockQuery
  })
}));

describe('GeocodingService', () => {
  let geocodingService: GeocodingService;

  beforeEach(() => {
    geocodingService = new GeocodingService();
    jest.clearAllMocks();
  });

  describe('geocodeAddress', () => {
    it('should successfully geocode a valid address', async () => {
      const mockRow = {
        address_detail_pid: 'GAACT714845933',
        gnaf_pid: 'GAACT714845933',
        formatted_address: '1 Test Street, CANBERRA ACT 2601',
        latitude: '-35.2809',
        longitude: '149.1300',
        coordinate_precision: 'PROPERTY',
        coordinate_reliability: 1,
        street_number: '1',
        street_name: 'Test',
        street_type: 'Street',
        locality_name: 'CANBERRA',
        state_code: 'ACT',
        postcode: '2601',
        similarity_score: 0.95,
        confidence: 90
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const request: GeocodeRequest = {
        address: '1 Test Street, Canberra ACT 2601',
        coordinateSystem: 'WGS84',
        includePrecision: true,
        includeComponents: true
      };

      const result = await geocodingService.geocodeAddress(request);

      expect(result.success).toBe(true);
      expect(result.coordinates.latitude).toBe(-35.2809);
      expect(result.coordinates.longitude).toBe(149.1300);
      expect(result.coordinates.coordinateSystem).toBe('WGS84');
      expect(result.coordinates.precision).toBe('PROPERTY');
      expect(result.coordinates.reliability).toBe(1);
      expect(result.confidence).toBe(90);
      expect(result.gnafPid).toBe('GAACT714845933');
      expect(result.components).toBeDefined();
      expect(result.components?.streetNumber).toBe('1');
      expect(result.components?.streetName).toBe('Test');
      expect(result.components?.streetType).toBe('Street');
      expect(result.components?.suburb).toBe('CANBERRA');
      expect(result.components?.state).toBe('ACT');
      expect(result.components?.postcode).toBe('2601');
    });

    it('should return unsuccessful result for no matches', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const request: GeocodeRequest = {
        address: 'Nonexistent Address',
        coordinateSystem: 'WGS84'
      };

      const result = await geocodingService.geocodeAddress(request);

      expect(result.success).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.gnafPid).toBe('');
    });

    it('should throw error for empty address', async () => {
      const request: GeocodeRequest = {
        address: '',
        coordinateSystem: 'WGS84'
      };

      await expect(geocodingService.geocodeAddress(request)).rejects.toThrow('Address is required');
    });

    it('should throw error for address too long', async () => {
      const longAddress = 'a'.repeat(501);
      const request: GeocodeRequest = {
        address: longAddress,
        coordinateSystem: 'WGS84'
      };

      await expect(geocodingService.geocodeAddress(request)).rejects.toThrow('Address must not exceed 500 characters');
    });

    it('should throw error for invalid coordinate system', async () => {
      const request: GeocodeRequest = {
        address: '1 Test Street',
        coordinateSystem: 'INVALID' as any
      };

      await expect(geocodingService.geocodeAddress(request)).rejects.toThrow('Invalid coordinate system: INVALID');
    });
  });

  describe('reverseGeocode', () => {
    it('should successfully reverse geocode valid coordinates', async () => {
      const mockRow = {
        address_detail_pid: 'GAACT714845933',
        gnaf_pid: 'GAACT714845933',
        formatted_address: '1 Test Street, CANBERRA ACT 2601',
        latitude: '-35.2809',
        longitude: '149.1300',
        coordinate_precision: 'PROPERTY',
        coordinate_reliability: 1,
        street_number: '1',
        street_name: 'Test',
        street_type: 'Street',
        locality_name: 'CANBERRA',
        state_code: 'ACT',
        postcode: '2601',
        distance_meters: 50,
        confidence: 90
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const params: ReverseGeocodeParams = {
        latitude: -35.2809,
        longitude: 149.1300,
        coordinateSystem: 'WGS84',
        radius: 100,
        limit: 1,
        includeDistance: true
      };

      const result = await geocodingService.reverseGeocode(params);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      const firstResult = result.results[0]!;
      expect(firstResult.gnafPid).toBe('GAACT714845933');
      expect(firstResult.formattedAddress).toBe('1 Test Street, CANBERRA ACT 2601');
      expect(firstResult.components).toBeDefined();
      expect(firstResult.distance.meters).toBeGreaterThanOrEqual(0);
      expect(firstResult.bearing).toBeGreaterThanOrEqual(0);
      expect(firstResult.confidence).toBe(90);
      expect(result.searchRadius).toBe(100);
      expect(result.coordinateSystem).toBe('WGS84');
    });

    it('should return empty results for coordinates with no nearby addresses', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const params: ReverseGeocodeParams = {
        latitude: -35.0000,
        longitude: 149.0000,
        coordinateSystem: 'WGS84',
        radius: 100
      };

      const result = await geocodingService.reverseGeocode(params);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
    });

    it('should throw error for invalid coordinates', async () => {
      const params: ReverseGeocodeParams = {
        latitude: 200, // Invalid latitude
        longitude: 149.1300,
        coordinateSystem: 'WGS84'
      };

      await expect(geocodingService.reverseGeocode(params)).rejects.toThrow('Invalid coordinates');
    });

    it('should limit radius to maximum 1000m', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const params: ReverseGeocodeParams = {
        latitude: -35.2809,
        longitude: 149.1300,
        radius: 2000 // Over limit
      };

      const result = await geocodingService.reverseGeocode(params);
      expect(result.searchRadius).toBe(1000); // Should be capped at 1000
    });

    it('should limit results to maximum 10', async () => {
      const mockRows = Array(15).fill(0).map((_, i) => ({
        address_detail_pid: `GAACT${i}`,
        gnaf_pid: `GAACT${i}`,
        formatted_address: `${i} Test Street, CANBERRA ACT 2601`,
        latitude: '-35.2809',
        longitude: '149.1300',
        coordinate_precision: 'PROPERTY',
        coordinate_reliability: 1,
        street_number: i.toString(),
        street_name: 'Test',
        street_type: 'Street',
        locality_name: 'CANBERRA',
        state_abbreviation: 'ACT',
        postcode: '2601',
        distance_meters: i * 10,
        confidence: 90
      }));

      mockQuery.mockResolvedValue({ rows: mockRows.slice(0, 10) }); // Database should limit to 10

      const params: ReverseGeocodeParams = {
        latitude: -35.2809,
        longitude: 149.1300,
        limit: 15 // Over limit
      };

      await geocodingService.reverseGeocode(params);

      // Check that query was called with limit 10
      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number), 10])
      );
    });
  });
});