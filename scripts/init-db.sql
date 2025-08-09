-- Initialize G-NAF database with PostGIS
-- This runs automatically in Docker container

-- Ensure user and database exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'gnaf_user') THEN
        CREATE USER gnaf_user WITH PASSWORD 'gnaf_password';
    END IF;
END
$$;

-- Grant privileges
ALTER USER gnaf_user CREATEDB;
GRANT ALL PRIVILEGES ON DATABASE gnaf_db TO gnaf_user;

-- Install PostGIS extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder;

-- Grant schema permissions
GRANT ALL ON SCHEMA public TO gnaf_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO gnaf_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO gnaf_user;