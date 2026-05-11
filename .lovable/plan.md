# Plan — Stabilize core, then expand revenue intelligence

Scoped so live housekeeping is not interrupted. Only Previo Test Hotel (730099) and `previo-test` slug are touched for new ingestion until you sign off.

## Phase 0 — Hotfixes (ship first, isolated)

**0.1 Login crash "null is not an object (evaluating 'profile.assigned_hotel')"**
- Root cause: `RoomManagement.fetchRooms` (and the org/hotel switcher path it runs on mount) reads `profile.assigned_hotel` without a null guard in the non‑admin branch. When `profile` hasn't hydrated yet, it throws.
- Fix: early‑return in `fetchRooms` until `profile` is loaded; add `profile?.` guards in both branches; only show the toast for real Postgres errors, not for "profile not ready".

**0.2 Rooms tab populated but Team View empty**
- Root cause: Team View filters by `profile.assigned_hotel` slug (`hotel-memories-budapest`) while `rooms.hotel` stores the resolved `hotel_name` ("Hotel Memories Budapest"). Rooms tab already does the slug→name resolution; Team View does not.
- Fix: extract the slug→name resolver into `src/lib/hotelKeys.ts` (`resolveHotelKeys(profile)`) and reuse in Team View, Auto‑Assign, Public Areas, PMS Upload. Ottofiori untouched (its data uses the same slug pattern; the helper is a no‑op for already‑matching keys).

**0.3 PMS Upload "Room 201 not found in previo-test" (108 issues)**
- Same slug/name mismatch in `PMSUpload.tsx` matcher. Use `resolveHotelKeys` so the matcher also looks up rooms whose `hotel = 'Hotel Memories Budapest'`.

**0.4 Hotel Memories Budapest — room 216 missing in validation**
- Audit: query `rooms` for `216` in that hotel. Likely the Previo room sync didn't include it (different `roomKindId` or inactive). Add a one‑off seed if missing and surface a "Room exists in PMS but missing locally" diff in the Sync Status panel.

## Phase 1 — Multi‑org BB lookup

