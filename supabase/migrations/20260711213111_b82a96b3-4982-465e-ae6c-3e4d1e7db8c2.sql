
-- =====================================================================
-- Phase A / Commit 1 — Previo multi-tenant schema (no behavior change)
-- =====================================================================

-- 1. pms_configurations: per-hotel environment + independent feature flags
ALTER TABLE public.pms_configurations
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'test',
  ADD COLUMN IF NOT EXISTS connection_test_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS room_discovery_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS room_import_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS snapshot_read_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS snapshot_shadow_mode    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS status_push_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checkout_poll_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nightly_sync_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS outbound_kill_switch    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS outbound_room_allowlist uuid[] NULL,
  ADD COLUMN IF NOT EXISTS last_connection_test_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_connection_test_status text NULL,
  ADD COLUMN IF NOT EXISTS last_connection_test_error  text NULL,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS activated_by uuid NULL;

-- Environment must be one of the two known values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pms_configurations_environment_check'
  ) THEN
    ALTER TABLE public.pms_configurations
      ADD CONSTRAINT pms_configurations_environment_check
      CHECK (environment IN ('test','live'));
  END IF;
END$$;

-- Backfill: keep previo-test working exactly as it does today.
UPDATE public.pms_configurations
   SET environment           = 'test',
       connection_test_enabled = true,
       room_discovery_enabled  = true,
       room_import_enabled     = true,
       snapshot_read_enabled   = true,
       snapshot_shadow_mode    = false,
       status_push_enabled     = true,
       checkout_poll_enabled   = COALESCE(checkout_poll_enabled, false),
       nightly_sync_enabled    = COALESCE(nightly_sync_enabled, false)
 WHERE hotel_id = 'previo-test'
   AND pms_type = 'previo';

-- 2. pms_room_mappings: link to physical room UUID + mapping lifecycle
ALTER TABLE public.pms_room_mappings
  ADD COLUMN IF NOT EXISTS hotelcare_room_id uuid NULL REFERENCES public.rooms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mapping_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS confidence numeric NULL,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS notes text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pms_room_mappings_status_check'
  ) THEN
    ALTER TABLE public.pms_room_mappings
      ADD CONSTRAINT pms_room_mappings_status_check
      CHECK (mapping_status IN ('pending','active','ignored','error'));
  END IF;
END$$;

-- One physical Previo room -> at most one active HotelCare mapping per config
CREATE UNIQUE INDEX IF NOT EXISTS pms_room_mappings_active_pms_room_uidx
  ON public.pms_room_mappings (pms_config_id, pms_room_id)
  WHERE mapping_status = 'active';

-- One HotelCare room -> at most one active mapping per config
CREATE UNIQUE INDEX IF NOT EXISTS pms_room_mappings_active_hc_room_uidx
  ON public.pms_room_mappings (pms_config_id, hotelcare_room_id)
  WHERE mapping_status = 'active' AND hotelcare_room_id IS NOT NULL;
