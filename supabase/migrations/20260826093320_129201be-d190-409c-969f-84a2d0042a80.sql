
CREATE TABLE IF NOT EXISTS public.competitor_rate_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES public.competitor_properties(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  organization_slug text,
  stay_date date NOT NULL,
  rate numeric,
  currency text DEFAULT 'EUR',
  room_type text,
  occupancy integer DEFAULT 2,
  board text,
  refundable boolean,
  source_page_url text,
  raw_confidence numeric,
  model text,
  run_id uuid,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS competitor_rate_obs_lookup_idx
  ON public.competitor_rate_observations (competitor_id, stay_date, observed_at DESC);
CREATE INDEX IF NOT EXISTS competitor_rate_obs_hotel_idx
  ON public.competitor_rate_observations (hotel_id, stay_date);

GRANT SELECT ON public.competitor_rate_observations TO authenticated;
GRANT ALL ON public.competitor_rate_observations TO service_role;

ALTER TABLE public.competitor_rate_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Revenue users read competitor observations" ON public.competitor_rate_observations;
CREATE POLICY "Revenue users read competitor observations"
  ON public.competitor_rate_observations FOR SELECT TO authenticated
  USING (
    is_revenue_user(auth.uid())
    AND (organization_slug = get_user_organization_slug(auth.uid()))
    AND user_can_access_hotel(auth.uid(), hotel_id)
  );

-- Turn recent observations into one agreed price per night.
CREATE OR REPLACE FUNCTION public.reconcile_competitor_rates(
  _competitor_id uuid,
  _from date,
  _to date,
  _window_hours integer DEFAULT 96
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH recent AS (
    SELECT o.*
      FROM public.competitor_rate_observations o
     WHERE o.competitor_id = _competitor_id
       AND o.stay_date BETWEEN _from AND _to
       AND o.rate IS NOT NULL AND o.rate > 0
       AND o.observed_at >= now() - make_interval(hours => _window_hours)
  ),
  med AS (
    SELECT stay_date,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rate)::numeric AS med_rate
      FROM recent GROUP BY stay_date
  ),
  kept AS (
    -- Drop observations that disagree with the group by more than 15%.
    SELECT r.*, m.med_rate
      FROM recent r JOIN med m USING (stay_date)
     WHERE m.med_rate > 0
       AND abs(r.rate - m.med_rate) / m.med_rate <= 0.15
  ),
  agreed AS (
    SELECT k.stay_date,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY k.rate)::numeric, 0) AS rate,
           count(*)::int AS kept_n,
           (SELECT count(*) FROM recent r2 WHERE r2.stay_date = k.stay_date)::int AS total_n,
           avg(coalesce(k.raw_confidence, 0.6)) AS raw_conf,
           -- relative spread of the agreeing observations
           CASE WHEN avg(k.rate) > 0
                THEN (max(k.rate) - min(k.rate)) / avg(k.rate) ELSE 0 END AS spread,
           max(k.observed_at) AS observed_at,
           (array_agg(k.currency     ORDER BY k.observed_at DESC))[1] AS currency,
           (array_agg(k.room_type    ORDER BY k.observed_at DESC))[1] AS room_type,
           (array_agg(k.board        ORDER BY k.observed_at DESC))[1] AS board,
           (array_agg(k.refundable   ORDER BY k.observed_at DESC))[1] AS refundable,
           (array_agg(k.source_page_url ORDER BY k.observed_at DESC))[1] AS source_page_url,
           (array_agg(k.hotel_id     ORDER BY k.observed_at DESC))[1] AS hotel_id,
           (array_agg(k.organization_slug ORDER BY k.observed_at DESC))[1] AS organization_slug
      FROM kept k GROUP BY k.stay_date
  ),
  scored AS (
    SELECT a.*,
           greatest(0.05, least(0.99,
             a.raw_conf
             * (CASE WHEN a.kept_n >= 3 THEN 1.15 WHEN a.kept_n = 2 THEN 1.05 ELSE 0.85 END)
             * (a.kept_n::numeric / greatest(a.total_n, 1))          -- penalise disagreement
             * (1 - least(a.spread, 0.3))                            -- penalise wide spread
             * (CASE WHEN a.observed_at >= now() - interval '48 hours' THEN 1
                     WHEN a.observed_at >= now() - interval '7 days'   THEN 0.8
                     ELSE 0.55 END)                                   -- penalise stale
           )) AS confidence
      FROM agreed a
  ),
  upserted AS (
    INSERT INTO public.competitor_rates AS cr (
      competitor_id, hotel_id, organization_slug, stay_date, rate, rate_original,
      currency, currency_original, room_type, occupancy, board, refundable,
      source_page_url, confidence, source, captured_at
    )
    SELECT _competitor_id, s.hotel_id, s.organization_slug, s.stay_date, s.rate, s.rate,
           coalesce(s.currency, 'EUR'), coalesce(s.currency, 'EUR'), s.room_type, 2, s.board, s.refundable,
           s.source_page_url, round(s.confidence, 2), 'reconciled', s.observed_at
      FROM scored s
    ON CONFLICT (competitor_id, stay_date) DO UPDATE SET
      rate = EXCLUDED.rate,
      rate_original = EXCLUDED.rate_original,
      currency = EXCLUDED.currency,
      currency_original = EXCLUDED.currency_original,
      room_type = EXCLUDED.room_type,
      board = EXCLUDED.board,
      refundable = EXCLUDED.refundable,
      source_page_url = EXCLUDED.source_page_url,
      confidence = EXCLUDED.confidence,
      source = 'reconciled',
      captured_at = EXCLUDED.captured_at
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upserted;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_competitor_rates(uuid, date, date, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_competitor_rates(uuid, date, date, integer) TO service_role;

-- Market aggregate: only reliable, reasonably recent prices.
CREATE OR REPLACE FUNCTION public.market_rates_by_date(_hotel_id text, _from date, _to date, _max_age_hours integer DEFAULT 48)
 RETURNS TABLE(stay_date date, sample_size integer, avg_rate numeric, trimmed_avg_rate numeric, median_rate numeric, min_rate numeric, max_rate numeric, freshest_at timestamp with time zone, stale boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH fresh AS (
    SELECT r.stay_date, r.rate::numeric AS rate, r.captured_at
      FROM public.competitor_rates r
      JOIN public.competitor_properties c ON c.id = r.competitor_id AND c.active
     WHERE r.hotel_id = _hotel_id
       AND r.stay_date BETWEEN _from AND _to
       AND r.rate IS NOT NULL AND r.rate > 0
       AND (r.confidence IS NULL OR r.confidence >= 0.45)
       AND r.captured_at >= now() - interval '7 days'
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
$function$;
