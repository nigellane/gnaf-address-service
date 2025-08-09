# G-NAF Address Service API Contract

## Integration Contract for Real Estate Commission System

This document defines the API contract between the G-NAF Address Service and the Real Estate Commission System, designed to replace the Epic 2c addressr integration.

## Base Configuration

```env
# Real Estate Commission System .env
GNAF_SERVICE_URL=http://localhost:3001
GNAF_SERVICE_API_KEY=your_api_key_here
GNAF_SERVICE_TIMEOUT=5000
GNAF_SERVICE_FALLBACK_ENABLED=true
```

## Core API Endpoints

### 1. Address Validation (Replaces addressr validation)

**Endpoint:** `POST /api/v1/addresses/validate`

**Purpose:** Validates and standardizes property addresses during creation/editing

**Request:**
```typescript
interface AddressValidationRequest {
  address: string;
  strictMode?: boolean; // Default: false
  includeComponents?: boolean; // Default: true
  includeSuggestions?: boolean; // Default: true
}
```

**Response:**
```typescript
interface AddressValidationResponse {
  isValid: boolean;
  confidence: number; // 0-100
  standardizedAddress?: string;
  components?: {
    streetNumber?: string;
    streetName: string;
    streetType: string;
    suburb: string;
    state: string;
    postcode: string;
    coordinates?: {
      latitude: number;
      longitude: number;
      precision: 'PROPERTY' | 'STREET' | 'LOCALITY';
    };
  };
  suggestions: Array<{
    address: string;
    confidence: number;
    gnafPid: string;
  }>;
  issues: Array<{
    type: 'MISSING_COMPONENT' | 'INVALID_FORMAT' | 'AMBIGUOUS_MATCH';
    message: string;
    severity: 'ERROR' | 'WARNING' | 'INFO';
  }>;
}
```

**Integration Example:**
```typescript
// Real Estate Commission System - AddressValidation component replacement
export async function validateAddress(address: string): Promise<GNAFValidationResult> {
  try {
    const response = await fetch(`${GNAF_SERVICE_URL}/api/v1/addresses/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': GNAF_SERVICE_API_KEY,
      },
      body: JSON.stringify({ 
        address,
        includeComponents: true,
        includeSuggestions: true 
      }),
      timeout: GNAF_SERVICE_TIMEOUT,
    });
    
    return await response.json();
  } catch (error) {
    // Fallback to Epic 2c addressr if G-NAF service unavailable
    if (GNAF_SERVICE_FALLBACK_ENABLED) {
      return await addressrClient.validateAddress(address);
    }
    throw error;
  }
}
```

### 2. Address Search with Autocomplete

**Endpoint:** `GET /api/v1/addresses/search`

**Purpose:** Provides real-time address suggestions for form autocomplete

**Query Parameters:**
```typescript
interface AddressSearchParams {
  q: string;              // Search query
  limit?: number;         // Default: 10, Max: 50
  state?: string;         // Filter by state
  postcode?: string;      // Filter by postcode
  includeCoordinates?: boolean; // Default: false
}
```

**Response:**
```typescript
interface AddressSearchResponse {
  results: Array<{
    gnafPid: string;
    address: string;
    components: AddressComponents;
    confidence: number;
    coordinates?: Coordinates;
  }>;
  total: number;
  executionTime: number; // milliseconds
}
```

### 3. Batch Address Processing

**Endpoint:** `POST /api/v1/addresses/batch/validate`

**Purpose:** Bulk validation for data migration from Epic 2c addressr to G-NAF

**Request:**
```typescript
interface BatchValidationRequest {
  addresses: Array<{
    id: string; // Client reference ID
    address: string;
  }>;
  options?: {
    includeComponents?: boolean;
    failFast?: boolean; // Stop on first error
  };
}
```

**Response:**
```typescript
interface BatchValidationResponse {
  results: Array<{
    id: string;
    address: string;
    validation: AddressValidationResponse;
  }>;
  summary: {
    total: number;
    valid: number;
    invalid: number;
    warnings: number;
    processingTime: number;
  };
}
```

## Integration Patterns

### 1. Property Creation Form Integration

```typescript
// apps/web/src/components/address/AddressValidation.tsx
// Enhanced to use G-NAF service with addressr fallback

import { useGNAFValidation } from '~/hooks/useGNAFValidation';

