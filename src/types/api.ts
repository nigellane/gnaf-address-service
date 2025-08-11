export interface AddressValidationRequest {
  address: string;
  strictMode?: boolean;
  includeComponents?: boolean;
  includeSuggestions?: boolean;
}

export interface AddressValidationResponse {
  isValid: boolean;
  confidence: number;
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

export interface AddressSearchParams {
  q: string;
  limit?: number;
  state?: string;
  postcode?: string;
  includeCoordinates?: boolean;
}

export interface AddressSearchResult {
  gnafPid: string;
  formattedAddress: string;
  confidence: number;
  coordinates?: {
    latitude: number;
    longitude: number;
    precision: 'PROPERTY' | 'STREET' | 'LOCALITY';
  };
}

export interface AddressSearchResponse {
  results: AddressSearchResult[];
  total: number;
  limit: number;
  offset?: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: any;
    requestId: string;
  };
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: {
    database: {
      healthy: boolean;
      latency: number;
      error?: string;
    };
  };
}

export interface GeocodeRequest {
  address: string;
  coordinateSystem?: 'WGS84' | 'GDA2020';
  includePrecision?: boolean;
  includeComponents?: boolean;
}

export interface GeocodeResponse {
  success: boolean;
  coordinates: {
    latitude: number;
    longitude: number;
    coordinateSystem: 'WGS84' | 'GDA2020';
    precision: 'PROPERTY' | 'STREET' | 'LOCALITY' | 'REGION';
    reliability: 1 | 2 | 3;
  };
  confidence: number;
  gnafPid: string;
  components?: AddressComponents;
}

export interface ReverseGeocodeParams {
  latitude: number;
  longitude: number;
  coordinateSystem?: 'WGS84' | 'GDA2020';
  radius?: number;
  limit?: number;
  includeDistance?: boolean;
}

export interface ReverseGeocodeResponse {
  success: boolean;
  results: Array<{
    gnafPid: string;
    formattedAddress: string;
    components: AddressComponents;
    distance: {
      meters: number;
      kilometers: number;
    };
    bearing?: number;
    confidence: number;
  }>;
  searchRadius: number;
  coordinateSystem: string;
}

export interface AddressComponents {
  streetNumber?: string;
  streetName: string;
  streetType: string;
  suburb: string;
  state: string;
  postcode: string;
}