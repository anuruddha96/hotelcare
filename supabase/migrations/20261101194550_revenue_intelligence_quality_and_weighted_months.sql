-- Read-only quality and weighted monthly analytics over the EXISTING compact nightly archive.
-- No sync calls or price edits; views run only when explicitly queried.
-- Security invoker is essential to retain each hotel's existing RLS checks.
CREATE OR REPLACE VIEW public.revenue_intelligence_daily_quality
WITH (security_invoker = true)
AS
WITH assessed AS (
 SELECT a.hotel_id, a.organization_slug, a.stay_date,
   a.rooms_sold, a.rooms_available, a.occupancy_pct,
   a.revenue_eur AS revenue_amount_raw,
   a.adr_eur AS adr_amount_raw,
   a.revpar_eur AS revpar_amount_raw,
   a.captured_at AS source_captured_at,
   COALESCE(s.base_currency,'UNKNOWN') AS reported_currency,
   jsonb_array_length(a.events) AS recorded_event_count,
   jsonb_array_length(a.rates) AS recorded_rate_cells,
   array_remove(ARRAY[
     CASE WHEN a.rooms_sold IS NULL OR a.rooms_available IS NULL
       OR a.occupancy_pct IS NULL OR a.revenue_eur IS NULL
       OR a.adr_eur IS NULL OR a.revpar_eur IS NULL
       OR a.captured_at IS NULL THEN 'missing_kpis' END,
     CASE WHEN a.rooms_sold < 0 OR a.rooms_available <= 0
       OR a.revenue_eur < 0 OR a.adr_eur < 0
       OR a.revpar_eur < 0 THEN 'invalid_measure' END,
     CASE WHEN a.rooms_sold > a.rooms_available
       THEN 'over_capacity_needs_reconciliation' END,
     CASE WHEN a.rooms_available > 0 AND a.occupancy_pct IS NOT NULL
       AND ABS(a.occupancy_pct - (100.0*a.rooms_sold/a.rooms_available)) > 2
       THEN 'occupancy_not_reconciled' END,
     CASE WHEN a.rooms_sold > 0 AND a.adr_eur IS NOT NULL
       AND a.revenue_eur IS NOT NULL
       AND ABS(a.revenue_eur / a.rooms_sold - a.adr_eur)
         > GREATEST(2::numeric, a.adr_eur * 0.05)
       THEN 'adr_not_reconciled' END,
     CASE WHEN a.rooms_available > 0 AND a.revpar_eur IS NOT NULL
       AND a.revenue_eur IS NOT NULL
       AND ABS(a.revenue_eur / a.rooms_available - a.revpar_eur)
         > GREATEST(2::numeric, a.revpar_eur * 0.05)
       THEN 'revpar_not_reconciled' END,
     CASE WHEN a.rooms_sold > 0 AND a.revenue_eur = 0
       THEN 'sold_rooms_zero_revenue' END,
     -- Legacy *_eur column names are NOT enough proof that source currency is EUR.
     -- E.g. SLNT has HUF base currency; never silently convert or relabel those values.
     CASE WHEN COALESCE(s.base_currency,'UNKNOWN') <> 'EUR'
       THEN 'currency_unit_requires_verification' END,
     CASE WHEN COALESCE(s.base_currency,'UNKNOWN') = 'EUR'
       AND a.adr_eur > COALESCE(s.rate_max_sane_eur, 2000)
       THEN 'adr_above_property_safety_ceiling' END
   ], NULL)::text[] AS quality_flags
 FROM public.revenue_calendar_history_archive a
 LEFT JOIN public.hotel_revenue_settings s ON s.hotel_id = a.hotel_id
)
SELECT *,
  CASE
    WHEN 'missing_kpis' = ANY(quality_flags) THEN 'missing'
    WHEN cardinality(quality_flags) > 0 THEN 'needs_review'
    ELSE 'provisional'
  END AS quality_status,
  FALSE AS approved_for_automated_training
FROM assessed;

REVOKE ALL ON public.revenue_intelligence_daily_quality FROM PUBLIC, anon;
GRANT SELECT ON public.revenue_intelligence_daily_quality TO authenticated;
COMMENT ON VIEW public.revenue_intelligence_daily_quality IS
'Non-authoritative daily quality assessment. Provisional is not final/PMS-verified. No rows are approved for automated training. Source amounts are not converted.';

CREATE OR REPLACE VIEW public.revenue_intelligence_monthly
WITH (security_invoker = true)
AS
WITH dated AS (
 SELECT *,
   date_trunc('month', stay_date)::date AS month_start
 FROM public.revenue_intelligence_daily_quality
), rolled AS (
 SELECT hotel_id, organization_slug, month_start, reported_currency,
   COUNT(*)::integer AS archived_days,
   COUNT(*) FILTER (WHERE quality_status = 'provisional')::integer AS provisional_days,
   COUNT(*) FILTER (WHERE quality_status = 'needs_review')::integer AS review_days,
   COUNT(*) FILTER (WHERE quality_status = 'missing')::integer AS missing_days,
   SUM(COALESCE(recorded_event_count,0))::integer AS recorded_event_day_mentions,
   -- Sum of all source values is audit-only. Never feed unreviewed values into automation.
   ROUND(SUM(revenue_amount_raw), 2) AS raw_room_revenue_audit_only,
   SUM(rooms_sold) AS raw_sold_nights_audit_only,
   SUM(rooms_available) AS raw_available_nights_audit_only,
   SUM(rooms_sold) FILTER (WHERE quality_status = 'provisional') AS provisional_sold_room_nights,
   SUM(rooms_available) FILTER (WHERE quality_status = 'provisional') AS provisional_available_room_nights,
   SUM(revenue_amount_raw) FILTER (WHERE quality_status = 'provisional') AS provisional_revenue
 FROM dated
 GROUP BY hotel_id, organization_slug, month_start, reported_currency
)
SELECT hotel_id, organization_slug, month_start, reported_currency,
 archived_days, provisional_days, review_days, missing_days,
 EXTRACT(day FROM (month_start + interval '1 month' - interval '1 day'))::integer
   AS calendar_days_in_month,
 archived_days = EXTRACT(day FROM (month_start + interval '1 month' - interval '1 day'))::integer
   AS all_calendar_dates_present,
 recorded_event_day_mentions,
 raw_room_revenue_audit_only, raw_sold_nights_audit_only, raw_available_nights_audit_only,
 ROUND(provisional_revenue,2) AS provisional_revenue,
 provisional_sold_room_nights, provisional_available_room_nights,
 ROUND(100.0 * provisional_sold_room_nights
       / NULLIF(provisional_available_room_nights,0),2) AS provisional_weighted_occupancy_pct,
 ROUND(provisional_revenue / NULLIF(provisional_sold_room_nights,0),2)
   AS provisional_weighted_adr,
 ROUND(provisional_revenue / NULLIF(provisional_available_room_nights,0),2)
   AS provisional_weighted_revpar,
 (review_days = 0 AND missing_days = 0 AND
  provisional_days = EXTRACT(day FROM (month_start + interval '1 month' - interval '1 day'))::integer)
   AS complete_provisional_month,
 FALSE AS approved_for_automated_training
FROM rolled;

REVOKE ALL ON public.revenue_intelligence_monthly FROM PUBLIC, anon;
GRANT SELECT ON public.revenue_intelligence_monthly TO authenticated;
COMMENT ON VIEW public.revenue_intelligence_monthly IS
'RLS-scoped on-demand weighted monthly figures. Excludes flagged/missing source days from provisional KPIs. Incomplete months and currency units are explicit; not approved for auto-pricing.';