- New routes: `/:org/bb` and `/:org/bb/:hotelCode` in `App.tsx`, mounted outside the auth shell (same as today's `/bb`).
- `breakfast-public-lookup` edge function already takes `hotelCode`; add an `org` param and filter `hotel_configurations` by `organization_slug`.
- `Breakfast.tsx` reads `useParams().org`; falls back to `rdhotels` for the legacy `/bb` route so existing links keep working.
- Wire **Previo Test Hotel** into the BB pool: `breakfast-roster-upload` already accepts the daily overview XLSX; add `previo-test` to the allowed hotel list and verify the column mapping with one upload.
- Result: `my.hotelcare.app/rdhotels/bb` works for all 4 RD hotels including the test hotel.

## Phase 2 — 12‑month API ingestion (test hotel only)

New edge functions, all gated to `hotel_id='previo-test'`:

1. `previo-sync-availability` — pulls `/rest/calendar` for `today … today+365`, writes append‑only to `previo_rate_snapshots`, `occupancy_snapshots`.
2. `previo-sync-reservations` (extend existing) — also writes `pickup_snapshots` (bookings_current per stay_date, captured_at).
3. `previo-sync-historical` — one‑shot backfill for the last 24 months into the same tables for YoY.
4. New view `revenue_yoy_daily` joining current vs same‑date last year (occ, ADR, pickup, revenue).
5. Cron: availability every 2h, reservations every 30 min, historical nightly at 03:00.

Storage: reuses `previo_rate_snapshots`, `occupancy_snapshots`, `pickup_snapshots` already present; adds `revenue_ingest_runs(id, run_type, started_at, finished_at, rows, error)` for observability.

## Phase 3 — Revenue Management page rebuild (`/[org]/revenue`)

- **Birds‑eye KPI strip** for admin/top_management: across‑org occ %, ADR, RevPAR, 14d pickup Δ, abnormal pickups, with YoY deltas.
- **Per‑hotel cards** (test hotel only live for now): 12‑month occ + ADR dual‑axis chart, pickup heatmap (next 90 days), ADR by room type table, min‑stay matrix, current vs floor/ceiling chips.
- **Live pickup ticker** via Supabase realtime on `pickup_snapshots`.
- **Audit trail panel**: every `rate_recommendations` and `rate_history` row with who/when/why.

## Phase 4 — Real‑time pickup engine + email alert

- Trigger: `pickup_snapshots` insert + 30‑min cron call `revenue-engine-tick`.
- New rule: **≥2 bookings for the same stay_date within 60 min** → insert `revenue_alerts(type='hourly_pickup_burst')` and call `send-email-notification` to admin + top_management.
- **Sudden‑pickup tier (auto‑apply, immediate per your call):** +€10 (2‑3 bookings/window), +€15 (4‑6), +€20 (7+). Capped by `hotel_revenue_settings.max_daily_change_eur`. Pushes to Previo via `previo-push-rates` (currently a stub — Phase 4b enables it once you confirm the rate plan IDs).
- **Audit UI**: every change creates a `rate_history` row with `reason`, `delta_eur`, `triggered_by='engine'|'manager'`, visible in a new "Price changes" tab on the revenue page with filters.
- **Manual override**: editing a price by hand sets `manual_rate_overrides.locked_until = now() + 7 days` (default; configurable). Engine skips locked cells.

## Phase 5 — Historical‑aware next‑month pricing

- Extend `revenue-engine-tick` to read `revenue_yoy_daily` for the same DOW + ±7 days last year and weight the recommendation:
  `suggested = base + pickup_tier + 0.3 × (yoy_occ_delta × dow_weight)`.
- Floors/ceilings per room type from `room_types.min_price_eur` / `max_price_eur` always win.
- Surface "Why this price" chips on each calendar cell (already have `PricingDriverChips.tsx` — extend to include "YoY", "DOW", "pickup tier", "demand score").

## Phase 6 — Manager dashboard (Open vs Closed, YoY)

New page `/[org]/revenue/reports`:
- **Open vs Closed**: pace curve per month (bookings on the books vs final pickup last year), gap chart.
- **YoY occupancy & pickup trends**: 13‑month bar+line by hotel and roll‑up.
- **Top movers**: stay dates with the largest pickup deltas in the last 7/30 days.
- CSV/XLSX export per view (reuses `revenue-export`).
- Visible to admin + top_management only.

## Phase 7 — Customisable rules UI (admin + top_management)

- `/[org]/revenue/settings/[hotel]`: floors/ceilings per room type, pickup tiers, decrease cadence, DOW weights, auto‑apply mode, alert recipients, manual lock duration, demand sensitivity.
- All values stored in `hotel_revenue_settings` + new `room_type_price_bounds`.

## Technical notes (for the engineering side)

```
src/lib/hotelKeys.ts          ← new resolver, used by Rooms / Team View / PMS Upload / Auto-Assign
src/pages/Revenue.tsx         ← rebuilt with KPI strip + per-hotel cards
src/pages/RevenueReports.tsx  ← new (Phase 6)
src/components/revenue/       ← AuditTrail, PickupTicker, YoYChart, OpenVsClosedChart
supabase/functions/
  previo-sync-availability/   ← new, gated to previo-test
  previo-sync-historical/     ← new, gated to previo-test
  previo-sync-reservations/   ← extend with pickup_snapshots
  revenue-engine-tick/        ← add hourly-burst rule + YoY weighting + auto-push
  breakfast-public-lookup/    ← add org param
```

Migrations:
- `revenue_ingest_runs` table
- `manual_rate_overrides.locked_until`
- `room_type_price_bounds`
- `revenue_yoy_daily` view
- Index `pickup_snapshots(hotel_id, stay_date, captured_at desc)`

## Out of scope this round
- Rolling Phase 2–6 to Gozsdu / Mika / Ottofiori (will mirror once test hotel is validated).
- PredictHQ / flight / Airbnb demand signals (kept for the next milestone — needs the API key).
- Channel manager push beyond Previo.

## Order of delivery
1. Phase 0 hotfixes (same message, no risk to live housekeeping).
2. Phase 1 BB multi‑org + room 216 fix.
3. Phase 2 ingestion on test hotel.
4. Phase 4 engine + email alert + audit trail.
5. Phase 3 revenue page rebuild.
6. Phase 5 historical weighting.
7. Phase 6 manager dashboard.
8. Phase 7 settings UI.

Approve this and I'll start with Phase 0 + 1 in the next message.