export function AddressValidation({ value, onChange, onValidationChange }: Props) {
  const {
    suggestions,
    isLoading,
    error,
    isValid,
    searchAddresses,
    validateAddress,
    selectedAddress,
  } = useGNAFValidation({
    fallbackToAddressr: true,
    debounceMs: 300,
  });

  // Enhanced UI with G-NAF confidence indicators
  // Fallback messaging when G-NAF service unavailable
  // ... existing component logic enhanced
}
```

### 2. Data Migration Hook

```typescript
// Migration utility for converting Epic 2c addresses to G-NAF
export async function migrateAddressesToGNAF() {
  const properties = await api.property.getAllProperties.query();
  
  const migrationBatch = properties.map(property => ({
    id: property.id,
    address: property.address,
  }));

  const gnafResults = await gnafClient.batchValidate(migrationBatch);
  
  // Update properties with standardized G-NAF addresses
  const updates = gnafResults.results
    .filter(result => result.validation.isValid)
    .map(result => ({
      id: result.id,
      standardizedAddress: result.validation.standardizedAddress,
      coordinates: result.validation.components?.coordinates,
      gnafPid: result.validation.components?.gnafPid,
    }));

  await api.property.batchUpdateAddresses.mutate(updates);
}
```

### 3. Service Health Integration

**Endpoint:** `GET /api/v1/health`

**Response:**
```typescript
interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  checks: {
    database: {
      status: 'up' | 'down';
      responseTime: number;
    };
    cache: {
      status: 'up' | 'down';
      responseTime: number;
    };
    gnafDataset: {
      status: 'current' | 'outdated' | 'missing';
      lastUpdate: string;
      recordCount: number;
    };
  };
}
```

## Error Handling and Fallback Strategy

### Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    timestamp: string;
    requestId: string;
  };
}
```

### Common Error Codes

| Code | HTTP Status | Description | Fallback Action |
|------|-------------|-------------|-----------------|
| `INVALID_ADDRESS` | 400 | Address format invalid | Show validation errors |
| `NO_MATCHES_FOUND` | 404 | No G-NAF matches | Suggest manual entry |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Implement backoff |
| `SERVICE_UNAVAILABLE` | 503 | G-NAF service down | Fallback to Epic 2c |
| `DATASET_OUTDATED` | 503 | G-NAF data stale | Show warning message |

### Fallback Implementation

```typescript
export class AddressValidationService {
  constructor(
    private gnafClient: GNAFClient,
    private addressrClient: AddressrClient, // Epic 2c fallback
    private config: ServiceConfig
  ) {}

  async validateAddress(address: string): Promise<ValidationResult> {
    try {
      // Primary: G-NAF validation
      const gnafResult = await this.gnafClient.validate(address);
      
      if (gnafResult.confidence >= this.config.minimumConfidence) {
        return this.mapGNAFResult(gnafResult);
      }
    } catch (error) {
      console.warn('G-NAF service unavailable, falling back to addressr', error);
    }

    // Fallback: Epic 2c addressr validation
    if (this.config.fallbackEnabled) {
      return await this.addressrClient.validateAddress(address);
    }

    throw new Error('Address validation services unavailable');
  }
}
```

## Performance Requirements

### Response Time Targets

| Endpoint | Target (95th percentile) | Timeout |
|----------|-------------------------|---------|
| Address Validation | 300ms | 5s |
| Address Search | 500ms | 3s |
| Batch Validation | 100 addresses/second | 30s |
| Health Check | 100ms | 1s |

### Monitoring Integration

```typescript
// Performance monitoring in Real Estate Commission System
export const gnafMetrics = {
  responseTime: new Histogram({
    name: 'gnaf_service_response_time',
    help: 'G-NAF service response time',
    labelNames: ['endpoint', 'status'],
  }),
  
  fallbackRate: new Counter({
    name: 'gnaf_service_fallback_total',
    help: 'Total G-NAF service fallbacks to addressr',
    labelNames: ['reason'],
  }),
};
```

## Security

### Authentication
- API Key authentication via `X-API-Key` header
- JWT tokens for service-to-service communication
- IP whitelisting for production environments

### Rate Limiting
- 1000 requests per 15 minutes per API key
- Burst capacity: 100 requests per minute
- Graduated throttling based on usage patterns

## Testing Strategy

### Integration Tests

```typescript
describe('G-NAF Service Integration', () => {
  it('should validate addresses with fallback to addressr', async () => {
    // Mock G-NAF service failure
    nock(GNAF_SERVICE_URL).post('/api/v1/addresses/validate').reply(503);
    
    // Expect fallback to addressr
    const result = await validateAddress('123 Collins St Melbourne VIC 3000');
    expect(result.source).toBe('addressr_fallback');
    expect(result.isValid).toBe(true);
  });

  it('should prefer G-NAF results over addressr when available', async () => {
    // Mock successful G-NAF response
    nock(GNAF_SERVICE_URL)
      .post('/api/v1/addresses/validate')
      .reply(200, mockGNAFResponse);
    
    const result = await validateAddress('123 Collins St Melbourne VIC 3000');
    expect(result.source).toBe('gnaf');
    expect(result.confidence).toBeGreaterThan(90);
  });
});
```

This API contract ensures seamless integration between the G-NAF Address Service and the Real Estate Commission System while maintaining backward compatibility with the existing Epic 2c addressr solution.