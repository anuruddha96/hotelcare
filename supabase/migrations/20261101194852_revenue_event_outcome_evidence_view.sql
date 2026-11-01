-- Read-only observation of events alongside archived actual hotel performance.
-- This is historical correlation, NOT evidence that the event caused bookings.
-- Access stays restricted by the underlying hotel's RLS.
CREATE OR REPLACE VIEW public.revenue_intelligence_event_outcomes
WITH (security_invoker = true)
AS
SELECT
  a.hotel_id,
  a.organization_slug,
  a.stay_date,
  EXTRACT(YEAR FROM a.stay_date)::integer AS stay_year,
  ev.item->>'title' AS event_title,
  ev.item->>'impact' AS recorded_event_impact,
  ev.item->>'category' AS recorded_event_category,
  ev.item->>'venue' AS recorded_event_venue,
  NULLIF(ev.item->>'url','') AS evidence_url,
  (ev.item->>'start')::date AS recorded_start_date,
  (ev.item->>'end')::date AS recorded_end_date,
  q.rooms_sold,
  q.rooms_available,
  q.occupancy_pct,
  q.revenue_amount_raw,
  q.adr_amount_raw,
  q.revpar_amount_raw,
  q.reported_currency,
  q.quality_status,
  q.quality_flags,
  FALSE AS event_causality_proven,
  FALSE AS approved_for_automated_training
FROM public.revenue_calendar_history_archive a
JOIN public.revenue_intelligence_daily_quality q
  ON q.hotel_id=a.hotel_id AND q.stay_date=a.stay_date
CROSS JOIN LATERAL jsonb_array_elements(a.events) AS ev(item)
WHERE jsonb_typeof(a.events)='array'
  AND NULLIF(ev.item->>'title','') IS NOT NULL;

REVOKE ALL ON public.revenue_intelligence_event_outcomes FROM PUBLIC, anon;
GRANT SELECT ON public.revenue_intelligence_event_outcomes TO authenticated;
COMMENT ON VIEW public.revenue_intelligence_event_outcomes IS
'Historical event-performance coincidences. Archived event source URLs are retained, but recurrence and causal impact require independent confirmation. RLS-secured; no automated price use.';
