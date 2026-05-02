
# Revenue Management — Room Price Genie parity

Goal: bring the RPG screens you shared into Hotel Care's Revenue module, keep manual XLSX uploads working today, and prepare cleanly for PMS API hookup. Housekeeping is untouched — all changes are confined to `src/pages/Revenue*`, new admin sub-tabs, new edge functions, and new tables in the `revenue` domain.

## What you'll get (matches each screenshot)

1. **Rooms Setup** — table of room types per hotel with: Name, Room in PMS, Rate in PMS, # Rooms, Reference vs Derived, Base Price, Derivation (% or absolute), Default Min/Max price. One reference room, others derive from it. "Total rooms" auto-sums.
2. **Day-of-Week Adjustments** — 7 percent inputs (Mon–Sun) + bar chart (Local Market / Base Price / PMS Price).
3. **Monthly Adjustments** — 12 percent inputs + same chart pattern.
4. **Occupancy Strategy** — 5 sub-tabs: Target Occupancy (per month), Median Booking Window, Aggressiveness, Close Out Sales (Last Day), Shoulder Night Discounts.
5. **Minimum Stay (Orphan Gap Correction)** — min nights, fixed-restriction override toggle, room-type multi-select.
6. **Yielding Tags** — list + create dialog (tag name, room type, min/max %, aggressiveness, colour). Drives per-tag price shifts.
7. **Lead Time Adjustments** — 9 buckets (6M+, 3M+, 1.5–3M, 4–6w, 2–4w, 1–2w, 4–7d, 2–3d, last day).
8. **Surge Protection** — surge settings, protection price settings, surge event log.
9. **Benchmarking / Reporting** — Active Listings, Nights Sold, Median Lead Time, Median LOS + daily Occupancy/ADR/RevPAR vs market.
10. **Calendar with year-zoom** — Day / Week / Month / **Quarter (3-month)** / **Year (12 mini-months)** views, each cell shows price + occupancy chip + suggestion arrow. Click → existing day side-panel.

## Daily auto-ingest (pre-PMS)

You said you want files downloaded every morning per hotel. We build a generic **`revenue-daily-ingest`** scheduled edge function that:
- Reads new `hotel_data_sources` rows (per hotel: kind = pickup / occupancy / rate / events; transport = http_url / email_inbox / sftp / manual; auth headers as a JSONB secret reference).
- For `http_url` sources, fetches the file with the configured headers, runs the matching parser (we already have `revenue-pickup-upload` for pickup), stores raw blob in `revenue-uploads` storage bucket with `snapshot_label = source_name + date`, then calls the parser.
- Logs every run into `revenue_ingest_runs` (status, rows, error, duration) → shown on Revenue dashboard as a "Last sync" badge per hotel.
- Runs on `pg_cron` every day at 06:00 hotel-local time, plus a manual "Sync now" button per hotel.

For your Previo files specifically: today you upload manually; once you provide the Previo report URL + auth, the same ingest row works without code changes.

## PMS connection prep (Previo + future)

- `pms_configurations` and `pms_room_mappings` already exist. We add **`pms_rate_plan_mappings`** (hotel_id, room_type_id, pms_rate_plan_id, channel) so "Upload Prices" knows exactly which plan to push.
- Finish `previo-push-rates`: when called, it loads approved `rate_recommendations` for date range, joins to `pms_rate_plan_mappings`, calls Previo Rate API, writes results to `rate_history` and `rate_change_audit`. Function stays a stub for any plan that has no mapping (clear error toast).
- A small **"PMS Connection" card** on each Hotel Detail page shows: connected/not, last sync, test-connection button. Until you fill in mappings, manual upload + manual push paths still work.

## Database migration (single migration)

