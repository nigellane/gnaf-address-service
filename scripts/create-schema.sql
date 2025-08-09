-- G-NAF Database Schema with Spatial Indexing
-- Based on Australian Government G-NAF dataset structure

-- Ensure we're in the gnaf schema
SET search_path TO gnaf, public, postgis;

-- Drop tables if they exist (for development)
DROP TABLE IF EXISTS gnaf.addresses CASCADE;
DROP TABLE IF EXISTS gnaf.localities CASCADE;
DROP TABLE IF EXISTS gnaf.streets CASCADE;
DROP TABLE IF EXISTS gnaf.states CASCADE;

-- States reference table
CREATE TABLE gnaf.states (
    state_code CHAR(3) PRIMARY KEY,
    state_name VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert Australian states
INSERT INTO gnaf.states (state_code, state_name) VALUES
    ('NSW', 'New South Wales'),
    ('VIC', 'Victoria'),
    ('QLD', 'Queensland'),
    ('SA', 'South Australia'),
    ('WA', 'Western Australia'),
    ('TAS', 'Tasmania'),
    ('NT', 'Northern Territory'),
    ('ACT', 'Australian Capital Territory');

-- Localities table (suburbs, towns, cities)
CREATE TABLE gnaf.localities (
    locality_pid VARCHAR(15) PRIMARY KEY,
    locality_name VARCHAR(100) NOT NULL,
    locality_class CHAR(1) NOT NULL, -- S=Suburb, T=Town, C=City, D=District, N=Neighbourhood
    state_code CHAR(3) NOT NULL REFERENCES gnaf.states(state_code),
    postcode CHAR(4),
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    geometry GEOMETRY(POINT, 4326), -- GDA2020 / WGS84
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Streets table
CREATE TABLE gnaf.streets (
    street_locality_pid VARCHAR(15) PRIMARY KEY,
    street_name VARCHAR(100) NOT NULL,
    street_type VARCHAR(15), -- ST, RD, AVE, DR, etc.
    street_suffix VARCHAR(10), -- N, S, E, W, EXT, etc.
    locality_pid VARCHAR(15) NOT NULL REFERENCES gnaf.localities(locality_pid),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Main addresses table - optimized for G-NAF dataset
CREATE TABLE gnaf.addresses (
    -- Primary identifiers
    address_detail_pid VARCHAR(15) PRIMARY KEY,
    gnaf_pid VARCHAR(15) UNIQUE NOT NULL,
    
    -- Address components
    building_name VARCHAR(100),
    lot_number VARCHAR(20),
    flat_type VARCHAR(10),
    flat_number VARCHAR(20),
    number_first VARCHAR(20),
    number_last VARCHAR(20),
    
    -- Street reference
    street_locality_pid VARCHAR(15) REFERENCES gnaf.streets(street_locality_pid),
    
    -- Locality reference  
    locality_pid VARCHAR(15) NOT NULL REFERENCES gnaf.localities(locality_pid),
    
    -- Address formatting
    address_line VARCHAR(500) NOT NULL,
    formatted_address TEXT NOT NULL,
    
    -- Geographic data
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    geometry GEOMETRY(POINT, 4326) NOT NULL, -- Spatial column for PostGIS
    
    -- Coordinate quality
    coordinate_precision VARCHAR(20) NOT NULL, -- PROPERTY, STREET, LOCALITY, REGION
    coordinate_reliability INTEGER NOT NULL CHECK (coordinate_reliability IN (1, 2, 3)), -- 1=High, 2=Medium, 3=Low
    coordinate_crs VARCHAR(20) DEFAULT 'GDA2020',
    
    -- Address quality metrics
    confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
    completeness_score INTEGER CHECK (completeness_score >= 0 AND completeness_score <= 100),
    validation_status VARCHAR(20) DEFAULT 'PENDING' CHECK (validation_status IN ('VALID', 'INVALID', 'PARTIAL', 'PENDING')),
    
    -- Administrative boundaries
    lga_code VARCHAR(10),
    lga_name VARCHAR(100),
    federal_electorate VARCHAR(50),
    state_electorate VARCHAR(50),
    statistical_area_1 VARCHAR(20),
    statistical_area_2 VARCHAR(20),
    statistical_area_3 VARCHAR(20),
    statistical_area_4 VARCHAR(20),
    
    -- Legal and lifecycle
    legal_parcel_id VARCHAR(50),
    address_status VARCHAR(20) DEFAULT 'CURRENT' CHECK (address_status IN ('CURRENT', 'RETIRED', 'PROPOSED')),
    
    -- G-NAF metadata
    gnaf_date_created DATE NOT NULL,
    gnaf_date_last_modified DATE,
    gnaf_date_retired DATE,
    
    -- Search optimization - full-text search vector
    search_vector TSVECTOR,
    
    -- Audit fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Import metadata
    import_batch_id UUID,
    data_quality_flags TEXT[],
    
    CONSTRAINT valid_coordinates CHECK (
        latitude BETWEEN -45.0 AND -10.0 AND 
        longitude BETWEEN 110.0 AND 155.0
    )
);

-- Create spatial index on geometry column (critical for performance)
CREATE INDEX idx_addresses_geometry ON gnaf.addresses USING GIST (geometry);

-- Create spatial index on locality geometry
CREATE INDEX idx_localities_geometry ON gnaf.localities USING GIST (geometry);

-- Standard indexes for common queries
CREATE INDEX idx_addresses_postcode ON gnaf.addresses USING BTREE ((SELECT postcode FROM gnaf.localities WHERE locality_pid = addresses.locality_pid));
CREATE INDEX idx_addresses_locality ON gnaf.addresses (locality_pid);
CREATE INDEX idx_addresses_street ON gnaf.addresses (street_locality_pid);
CREATE INDEX idx_addresses_gnaf_pid ON gnaf.addresses (gnaf_pid);
CREATE INDEX idx_addresses_status ON gnaf.addresses (address_status) WHERE address_status = 'CURRENT';

-- Full-text search index using GIN for address search
CREATE INDEX idx_addresses_search_vector ON gnaf.addresses USING GIN (search_vector);

-- Composite indexes for common search patterns
CREATE INDEX idx_addresses_locality_street ON gnaf.addresses (locality_pid, street_locality_pid);
CREATE INDEX idx_addresses_coords ON gnaf.addresses (latitude, longitude);

-- Performance indexes
CREATE INDEX idx_addresses_confidence ON gnaf.addresses (confidence_score) WHERE confidence_score >= 80;
CREATE INDEX idx_addresses_import_batch ON gnaf.addresses (import_batch_id);

-- Create function to update search vector automatically
CREATE OR REPLACE FUNCTION update_address_search_vector() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('english', COALESCE(NEW.formatted_address, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.building_name, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(
            (SELECT locality_name FROM gnaf.localities WHERE locality_pid = NEW.locality_pid), ''
        )), 'C') ||
        setweight(to_tsvector('english', COALESCE(
            (SELECT street_name FROM gnaf.streets WHERE street_locality_pid = NEW.street_locality_pid), ''
        )), 'C');
    
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update search vector
CREATE TRIGGER trg_update_address_search_vector
    BEFORE INSERT OR UPDATE ON gnaf.addresses
    FOR EACH ROW EXECUTE FUNCTION update_address_search_vector();

-- Create function to update geometry from lat/lng
CREATE OR REPLACE FUNCTION update_address_geometry() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.geometry := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update geometry
CREATE TRIGGER trg_update_address_geometry
    BEFORE INSERT OR UPDATE ON gnaf.addresses
    FOR EACH ROW EXECUTE FUNCTION update_address_geometry();

-- Create similar trigger for localities
CREATE TRIGGER trg_update_locality_geometry
    BEFORE INSERT OR UPDATE ON gnaf.localities
    FOR EACH ROW EXECUTE FUNCTION update_address_geometry();

-- Views for common queries

-- Current addresses view (excludes retired addresses)
CREATE VIEW gnaf.current_addresses AS
SELECT 
    a.*,
    l.locality_name,
    l.postcode,
    s.street_name,
    s.street_type,
    s.street_suffix
FROM gnaf.addresses a
LEFT JOIN gnaf.localities l ON a.locality_pid = l.locality_pid
LEFT JOIN gnaf.streets s ON a.street_locality_pid = s.street_locality_pid
WHERE a.address_status = 'CURRENT';

-- High confidence addresses view
CREATE VIEW gnaf.high_confidence_addresses AS
SELECT * FROM gnaf.current_addresses
WHERE confidence_score >= 80;

-- Create materialized view for address statistics (updated during imports)
CREATE MATERIALIZED VIEW gnaf.address_statistics AS
SELECT 
    l.state_code,
    l.locality_name,
    COUNT(*) as total_addresses,
    COUNT(*) FILTER (WHERE a.address_status = 'CURRENT') as current_addresses,
    COUNT(*) FILTER (WHERE a.confidence_score >= 80) as high_confidence_addresses,
    AVG(a.confidence_score) as avg_confidence_score,
    AVG(a.completeness_score) as avg_completeness_score,
    MIN(a.gnaf_date_created) as oldest_address,
    MAX(a.gnaf_date_created) as newest_address
FROM gnaf.addresses a
JOIN gnaf.localities l ON a.locality_pid = l.locality_pid
GROUP BY l.state_code, l.locality_name;

-- Create index on materialized view
CREATE INDEX idx_address_statistics_state ON gnaf.address_statistics (state_code);

-- Grant permissions for application user (if needed)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA gnaf TO gnaf_app_user;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA gnaf TO gnaf_app_user;

-- Performance monitoring function
CREATE OR REPLACE FUNCTION gnaf.get_table_stats()
RETURNS TABLE (
    table_name TEXT,
    row_count BIGINT,
    table_size TEXT,
    index_size TEXT,
    total_size TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        schemaname||'.'||tablename as table_name,
        n_tup_ins - n_tup_del as row_count,
        pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
        pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) as index_size,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size
    FROM pg_stat_user_tables 
    WHERE schemaname = 'gnaf'
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
END;
$$ LANGUAGE plpgsql;

-- Vacuum and analyze for optimal performance after bulk import
-- These will be run by the import scripts
-- VACUUM ANALYZE gnaf.addresses;
-- VACUUM ANALYZE gnaf.localities; 
-- VACUUM ANALYZE gnaf.streets;

COMMIT;