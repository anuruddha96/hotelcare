ALTER TABLE public.competitor_rates
  ADD COLUMN IF NOT EXISTS room_type text,
  ADD COLUMN IF NOT EXISTS occupancy integer DEFAULT 2,
  ADD COLUMN IF NOT EXISTS board text,
  ADD COLUMN IF NOT EXISTS refundable boolean,
  ADD COLUMN IF NOT EXISTS source_page_url text,
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS rate_original numeric,
  ADD COLUMN IF NOT EXISTS currency_original text;

CREATE TABLE IF NOT EXISTS public.competitor_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  competitor_id uuid REFERENCES public.competitor_properties(id) ON DELETE CASCADE,
  window_from date,
  window_to date,
  dates_requested integer NOT NULL DEFAULT 0,
  prices_found integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  error text,
  model text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

GRANT SELECT ON public.competitor_scan_runs TO authenticated;
GRANT ALL ON public.competitor_scan_runs TO service_role;
ALTER TABLE public.competitor_scan_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Revenue users read scan runs" ON public.competitor_scan_runs;
CREATE POLICY "Revenue users read scan runs"
  ON public.competitor_scan_runs FOR SELECT TO authenticated
  USING (public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE INDEX IF NOT EXISTS competitor_scan_runs_hotel_started_idx
  ON public.competitor_scan_runs (hotel_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.competitor_scan_lease (
  id text PRIMARY KEY,
  locked_until timestamptz NOT NULL,
  paused_until timestamptz,
  pause_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.competitor_scan_lease TO service_role;
ALTER TABLE public.competitor_scan_lease ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_competitor_scan_lease(_id text, _minutes integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ok boolean;
BEGIN
  INSERT INTO public.competitor_scan_lease (id, locked_until)
  VALUES (_id, now() + make_interval(mins => _minutes))
  ON CONFLICT (id) DO UPDATE
    SET locked_until = EXCLUDED.locked_until, updated_at = now()
    WHERE public.competitor_scan_lease.locked_until < now()
      AND (public.competitor_scan_lease.paused_until IS NULL
           OR public.competitor_scan_lease.paused_until < now())
  RETURNING true INTO ok;
  RETURN COALESCE(ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_competitor_scan_lease(_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.competitor_scan_lease
     SET locked_until = now() - interval '1 second', updated_at = now()
   WHERE id = _id;
$$;

CREATE OR REPLACE FUNCTION public.pause_competitor_scan(_id text, _minutes integer, _reason text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.competitor_scan_lease (id, locked_until, paused_until, pause_reason)
  VALUES (_id, now(), now() + make_interval(mins => _minutes), _reason)
  ON CONFLICT (id) DO UPDATE
    SET paused_until = EXCLUDED.paused_until,
        pause_reason = EXCLUDED.pause_reason,
        locked_until = now() - interval '1 second',
        updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public.market_rates_by_date(
  _hotel_id text, _from date, _to date, _max_age_hours integer DEFAULT 48
)
RETURNS TABLE (
  stay_date date,
  sample_size integer,
  avg_rate numeric,
  trimmed_avg_rate numeric,
  median_rate numeric,
  min_rate numeric,
  max_rate numeric,
  freshest_at timestamptz,
  stale boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH fresh AS (
    SELECT r.stay_date, r.rate::numeric AS rate, r.captured_at
      FROM public.competitor_rates r
      JOIN public.competitor_properties c ON c.id = r.competitor_id AND c.active
     WHERE r.hotel_id = _hotel_id
       AND r.stay_date BETWEEN _from AND _to
       AND r.rate IS NOT NULL AND r.rate > 0
       AND (r.confidence IS NULL OR r.confidence >= 0.4)
       AND public.user_can_access_hotel(auth.uid(), _hotel_id)
  ),
  ranked AS (
    SELECT f.*,
           row_number() OVER (PARTITION BY f.stay_date ORDER BY f.rate) AS rn,
           count(*)     OVER (PARTITION BY f.stay_date)                 AS n
      FROM fresh f
  )
  SELECT r.stay_date,
         max(r.n)::integer AS sample_size,
         round(avg(r.rate), 0) AS avg_rate,
         round(avg(r.rate) FILTER (WHERE r.n < 4 OR (r.rn > 1 AND r.rn < r.n)), 0) AS trimmed_avg_rate,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.rate)::numeric, 0) AS median_rate,
         min(r.rate) AS min_rate,
         max(r.rate) AS max_rate,
         max(r.captured_at) AS freshest_at,
         (max(r.captured_at) < now() - make_interval(hours => _max_age_hours)) AS stale
    FROM ranked r
   GROUP BY r.stay_date
   ORDER BY r.stay_date;
$$;

GRANT EXECUTE ON FUNCTION public.market_rates_by_date(text, date, date, integer) TO authenticated;