Tables created (RLS: admin + top_management for org/hotel):
- `room_types` (id, hotel_id, organization_slug, name, pms_room_id, pms_rate_id, num_rooms, is_reference, derivation_mode `percent|absolute`, derivation_value, base_price_eur, min_price_eur, max_price_eur).
- `dow_adjustments` (hotel_id, dow 0–6, percent).
- `monthly_adjustments` (hotel_id, month 1–12, percent).
- `lead_time_adjustments` (hotel_id, bucket enum, percent).
- `occupancy_targets` (hotel_id, month 1–12, target_pct).
- `occupancy_strategy` (hotel_id, median_booking_window, aggressiveness, close_out_last_day_pct, shoulder_discount_pct).
- `yielding_tags` (id, hotel_id, name, room_type_id, min_pct, max_pct, aggressiveness, colour).
- `min_stay_settings` (hotel_id, min_floor, allow_override_fixed, room_type_ids[]).
- `surge_settings` (hotel_id, threshold_bookings, window_hours, only_after_days, recipients, send_email).
- `surge_events` (hotel_id, stay_date, bookings_in_window, triggered_at, notified_at).
- `benchmark_snapshots` (hotel_id, market_id, metric, day, value, comparison_value).
- `hotel_data_sources` + `revenue_ingest_runs` for the auto-ingest engine.
- Extend `hotel_revenue_settings` with `engine_uses_room_setup boolean` so the rule engine can pull the base price from `room_types.base_price_eur` instead of the floor when no `daily_rates` row exists.

All tables have `(hotel_id, organization_slug)` and an RLS policy gated by `has_role(auth.uid(), 'admin'|'top_management')` and the same org/hotel as the user — identical pattern to the existing revenue tables.

## Engine update (deterministic, no AI — per your last decision)

Suggested rate per day = `base_price` × DOW% × Month% × LeadTime% × OccupancyTargetMultiplier × YieldingTagShift × DerivationFactor (for derived rooms), then clamped to `[min_price, max_price]` and tier-pickup adjustment from `hotel_revenue_settings.pickup_increase_tiers`. Surge protection caps daily change. Each multiplier is shown as a chip in the day side-panel so you can see exactly why the price moved (precise numbers, every step explained).

## UI changes

- **`src/pages/Revenue.tsx`** — keep grid; add per-hotel "Last sync", "Sync now", and "Open settings" buttons.
- **`src/pages/RevenueHotelDetail.tsx`** — keep current tabs; add **Quarter** and **Year** view buttons; add `RoomsSetupTab`, `DOWTab`, `MonthlyTab`, `OccupancyStrategyTab`, `MinStaySettingsTab`, `YieldingTagsTab`, `LeadTimeTab`, `SurgeProtectionTab`, `BenchmarkingTab` under a new "Pricing Strategy" sub-nav (matches RPG sidebar).
- New components in `src/components/revenue/` (one file per tab) so the page file stays under 300 lines.
- New `CalendarYearView` (12 mini-months grid) and `CalendarQuarterView` (3 months side-by-side) using the same `rowsByDate` map already built.

## Edge functions

- New: `revenue-daily-ingest` (scheduled + manual), `revenue-data-source-test` (one-shot fetch+preview), `revenue-recompute-suggestions` (re-run engine after settings change).
- Updated: `revenue-engine-tick` to read all the new multipliers; `previo-push-rates` to honor `pms_rate_plan_mappings`.

## Testing & verification (per your requirement)

For each tab I will:
1. Save a setting → reload → confirm round-trip via `supabase--read_query`.
2. Trigger `revenue-recompute-suggestions` and check the suggested-rate chip changes correctly in the day panel (driver chips show the exact %).
3. Run `revenue-daily-ingest` against a stub source → check `revenue_ingest_runs` row + a fresh `pickup_snapshots` row.
4. End-to-end: bulk edit → approve → push (stub if no mapping, real if mapped) → audit log row visible.
5. Smoke-test housekeeping (Auto-Assign, Team View, Cleaning start/finish) is unaffected — no shared tables modified.

## Out of scope for this round (so we ship quickly)

- Median Booking Window auto-calc from PMS reservations (needs PMS first; the field is editable manually now).
- Channel-manager push beyond Previo.
- Email/SMS surge alerts wiring (table + UI ready, sender hookup later).

## Rollout order

1. Migration + RLS.
2. Rooms Setup + DOW + Monthly + Lead Time + Occupancy Strategy + Min Stay + Yielding Tags + Surge tabs (UI + save/load).
3. Engine update to use new multipliers.
4. Year/Quarter calendar views.
5. `revenue-daily-ingest` + `hotel_data_sources` UI.
6. Previo push wiring with `pms_rate_plan_mappings`.
7. Benchmarking tab (read-only from `benchmark_snapshots` with placeholder data until a market source is configured).
8. End-to-end test pass; confirm housekeeping flows still green.
