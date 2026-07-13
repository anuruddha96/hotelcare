
-- 1) Admin-controlled hide toggle for the legacy PMS Upload page.
ALTER TABLE public.pms_configurations
  ADD COLUMN IF NOT EXISTS hide_pms_upload_page boolean NOT NULL DEFAULT false;

-- 2) Track who triggered each sync so the re-sync warning can name them.
ALTER TABLE public.pms_sync_history
  ADD COLUMN IF NOT EXISTS synced_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS synced_by_name text;

-- 3) Clear the stale manual override left on Room 203 (Hotel Ottofiori) from
-- yesterday's manual sync — user explicitly asked for it to be reset.
UPDATE public.rooms
SET pms_metadata = COALESCE(pms_metadata, '{}'::jsonb) - 'manual_checkout',
    updated_at   = now()
WHERE room_number = '203'
  AND hotel IN ('hotel-ottofiori','Hotel Ottofiori')
  AND (pms_metadata ? 'manual_checkout');
