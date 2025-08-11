import { getDatabase } from '../../src/config/database';
import { GeocodingService } from '../../src/services/geocodingService';
import { GeocodeRequest, ReverseGeocodeParams } from '../../src/types/api';

describe('Spatial Integration Tests', () => {
  let geocodingService: GeocodingService;
  
  beforeAll(async () => {
    geocodingService = new GeocodingService();
    
    // Wait for database connection
    try {
      await getDatabase().query('SELECT 1');
    } catch (error) {
      console.warn('Database not available for integration tests');
    }
  });

  describe('Database Spatial Queries', () => {
    it('should execute PostGIS spatial queries successfully', async () => {
      const query = `
        SELECT 
          ST_Distance(
            ST_Transform(ST_SetSRID(ST_MakePoint(149.1300, -35.2809), 4326), 3857),
            ST_Transform(ST_SetSRID(ST_MakePoint(149.1301, -35.2810), 4326), 3857)
          ) as distance_meters
      `;
      
      const result = await getDatabase().query(query);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].distance_meters).toBeGreaterThan(0);
    });

    it('should validate PostGIS extensions are available', async () => {
      const extensionQuery = `
        SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'postgis_topology')
      `;
      
      const result = await getDatabase().query(extensionQuery);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.some(row => row.extname === 'postgis')).toBe(true);
    });

    it('should verify spatial indexes exist on addresses table', async () => {
      const indexQuery = `
        SELECT indexname, tablename 
        FROM pg_indexes 
        WHERE tablename = 'addresses' 
        AND schemaname = 'gnaf'
        AND indexname LIKE '%geometry%'
      `;
      
      const result = await getDatabase().query(indexQuery);
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe('Geocoding Integration', () => {
    it('should geocode real addresses from database', async () => {
      // First get a real address from the database
      const addressQuery = `
        SELECT formatted_address 
        FROM gnaf.addresses 
        WHERE coordinate_reliability = 1 
        LIMIT 1
      `;
      
      const addressResult = await getDatabase().query(addressQuery);
      
      if (addressResult.rows.length > 0) {
        const testAddress = addressResult.rows[0].formatted_address;
        
        const request: GeocodeRequest = {
          address: testAddress,
          coordinateSystem: 'WGS84',
          includeComponents: true
        };

        const result = await geocodingService.geocodeAddress(request);
        
        expect(result.success).toBe(true);
        expect(result.coordinates.latitude).toBeGreaterThan(-43.7);
        expect(result.coordinates.latitude).toBeLessThan(-9.0);
        expect(result.coordinates.longitude).toBeGreaterThan(112.0);
        expect(result.coordinates.longitude).toBeLessThan(154.0);
        expect(result.confidence).toBeGreaterThan(0);
      }
    });

    it('should reverse geocode real coordinates from database', async () => {
      // Get real coordinates from database
      const coordQuery = `
        SELECT latitude, longitude 
        FROM gnaf.addresses 
        WHERE coordinate_reliability = 1 
        LIMIT 1
      `;
      
      const coordResult = await getDatabase().query(coordQuery);
      
      if (coordResult.rows.length > 0) {
        const { latitude, longitude } = coordResult.rows[0];
        
        const params: ReverseGeocodeParams = {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          coordinateSystem: 'WGS84',
          radius: 100,
          limit: 5
        };

        const result = await geocodingService.reverseGeocode(params);
        
        expect(result.success).toBe(true);
        expect(result.results.length).toBeGreaterThan(0);
        const firstResult = result.results[0];
        expect(firstResult!.distance.meters).toBeGreaterThanOrEqual(0);
        expect(firstResult!.bearing).toBeGreaterThanOrEqual(0);
        expect(firstResult!.bearing).toBeLessThan(360);
      }
    });
  });

  describe('Performance Tests', () => {
    it('should complete geocoding within 200ms', async () => {
      // Get a test address
      const addressQuery = `
        SELECT formatted_address 
        FROM gnaf.addresses 
        LIMIT 1
      `;
      
      const addressResult = await getDatabase().query(addressQuery);
      
      if (addressResult.rows.length > 0) {
        const testAddress = addressResult.rows[0].formatted_address;
        
        const request: GeocodeRequest = {
          address: testAddress,
          coordinateSystem: 'WGS84'
        };

        const startTime = Date.now();
        await geocodingService.geocodeAddress(request);
        const duration = Date.now() - startTime;
        
        expect(duration).toBeLessThan(200);
      }
    });

    it('should complete reverse geocoding within 300ms', async () => {
      const params: ReverseGeocodeParams = {
        latitude: -35.2809,
        longitude: 149.1300,
        coordinateSystem: 'WGS84',
        radius: 100
      };

      const startTime = Date.now();
      await geocodingService.reverseGeocode(params);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(300);
    });

    it('should complete spatial proximity queries within 500ms', async () => {
      const params: ReverseGeocodeParams = {
        latitude: -35.2809,
        longitude: 149.1300,
        coordinateSystem: 'WGS84',
        radius: 1000,
        limit: 10
      };

      const startTime = Date.now();
      await geocodingService.reverseGeocode(params);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(500);
    });
  });

  describe('Coordinate System Tests', () => {
    it('should handle WGS84 coordinates correctly', async () => {
      const params: ReverseGeocodeParams = {
        latitude: -35.2809,
        longitude: 149.1300,
        coordinateSystem: 'WGS84',
        radius: 100
      };

      const result = await geocodingService.reverseGeocode(params);
      expect(result.coordinateSystem).toBe('WGS84');
    });

    it('should handle GDA2020 coordinate system parameter', async () => {
      const params: ReverseGeocodeParams = {
        latitude: -35.2809,
        longitude: 149.1300,
        coordinateSystem: 'GDA2020',
        radius: 100
      };

      // Should not throw error
      const result = await geocodingService.reverseGeocode(params);
      expect(result.coordinateSystem).toBe('GDA2020');
    });
  });
});