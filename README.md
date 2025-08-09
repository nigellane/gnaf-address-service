# G-NAF Address Service

A standalone microservice providing comprehensive Australian address validation, geocoding, and spatial services using the Government's G-NAF (Geocoded National Address File) dataset.

## Overview

This service was extracted from Epic 2d of the Real Estate Commission System to provide:
- Government-standard Australian address validation
- Geocoding and reverse geocoding services
- Spatial queries and location analytics
- G-NAF dataset management and updates
- RESTful API for integration with client applications

## Architecture

### Technology Stack
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js or Fastify for high-performance API
- **Database**: PostgreSQL with PostGIS extension for spatial data
- **G-NAF Dataset**: ~13GB government address dataset
- **Caching**: Redis for high-performance address lookups
- **Monitoring**: Prometheus metrics and health checks

### Key Features
- **Address Validation**: Real-time validation against G-NAF standards
- **Geocoding**: Convert addresses to coordinates with confidence scoring
- **Reverse Geocoding**: Convert coordinates to structured addresses
- **Spatial Queries**: Proximity searches and geographic analysis
- **Quarterly Updates**: Automated G-NAF dataset refresh pipeline
- **Multi-tenant Ready**: Isolated caching and analytics per client

## API Endpoints

### Core Address Services
```
POST   /api/v1/addresses/validate
GET    /api/v1/addresses/search?q={query}
POST   /api/v1/addresses/geocode
POST   /api/v1/addresses/reverse-geocode
GET    /api/v1/addresses/{gnaf_pid}
```

### Analytics & Insights
```
GET    /api/v1/analytics/coverage
GET    /api/v1/analytics/quality-metrics
POST   /api/v1/analytics/batch-validate
```

### System Management
```
GET    /api/v1/health
GET    /api/v1/status/dataset
POST   /api/v1/admin/dataset-refresh
```

## Integration with Real Estate Commission System

This service replaces the monolithic Epic 2d implementation with a focused microservice approach:

1. **Property Creation**: Commission system calls address validation API
2. **Address Standardization**: Automatic normalization of property addresses
3. **Geocoding Integration**: Enhanced property location data for analytics
4. **Performance**: <300ms response times with sophisticated caching

## Getting Started

### Prerequisites
- Node.js 20+ with TypeScript
- PostgreSQL 15+ with PostGIS extension
- Redis for caching
- G-NAF dataset license and download access

### Quick Start
```bash
# Install dependencies
npm install

# Set up database and PostGIS
npm run db:setup

# Download and process G-NAF dataset
npm run gnaf:download
npm run gnaf:import

# Start development server
npm run dev
```

### Environment Variables
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/gnaf_service
REDIS_URL=redis://localhost:6379
GNAF_DATASET_PATH=/data/gnaf
API_PORT=3001
LOG_LEVEL=info
```

## Development Roadmap

### Phase 1: Core Infrastructure
- [x] Project setup and architecture
- [ ] PostgreSQL + PostGIS database setup
- [ ] G-NAF dataset import pipeline
- [ ] Basic address validation API
- [ ] Redis caching layer

### Phase 2: Advanced Features
- [ ] Geocoding and reverse geocoding
- [ ] Spatial query engine
- [ ] Quarterly update automation
- [ ] Performance optimization
- [ ] Comprehensive testing

### Phase 3: Production Ready
- [ ] Monitoring and alerting
- [ ] API documentation
- [ ] Load testing and scaling
- [ ] Security hardening
- [ ] CI/CD pipeline

## Performance Targets

- **Address Validation**: <300ms response time
- **Address Search**: <500ms for complex queries
- **Geocoding**: <200ms per address
- **Batch Processing**: 1000+ addresses per minute
- **Availability**: 99.9% uptime with graceful degradation

## Contributing

This service follows the architectural patterns established in the Real Estate Commission System:
- TypeScript for type safety
- Comprehensive testing with Jest
- OpenAPI/Swagger documentation
- Structured logging and monitoring

## License

This project uses the G-NAF dataset under the Australian Government's CC BY 4.0 license.

---

## Related Projects

- **Real Estate Commission System**: Primary consumer of this service
- **Epic 2d Documentation**: `/projects/gnaf-address-service/docs/epic-2d-comprehensive-gnaf-system.md`