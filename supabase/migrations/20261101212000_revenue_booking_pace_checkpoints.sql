-- Historical booking-pace checkpoints for comparable D-90/D-60/D-30/D-14/D-7/D-3/D-1/D-0
-- from the pre-existing per-stay-date observations. Read-only and no new storage.
CREATE OR REPLACE VIEW public.revenue_intelligence_pace_checkpoints
WITH (security_invoker = true)
AS
SELECT h.hotel_id,h.organization_slug,
 h.stay_date,h.observed_date,h.lead_days,
 h.rooms_sold AS on_books_room_nights,h.rooms_available AS available_room_nights,
 h.occupancy_pct AS recorded_on_books_occupancy_pct,
 h.revenue_eur AS recorded_on_books_revenue_raw,
 h.adr_eur AS recorded_on_books_adr_raw,
 h.revpar_eur AS recorded_on_books_revpar_raw,
 COALESCE(s.base_currency,'UNKNOWN') AS reported_currency,
 h.captured_at AS source_captured_at,
 CASE
   WHEN h.rooms_available <= 0 OR h.rooms_sold < 0
      OR h.rooms_sold IS NULL OR h.rooms_available IS NULL
      THEN 'missing'
   WHEN h.rooms_sold > h.rooms_available
      OR COALESCE(s.base_currency,'UNKNOWN') <> 'EUR'
      OR h.revenue_eur < 0 THEN 'needs_review'
   ELSE 'provisional'
 END AS quality_status,
 FALSE AS approved_for_automated_training
FROM public.revenue_historical_daily h
LEFT JOIN public.hotel_revenue_settings s ON s.hotel_id=h.hotel_id
WHERE h.lead_days IN (0,1,3,7,14,30,60,90)
 AND h.observed_date <= h.stay_date;

REVOKE ALL ON public.revenue_intelligence_pace_checkpoints FROM PUBLIC,anon;
GRANT SELECT ON public.revenue_intelligence_pace_checkpoints TO authenticated;
COMMENT ON VIEW public.revenue_intelligence_pace_checkpoints IS
'Observed booking pace at common lead-time checkpoints. Historical PMS snapshots; may be incomplete and not independently reconciled. Never directly used for automated rate writes.';
