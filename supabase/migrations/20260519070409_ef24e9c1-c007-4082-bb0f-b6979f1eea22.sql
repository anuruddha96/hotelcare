ALTER TABLE public.daily_overview_snapshots
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS daily_overview_snapshots_unique_row
  ON public.daily_overview_snapshots (hotel_id, business_date, room_label, source);

CREATE INDEX IF NOT EXISTS idx_daily_overview_hotel_date
  ON public.daily_overview_snapshots (hotel_id, business_date);