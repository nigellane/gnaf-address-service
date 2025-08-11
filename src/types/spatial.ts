/**
 * Spatial Analytics Type Definitions
 * For G-NAF Address Service spatial queries and analytics
 */

// Proximity Analysis Types
export interface ProximityRequest {
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  address?: string; // Alternative to coordinates via geocoding
  radius: number; // Meters (max: 5000m for performance)
  propertyTypes?: string[]; // Filter results
  limit?: number; // Default: 10, Max: 50
  includeDistance?: boolean; // Default: true
  includeBearing?: boolean; // Default: false
}

export interface ProximityResponse {
  center: { latitude: number; longitude: number };
  radius: number;
  results: Array<{
    gnafPid: string;
    address: string;
    coordinates: { latitude: number; longitude: number };
    distance: { meters: number; kilometers: number };
    bearing?: number; // Degrees from North
    propertyType?: string;
  }>;
  summary: {
    total: number;
    averageDistance: number;
    searchTime: number;
  };
}

// Administrative Boundary Types
export interface BoundaryLookupParams {
  coordinates: { latitude: number; longitude: number };
  includeLGA?: boolean; // Default: true
  includeElectoral?: boolean; // Default: false
  includePostal?: boolean; // Default: true
}

export interface BoundaryResponse {
  coordinates: { latitude: number; longitude: number };
  boundaries: {
    locality: {
      name: string;
      pid: string;
      postcode: string;
    };
    localGovernmentArea?: {
      name: string;
      category: string; // City, Shire, Town, etc.
    };
    electoralDistrict?: {
      federal: string;
      state: string;
    };
    postalArea?: {
      postcode: string;
      deliveryOffice: string;
    };
  };
}

// Statistical Area Classification Types
export interface StatisticalAreaRequest {
  coordinates?: { latitude: number; longitude: number };
  address?: string;
  includeHierarchy?: boolean; // Default: true
}

export interface StatisticalAreaResponse {
  coordinates: { latitude: number; longitude: number };
  classification: {
    sa1: { code: string; name: string };
    sa2: { code: string; name: string };
    sa3: { code: string; name: string };
    sa4: { code: string; name: string };
  };
  hierarchy: {
    meshBlock?: string;
    censusCollectionDistrict?: string;
  };
  metadata: {
    dataSource: 'G-NAF' | 'ABS_BOUNDARIES';
    accuracy: 'EXACT' | 'INTERPOLATED';
  };
}

// Batch Processing Types
export interface BatchSpatialRequest {
  operations: Array<{
    id: string;
    type: 'proximity' | 'boundary' | 'statistical';
    parameters: ProximityRequest | BoundaryLookupParams | StatisticalAreaRequest;
  }>;
  options?: {
    batchSize?: number; // Default: 10, Max: 100
    progressCallback?: boolean;
    failFast?: boolean;
  };
}

export interface BatchSpatialResponse {
  results: Array<{
    id: string;
    type: 'proximity' | 'boundary' | 'statistical';
    status: 'success' | 'error';
    data?: ProximityResponse | BoundaryResponse | StatisticalAreaResponse;
    error?: string;
  }>;
  summary: {
    total: number;
    successful: number;
    failed: number;
    processingTime: number;
    batchSize: number;
  };
}

// Spatial Query Performance Types
export interface SpatialPerformanceMetrics {
  queryType: 'proximity' | 'boundary' | 'statistical' | 'batch';
  executionTime: number;
  resultCount: number;
  usesSpatialIndex: boolean;
  queryPlan?: string;
  memoryUsage?: number;
}

// Common spatial utility types
export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Distance {
  meters: number;
  kilometers: number;
}

export interface SpatialBounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

// Australian Territory Validation Constants
export const AUSTRALIAN_BOUNDS: SpatialBounds = {
  minLatitude: -43.7,
  maxLatitude: -9.0,
  minLongitude: 112.0,
  maxLongitude: 154.0
};

export const SPATIAL_CONSTANTS = {
  MAX_RADIUS_METERS: 5000,
  DEFAULT_PROXIMITY_LIMIT: 10,
  MAX_PROXIMITY_LIMIT: 50,
  DEFAULT_BATCH_SIZE: 10,
  MAX_BATCH_SIZE: 100,
  COORDINATE_PRECISION: 7,
  WGS84_SRID: 4326,
  WEB_MERCATOR_SRID: 3857
};