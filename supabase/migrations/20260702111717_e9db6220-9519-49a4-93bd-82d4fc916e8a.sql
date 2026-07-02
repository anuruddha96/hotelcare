
-- SLNT dual-sync scaffolding on pms_configurations
ALTER TABLE public.pms_configurations
  ADD COLUMN IF NOT EXISTS sync_mode text NOT NULL DEFAULT 'manual_only',
  ADD COLUMN IF NOT EXISTS last_sync_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_sync_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS api_base_url text,
  ADD COLUMN IF NOT EXISTS api_auth_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pms_configurations_sync_mode_check'
  ) THEN
    ALTER TABLE public.pms_configurations
      ADD CONSTRAINT pms_configurations_sync_mode_check
      CHECK (sync_mode IN ('api_only','manual_only','api_with_manual_fallback'));
  END IF;
END $$;
