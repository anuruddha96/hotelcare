# HotelCare Revenue Intelligence — first production foundation

This is an incremental, read-only data foundation for ALL configured venues. It does **not** enable historical features in the live pricing/automation engine.

## Sources and semantics

- `revenue_calendar_history_archive`: immutable hotel-day archive, one row per hotel and stay date; nightly prices and recorded event associations; **five-year retention** in the server. The existing historical UI still offers the previous two years.
- `revenue_historical_daily`: observed booking pace for future stay dates at many lead days. No new snapshots are stored for the new checkpoints.
- `revenue_booking_activity_archive`: source event aggregation with currently known booking and cancellation values. Its existing sync can revise previous rows.
- `revenue_booking_value_observations`: **append-only**, hotel-scoped booking value and itinerary observations. On deployment, existing activity rows are seeded as `baseline_observed`; those are **not** guaranteed to be the initial booking price. Subsequent new activity rows have `new_event_observed`; meaningful modifications have `revision_observed`. Reservation and room identifiers are SHA-256 fingerprints (not raw PMS IDs). No guest PII, no public writes, no direct automation usage.

## Read-only intelligence interfaces

- `revenue_intelligence_daily_quality`: archived daily KPIs with quality flags; amounts are deliberately called `*_amount_raw` because some source fields named `*_eur` may contain other currency units. It never converts amounts silently.
- `revenue_intelligence_monthly`: **weighted** room revenue / sold room-nights (ADR), room revenue / available room-nights (RevPAR), and total occupied / total available (occupancy). Metrics are shown only for provisional (unflagged) days; flagged/missing dates and calendar completeness remain explicit. `complete_provisional_month` is **not** final PMS reconciliation.
- `revenue_intelligence_pace_checkpoints`: D-90, D-60, D-30, D-14, D-7, D-3, D-1 and D-0 recorded booking pace for comparisons at matching lead time. Query by hotel and bounded stay-date.
- `revenue_intelligence_event_outcomes`: recorded event and hotel-performance coincidences. Do **not** infer that an event caused a booking or automatically apply an event surcharge.

All interfaces are PostgreSQL `security_invoker` views on existing tenant-RLS data, accessible only to authorized users. Historical UI should request explicit ranges; never fetch every month in normal dashboards.

## Quality policy

Statuses are `missing`, `needs_review`, or `provisional`. None means independently reconciled. `approved_for_automated_training = false` **by default everywhere**. Red flags include absent daily KPIs, occupancy/inventory discrepancy, room-revenue vs ADR/RevPAR mismatch, a property whose source currency is not confirmed EUR, and amounts above a property's EUR safety ceiling.

SLNT's hotel revenue settings report HUF base currency. Large numbers in `*_eur` source columns therefore cannot be treated as EUR without checking the original PMS monetary units and exchange-rate rules. Do not repair historical values by dividing by a guessed factor.

## Operational cost

Only genuinely changed booking activity rows are appended to the new observation table. Monthly, daily quality, pace, and event views **do not store duplicates or run new polling**. The existing once-daily lightweight archive job is reused with a five-year retention period; the hotel grid continues to load previous three days by default and other months on request.

## Follow-on work (not yet implemented)

1. Reconcile PMS source currency, booking revenue allocation, genuine zero-value night stays, and overbooking/shared inventory; record quality adjudications with evidence.
2. Add verified *original vs final* reservation totals and modification taxonomy directly at the PMS ingest boundary, including original currency, channel, taxes, cancellation/refund and ancillary revenue allocation. Do not reinterpret seeded baselines as originals.
3. Reconcile each finalized hotel's previous night and close each month at a consistent Budapest-local cutoff; handle late corrections/versioning.
4. Create canonical recurring-event IDs and preserve authoritative evidence and actual occurrence dates. Test uplift against matched non-event dates.
5. Back-test AI forecasting and rate recommendations on verified historical data in shadow mode, then gate production rate changes behind existing RMS safeguards.

## SQL smoke queries

```sql
SELECT hotel_id,month_start,reported_currency,archived_days,
       provisional_days,review_days,missing_days,
       provisional_weighted_adr,provisional_weighted_revpar,
       provisional_weighted_occupancy_pct,complete_provisional_month
FROM public.revenue_intelligence_monthly
WHERE hotel_id='ottofiori' AND month_start='2026-10-01';

SELECT hotel_id,lead_days,COUNT(*) observations
FROM public.revenue_intelligence_pace_checkpoints
WHERE stay_date BETWEEN '2026-10-01' AND '2026-10-31' AND lead_days IN (7,30)
GROUP BY hotel_id,lead_days;

SELECT hotel_id,observation_origin,COUNT(*)
FROM public.revenue_booking_value_observations
GROUP BY hotel_id,observation_origin;
```
