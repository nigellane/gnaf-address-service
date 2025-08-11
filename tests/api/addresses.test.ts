import request from 'supertest';
import { getDatabase } from '../../src/config/database';

jest.mock('../../src/config/database');

const mockDb = {
  query: jest.fn(),
  healthCheck: jest.fn().mockResolvedValue({ healthy: true, latency: 10 })
};

(getDatabase as jest.Mock).mockReturnValue(mockDb);

import app from '../../src/app';

describe('Address API Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.query.mockClear();
    mockDb.healthCheck.mockResolvedValue({ healthy: true, latency: 10 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/addresses/search', () => {
    const validApiKey = 'dev-key-1';

    it('should return search results for valid query', async () => {
      const mockResults = [
        {
          gnaf_pid: 'GANSW701G001234',
          formatted_address: '123 Main Street, Sydney NSW 2000',
          confidence_score: 95
        }
      ];

      mockDb.query.mockResolvedValue({ rows: mockResults });

      const response = await request(app)
        .get('/api/v1/addresses/search?q=Main Street Sydney')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].gnafPid).toBe('GANSW701G001234');
      expect(response.body.total).toBe(1);
      expect(response.body.limit).toBe(10);
      expect(response.headers['x-request-id']).toBeDefined();
      expect(response.headers['x-response-time']).toBeDefined();
    });

    it('should return 400 for missing query parameter', async () => {
      const response = await request(app)
        .get('/api/v1/addresses/search')
        .set('X-API-Key', validApiKey)
        .expect(400);

      expect(response.body.error.code).toBe('MISSING_QUERY');
      expect(response.body.error.message).toContain('Query parameter "q" is required');
    });

    it('should return 400 for invalid limit', async () => {
      const response = await request(app)
        .get('/api/v1/addresses/search?q=Main Street&limit=100')
        .set('X-API-Key', validApiKey)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_LIMIT');
      expect(response.body.error.message).toContain('Limit must be between 1 and 50');
    });

    it('should return 401 for missing API key', async () => {
      const response = await request(app)
        .get('/api/v1/addresses/search?q=Main Street')
        .expect(401);

      expect(response.body.error.code).toBe('MISSING_API_KEY');
      expect(response.body.error.message).toContain('API key is required');
    });

    it('should return 401 for invalid API key', async () => {
      const response = await request(app)
        .get('/api/v1/addresses/search?q=Main Street')
        .set('X-API-Key', 'invalid-key')
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_API_KEY');
      expect(response.body.error.message).toContain('Invalid API key');
    });

    it('should handle state and postcode filters', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .get('/api/v1/addresses/search?q=Main Street&state=NSW&postcode=2000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.results).toHaveLength(0);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('state_abbreviation = $2'),
        expect.arrayContaining(['NSW', '2000'])
      );
    });

    it('should handle includeCoordinates parameter', async () => {
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

      const response = await request(app)
        .get('/api/v1/addresses/search?q=Main Street&includeCoordinates=true')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.results[0].coordinates).toEqual({
        latitude: -33.8688,
        longitude: 151.2093,
        precision: 'PROPERTY'
      });
    });

    it('should return 500 for database errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/v1/addresses/search?q=Main Street')
        .set('X-API-Key', validApiKey)
        .expect(500);

      expect(response.body.error.code).toBe('SEARCH_ERROR');
      expect(response.body.error.message).toContain('error occurred while searching');
    });
  });

  describe('POST /api/v1/addresses/validate', () => {
    const validApiKey = 'dev-key-1';

    it('should validate a valid address', async () => {
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

      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({ address: '123 Main Street, Sydney NSW 2000' })
        .expect(200);

      expect(response.body.isValid).toBe(true);
      expect(response.body.confidence).toBe(100);
      expect(response.body.standardizedAddress).toBe('123 Main Street, Sydney NSW 2000');
      expect(response.body.components.streetNumber).toBe('123');
      expect(response.body.components.coordinates.latitude).toBe(-33.8688);
    });

    it('should return 400 for missing address field', async () => {
      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({})
        .expect(400);

      expect(response.body.error.code).toBe('MISSING_ADDRESS');
      expect(response.body.error.message).toContain('Address field is required');
    });

    it('should return 400 for empty address', async () => {
      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({ address: '' })
        .expect(400);

      expect(response.body.error.code).toBe('MISSING_ADDRESS');
    });

    it('should return 400 for address too long', async () => {
      const longAddress = 'A'.repeat(501);

      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({ address: longAddress })
        .expect(400);

      expect(response.body.error.code).toBe('ADDRESS_TOO_LONG');
      expect(response.body.error.message).toContain('must not exceed 500 characters');
    });

    it('should handle strict mode', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({ 
          address: 'Invalid Address',
          strictMode: true
        })
        .expect(200);

      expect(response.body.isValid).toBe(false);
      expect(response.body.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'INVALID_FORMAT',
            message: 'No exact match found in strict mode'
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

      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({ 
          address: '123 Main Street, Sydney NSW 2000',
          includeComponents: false
        })
        .expect(200);

      expect(response.body.components).toBeUndefined();
    });

    it('should return 500 for database errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/api/v1/addresses/validate')
        .set('X-API-Key', validApiKey)
        .send({ address: '123 Main Street' })
        .expect(500);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('error occurred while validating');
    });
  });

  describe('GET /api/v1/addresses/health', () => {
    it('should return healthy status when database is healthy', async () => {
      mockDb.healthCheck.mockResolvedValue({ healthy: true, latency: 10 });

      const response = await request(app)
        .get('/api/v1/addresses/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.services.database.healthy).toBe(true);
      expect(response.body.services.database.latency).toBe(10);
      expect(response.body.timestamp).toBeDefined();
    });

    it('should return degraded status when database is unhealthy', async () => {
      mockDb.healthCheck.mockResolvedValue({ 
        healthy: false, 
        latency: 5000,
        error: 'Connection timeout'
      });

      const response = await request(app)
        .get('/api/v1/addresses/health')
        .expect(503);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.database.healthy).toBe(false);
      expect(response.body.services.database.error).toBe('Connection timeout');
    });

    it('should return unhealthy status when health check fails', async () => {
      mockDb.healthCheck.mockRejectedValue(new Error('Database not responding'));

      const response = await request(app)
        .get('/api/v1/addresses/health')
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
      expect(response.body.services.database.healthy).toBe(false);
      expect(response.body.services.database.error).toBe('Database not responding');
    });
  });

  describe('Rate Limiting', () => {
    const validApiKey = 'dev-key-1';

    it('should include rate limiting headers', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .get('/api/v1/addresses/search?q=test')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.headers['x-ratelimit-limit']).toBe('1000');
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('CORS and Security', () => {
    it('should include security headers', async () => {
      const response = await request(app)
        .get('/api/v1/health')
        .expect(200);

      expect(response.headers['x-content-type-options']).toBeDefined();
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['strict-transport-security']).toBeDefined();
    });
  });
});