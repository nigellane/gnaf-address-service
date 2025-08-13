-- Rollback for performance optimization indexes migration
-- Version: 002
-- Description: Remove performance optimization indexes

-- Set search path
SET search_path TO gnaf, public, postgis;

-- Drop the performance indexes (in reverse order of creation)
DROP INDEX CONCURRENTLY IF EXISTS gnaf.idx_addresses_compound_lookup;
DROP INDEX CONCURRENTLY IF EXISTS gnaf.idx_addresses_number_first_lower;
DROP INDEX CONCURRENTLY IF EXISTS gnaf.idx_streets_name_lower;

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Migration 002 rollback: Performance indexes removed successfully';
    RAISE NOTICE 'Warning: Geocoding performance will degrade significantly without these indexes';
END $$;