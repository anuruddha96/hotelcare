ALTER TABLE public.revenue_daily_snapshots
  ADD COLUMN IF NOT EXISTS captured_at timestamptz;

UPDATE public.revenue_daily_snapshots
SET captured_at = COALESCE(captured_at, created_at, captured_date::timestamptz)
WHERE captured_at IS NULL;

ALTER TABLE public.revenue_daily_snapshots
  ALTER COLUMN captured_at SET DEFAULT now(),
  ALTER COLUMN captured_at SET NOT NULL;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'revenue_daily_snapshots'
    AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) ILIKE '%hotel_id%stay_date%captured_date%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.revenue_daily_snapshots DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS revenue_daily_snapshots_capture_uidx
  ON public.revenue_daily_snapshots (hotel_id, stay_date, captured_at);

CREATE INDEX IF NOT EXISTS revenue_daily_snapshots_pickup_lookup_idx
  ON public.revenue_daily_snapshots (hotel_id, stay_date, captured_at DESC);