-- Rollback for 20261119110000_google_reputation_location_discovery.sql.
-- Listings already imported by automatic discovery are kept: they are ordinary
-- google_business_locations rows, identical to manually discovered ones.

alter table public.google_business_connections
  drop column if exists location_discovery_checked_at;
