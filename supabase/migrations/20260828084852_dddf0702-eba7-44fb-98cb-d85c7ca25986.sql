ALTER TABLE public.restaurant_reservations
  ADD COLUMN IF NOT EXISTS status_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_marked_by text,
  ADD COLUMN IF NOT EXISTS dashboard_sync_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS dashboard_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS dashboard_sync_error text;