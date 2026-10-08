-- Restore the PostgREST organization relationship required by HotelCare's
-- hotel_configurations?select=...,organizations!inner(...) queries.
-- Verified 2026-10-08: every existing configuration organization_id has
-- a matching organizations.id; nullable organization_id remains allowed.
CREATE INDEX IF NOT EXISTS idx_hotel_configurations_organization_id
  ON public.hotel_configurations (organization_id);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.hotel_configurations'::regclass
      AND conname = 'hotel_configurations_organization_id_fkey'
  ) THEN
    ALTER TABLE public.hotel_configurations
      ADD CONSTRAINT hotel_configurations_organization_id_fkey
      FOREIGN KEY (organization_id)
      REFERENCES public.organizations(id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END
$migration$;

COMMENT ON CONSTRAINT hotel_configurations_organization_id_fkey
  ON public.hotel_configurations IS
  'Tenant relationship used by secure organization-scoped PostgREST joins.';
