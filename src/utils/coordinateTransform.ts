export interface CoordinatePoint {
  latitude: number;
  longitude: number;
}

export interface TransformOptions {
  fromSystem: 'WGS84' | 'GDA2020';
  toSystem: 'WGS84' | 'GDA2020';
}

export class CoordinateTransformService {
  validateCoordinates(coords: CoordinatePoint, system: 'WGS84' | 'GDA2020' = 'WGS84'): boolean {
    const { latitude, longitude } = coords;
    
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return false;
    }
    
    if (isNaN(latitude) || isNaN(longitude)) {
      return false;
    }
    
    if (latitude < -90 || latitude > 90) {
      return false;
    }
    
    if (longitude < -180 || longitude > 180) {
      return false;
    }
    
    if (system === 'GDA2020' || system === 'WGS84') {
      const isAustralianBounds = 
        latitude >= -43.7 && latitude <= -9.0 &&
        longitude >= 112.0 && longitude <= 154.0;
      
      if (!isAustralianBounds) {
        return false;
      }
    }
    
    return true;
  }

  validateCoordinateSystem(system: string): system is 'WGS84' | 'GDA2020' {
    return system === 'WGS84' || system === 'GDA2020';
  }

  getEpsgCode(system: 'WGS84' | 'GDA2020'): number {
    switch (system) {
      case 'WGS84':
        return 4326;
      case 'GDA2020':
        return 7855;
      default:
        throw new Error(`Unsupported coordinate system: ${system}`);
    }
  }

  async transformCoordinates(
    coords: CoordinatePoint, 
    options: TransformOptions
  ): Promise<CoordinatePoint> {
    if (!this.validateCoordinates(coords, options.fromSystem)) {
      throw new Error(`Invalid coordinates for ${options.fromSystem} system`);
    }
    
    if (options.fromSystem === options.toSystem) {
      return coords;
    }
    
    // TODO: Implement real coordinate transformation using PostGIS ST_Transform
    // For now, returning input coordinates as WGS84 and GDA2020 are very close for Australian coordinates
    // In production, this should use: SELECT ST_Transform(ST_SetSRID(ST_MakePoint(lng, lat), fromEPSG), toEPSG)
    return coords;
  }

  calculateDistance(point1: CoordinatePoint, point2: CoordinatePoint): { meters: number; kilometers: number } {
    const R = 6371e3;
    const φ1 = point1.latitude * Math.PI / 180;
    const φ2 = point2.latitude * Math.PI / 180;
    const Δφ = (point2.latitude - point1.latitude) * Math.PI / 180;
    const Δλ = (point2.longitude - point1.longitude) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    const meters = R * c;
    
    return {
      meters: Math.round(meters * 100) / 100,
      kilometers: Math.round(meters / 10) / 100
    };
  }

  calculateBearing(point1: CoordinatePoint, point2: CoordinatePoint): number {
    const φ1 = point1.latitude * Math.PI / 180;
    const φ2 = point2.latitude * Math.PI / 180;
    const Δλ = (point2.longitude - point1.longitude) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    const θ = Math.atan2(y, x);
    const bearing = (θ * 180 / Math.PI + 360) % 360;

    return Math.round(bearing * 100) / 100;
  }
}

const coordinateTransformService = new CoordinateTransformService();
export default coordinateTransformService;