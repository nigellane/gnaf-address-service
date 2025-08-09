-- Initial G-NAF schema migration
-- Version: 001
-- Description: Create initial schema with PostGIS support and G-NAF tables

-- Ensure PostGIS extension is available
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- Create gnaf schema if not exists
CREATE SCHEMA IF NOT EXISTS gnaf;

-- Set search path
SET search_path TO gnaf, public, postgis;

-- Migration completed successfully
SELECT 'Initial schema migration completed' as status;