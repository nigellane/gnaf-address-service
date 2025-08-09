-- Rollback for initial schema migration
-- Version: 001
-- Description: Remove initial schema (WARNING: This will drop all G-NAF data)

-- Drop schema and all its contents
DROP SCHEMA IF EXISTS gnaf CASCADE;

SELECT 'Initial schema rollback completed' as status;