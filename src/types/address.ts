/**
 * Core address types for the G-NAF Address Service
 * Based on Australian Government G-NAF data structure
 */

export interface GNAFAddress {
  /** Primary key from G-NAF dataset */
  gnafPid: string;
  
  /** Formatted full address string */
  address: string;
  
  /** Structured address components */
  components: AddressComponents;
  
  /** Geographic coordinates */
  coordinates: Coordinates;
  
  /** Address confidence and quality metrics */
  quality: AddressQuality;
  
  /** Administrative boundaries */
  boundaries: AdministrativeBoundaries;
  
  /** Metadata and timestamps */
  metadata: AddressMetadata;
}

export interface AddressComponents {
  /** Building/site name */
  buildingName?: string;
  
  /** Lot number */
  lotNumber?: string;
  
  /** Flat/unit type and number */
  flatType?: string;
  flatNumber?: string;
  
  /** House/building number */
  numberFirst?: string;
  numberLast?: string;
  
  /** Street information */
  street: StreetComponents;
  
  /** Locality (suburb) information */
  locality: LocalityComponents;
  
  /** State and postcode */
  state: StateCode;
  postcode: string;
}

export interface StreetComponents {
  name: string;
  type: StreetType;
  suffix?: StreetSuffix;
}

export interface LocalityComponents {
  name: string;
  class: LocalityClass;
}

export interface Coordinates {
  /** Longitude (x-coordinate) */
  longitude: number;
  
  /** Latitude (y-coordinate) */
  latitude: number;
  
  /** Coordinate precision indicator */
  precision: CoordinatePrecision;
  
  /** Coordinate reference system */
  crs: string; // e.g., "GDA2020"
}

export interface AddressQuality {
  /** Overall confidence score (0-100) */
  confidence: number;
  
  /** Geocoding reliability indicator */
  reliability: ReliabilityCode;
  
  /** Address completeness score */
  completeness: number;
  
  /** Validation status */
  status: ValidationStatus;
}

export interface AdministrativeBoundaries {
  /** Local Government Area */
  lga?: {
    code: string;
    name: string;
  };
  
  /** Electoral boundaries */
  electoral?: {
    federal: string;
    state: string;
  };
  
  /** Statistical areas */
  statistical?: {
    sa1: string;
    sa2: string;
    sa3: string;
    sa4: string;
  };
}

export interface AddressMetadata {
  /** Date address was created in G-NAF */
  dateCreated: string;
  
  /** Date address was last modified */
  dateLastModified?: string;
  
  /** Date address was retired (if applicable) */
  dateRetired?: string;
  
  /** Legal parcel identifier */
  legalParcelId?: string;
  
  /** Address lifecycle status */
  status: AddressLifecycleStatus;
}

// Enums and supporting types

export enum StateCode {
  NSW = "NSW",
  VIC = "VIC", 
  QLD = "QLD",
  SA = "SA",
  WA = "WA",
  TAS = "TAS",
  NT = "NT",
  ACT = "ACT"
}

export enum StreetType {
  STREET = "ST",
  ROAD = "RD", 
  AVENUE = "AVE",
  DRIVE = "DR",
  PLACE = "PL",
  COURT = "CT",
  LANE = "LN",
  WAY = "WAY",
  CIRCUIT = "CCT",
  CRESCENT = "CRES"
  // Add more as needed
}

export enum StreetSuffix {
  NORTH = "N",
  SOUTH = "S", 
  EAST = "E",
  WEST = "W",
  EXTENSION = "EXT",
  LOWER = "LWR",
  UPPER = "UPR"
}

export enum LocalityClass {
  SUBURB = "S",
  TOWN = "T",
  CITY = "C",
  DISTRICT = "D",
  NEIGHBOURHOOD = "N"
}

export enum CoordinatePrecision {
  PROPERTY = "PROPERTY",
  STREET = "STREET", 
  LOCALITY = "LOCALITY",
  REGION = "REGION"
}

export enum ReliabilityCode {
  HIGH = 1,
  MEDIUM = 2,
  LOW = 3
}

export enum ValidationStatus {
  VALID = "VALID",
  INVALID = "INVALID", 
  PARTIAL = "PARTIAL",
  PENDING = "PENDING"
}

export enum AddressLifecycleStatus {
  CURRENT = "CURRENT",
  RETIRED = "RETIRED",
  PROPOSED = "PROPOSED"
}

// API Request/Response types

export interface AddressSearchRequest {
  query: string;
  limit?: number;
  offset?: number;
  filters?: AddressSearchFilters;
}

export interface AddressSearchFilters {
  state?: StateCode;
  postcode?: string;
  locality?: string;
  street?: string;
  coordinates?: CoordinateFilter;
}

export interface CoordinateFilter {
  center: Coordinates;
  radius: number; // in meters
}

export interface AddressSearchResponse {
  results: GNAFAddress[];
  total: number;
  query: string;
  pagination: PaginationInfo;
  executionTime: number; // in milliseconds
}

export interface PaginationInfo {
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface AddressValidationRequest {
  address: string;
  strictMode?: boolean;
}

export interface AddressValidationResponse {
  isValid: boolean;
  matchedAddress?: GNAFAddress;
  suggestions: GNAFAddress[];
  issues: ValidationIssue[];
}

export interface ValidationIssue {
  type: ValidationIssueType;
  message: string;
  severity: IssueSeverity;
  component?: keyof AddressComponents;
}

export enum ValidationIssueType {
  MISSING_COMPONENT = "MISSING_COMPONENT",
  INVALID_FORMAT = "INVALID_FORMAT",
  AMBIGUOUS_MATCH = "AMBIGUOUS_MATCH",
  NOT_FOUND = "NOT_FOUND",
  DEPRECATED = "DEPRECATED"
}

export enum IssueSeverity {
  ERROR = "ERROR",
  WARNING = "WARNING", 
  INFO = "INFO"
}

export interface GeocodeRequest {
  address: string;
  includeComponents?: boolean;
}

export interface GeocodeResponse {
  address: string;
  coordinates: Coordinates;
  components?: AddressComponents;
  quality: AddressQuality;
}

export interface ReverseGeocodeRequest {
  coordinates: Coordinates;
  radius?: number;
  includeComponents?: boolean;
}

export interface ReverseGeocodeResponse {
  coordinates: Coordinates;
  nearestAddress: GNAFAddress;
  alternativeAddresses: GNAFAddress[];
}