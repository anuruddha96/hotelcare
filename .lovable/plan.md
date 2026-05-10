# Previo-powered Revenue Management — Build Plan

Focused on this round's request. Phases ship in order; each is a deployable increment that does not disturb live housekeeping.

---

## Phase A — PMS config hardening + "Sync test hotel rooms" button

Goal: an admin can sit on `/admin → PMS Configuration`, see exactly what's missing for a hotel, fix it in 30 seconds, and run a room sync with one click.

**A1. Setup checklist card** (top of `PMSConfigurationManagement` for the selected hotel)
A coloured list of pre-flight items, each with status icon + inline action:
- PMS type selected (previo)
- `pms_hotel_id` entered (e.g. `730099`)
- `credentials_secret_name` set + secret exists in Lovable Cloud (verified via a small `pms-check-secrets` edge function)
- `previo-test-connection` last result green within 24 h
- At least 1 room mapping or "auto-import from Previo" performed

**A2. Hard block on sync when prerequisites are missing**
- Existing `previo-sync-rooms`, `previo-sync-reservations`, etc. start with a guard that returns `{ ok:false, code:"missing_pms_config", missing:[…] }`.
- Frontend converts that into a red banner: "Cannot sync — fix these items first" with deep links to the matching field.

**A3. "Sync rooms now" button** on both:
- Admin → PMS Configuration card
- Housekeeping → PMS Upload tab (top-right, next to "View History")
Calls `previo-sync-rooms` for the currently-selected hotel and streams progress via the existing `pms_sync_history` table.

**A4. Sync Status panel** (re-usable component `<PmsSyncStatus hotelId=… />`)
Shows: last successful sync time, rooms imported, rooms updated, rooms unchanged, last error (with copy-to-clipboard), button "Re-sync now". Also visible inside the PMS Upload screen so the "108 not found" outcome immediately points to "rooms last synced: never".

---

## Phase B — Continuous Previo data ingestion (12-month window, kept forever)

Goal: every 2 hours, the app pulls availability, sold rooms, and ADR for the next 365 days from Previo for every PMS-enabled hotel, and appends snapshots so we keep full history for YoY comparison.

**B1. New edge function `previo-sync-availability`**
- Reads availability + sold counts + total revenue per (room_type, stay_date) for `today … today+365`.
- Writes append-only into:
  - `previo_rate_snapshots` (already exists)
  - `occupancy_snapshots` (already exists) — one row per (hotel, stay_date, captured_at)
  - `pickup_snapshots` (already exists) — Δ vs previous snapshot
- Updates `revenue_ingest_runs` with rows fetched / errors / duration.

**B2. Cron via pg_cron + pg_net**
- Every 2 h: `previo-sync-availability` (one invocation per active hotel, sequential to respect Previo rate limits).
- Daily 03:00: `previo-sync-rooms` (full refresh of room inventory).
- Every 30 min: `previo-sync-reservations` (rolling 90-day window for the upcoming reservations list).

**B3. Append-only history is the source of YoY comparison**
- New view `revenue_yoy_daily` aggregating occupancy_snapshots + previo_rate_snapshots into per-day Occ%, ADR, RevPAR with `current_year` and `last_year` columns.

---

## Phase C — Revenue page rebuild (`/[org]/revenue`)

Replace the current cards with a real revenue cockpit. Per hotel:

**C1. KPI strip**
12-month rolling totals: Occ%, ADR, RevPAR — each with YoY delta chip and sparkline of last 90 days.

**C2. 12-month performance chart**
Dual-axis line: Occ% vs ADR per month, current year vs last year (uses `revenue_yoy_daily`). Hover shows exact values.

**C3. Pickup heatmap (next 90 days)**
Calendar grid using existing `CalendarYearView`, colored by 24-h pickup Δ. Click a day → side panel with: current rate, suggested rate, drivers (existing `PricingDriverChips`), pickup last 1 h / 24 h / 7 d, demand-forecast badge from PredictHQ (Phase E).

**C4. ADR-by-room-type table**
Per room type: this-week ADR, last-week ADR, last-year-same-week ADR, occupancy. Highlights a room type whose ADR is dropping while occupancy is rising (= leaving money on the table) in amber.

**C5. Pickup ticker**
Live feed (Supabase realtime on `pickup_snapshots`) at the top: "+2 bookings for 24 May at Hotel Ottofiori in the last 47 min".

---

## Phase D — Real-time pickup engine + automated price action

Sharper version of the existing `revenue-engine-tick`.

**D1. Trigger cadence**
- Every 2 h cron (existing).
- Plus a Supabase realtime trigger: when `pickup_snapshots` inserts a row with `delta >= 2 within 60 min`, call `revenue-engine-tick` immediately for that hotel/date.

**D2. Bookings-per-hour rule (your explicit ask)**
- "If ≥ 2 bookings for the same stay_date inside 1 h" → write a `revenue_alerts` row of type `rapid_pickup` and email all admins + top_management.

**D3. Sudden-pickup price action**
- Tiered increase (already in `pickup_increase_tiers`): +€10 (2-3 bookings), +€15 (4-6), +€20 (7+). Capped by `max_daily_change_eur`.
- Behaviour controlled by per-hotel `auto_apply_mode`:
  - `auto` → push via `previo-push-rates`, log to `rate_change_audit`, in-app toast to revenue managers, email digest at 08:00.
  - `recommend` → create `rate_recommendations` row with `status=pending`, badge on the calendar cell.
  - Default `recommend` for first 30 days, switch to `auto` per hotel later.

**D4. Manual-override protection**
- New table `manual_rate_overrides(hotel_id, stay_date, room_type, set_by, set_at, locked_until)`.
- Engine never auto-pushes a locked cell. Lock visualised with a 🔒 badge + tooltip "Manually set by X on Y. Engine paused until Z."

**D5. Floor protection — never undercut**
- `hotel_revenue_settings.floor_price_eur` already exists. Add per-room-type floor in `room_types.min_price_eur`. Engine takes the higher of the two.
- Decrease logic stays disabled by default; if enabled, max −€5 and only when occupancy < 40 % AND > 21 days out.

---

## Phase E — Demand forecasting (PredictHQ + flight/hotel/airbnb signals)

**E1. PredictHQ integration**
- Add `PREDICTHQ_API_KEY` secret (we'll request via Lovable secret tool).
- New edge function `demand-forecast-fetch` runs nightly: pulls events (concerts, sports, conferences, public holidays, school holidays, severe weather) for Budapest with PHQ Rank ≥ 50 for the next 365 days.
- Stores in new `demand_signals(hotel_id, stay_date, source, score, label, payload, fetched_at)` — additive to existing `revenue-events-fetch`.

**E2. Flight + hotel + airbnb heat signals**
- Adapter pattern `demand-signal-adapter` so we can plug in: PredictHQ Flights (paid tier) for inbound BUD seat capacity; AirDNA / Inside Airbnb for occupancy index; STR / OTA Insight if you have access. Each adapter writes to the same `demand_signals` table with a `source` tag.
- If only PredictHQ key is provided, only events + flights are populated; the rest are placeholders awaiting their respective keys.

**E3. Forecast score → engine input**
- New per-day field `demand_score` (0-100) computed from blended signals + occupancy pace vs last year.
- Engine adds an extra increase tier when `demand_score ≥ 70`: ceiling lifts by +€15 above normal cap (still respects manual locks and per-room max).

**E4. UI**
- Badge on the calendar day: 🔥 Demand 82 — "Sziget Festival opening, +12 % BUD seat capacity, hotel comp-set ADR +18 %".
- Forecast tab on `/revenue/[hotel]` with a 12-month bar of demand scores.

---

## Phase F — Customisable rules UI for admins + top_management

`/[org]/revenue/settings/[hotel]` (gated by `admin` or `top_management`).

Tabs:
1. **Floors & ceilings** — per room type min/max €, season floors (high/shoulder/low), max daily change.
2. **Pickup tiers** — table of (min Δ bookings, max Δ, € increase). Add/remove rows.
3. **Decrease rules** — on/off, max € drop, only when occupancy < X % and lead > Y days.
4. **DOW & monthly weights** — already exists; surface in the same screen.
5. **Demand sensitivity** — slider Low/Medium/High, threshold for "high demand", extra € on top of pickup tier.
6. **Auto-apply mode** — `recommend` / `auto` / `hybrid (auto if Δ < €N)`.
7. **Alert recipients** — email list per hotel + role-based defaults.
8. **Manual lock duration** — 24 h / 7 d / 30 d / until cleared.

All saves write to existing `hotel_revenue_settings` + new `revenue_settings_history` audit table. Top management can see/override every hotel; admins only their own.

---

## Phase G — Yearly performance reporting

- New page `/[org]/revenue/reports`:
  - Year-vs-year occupancy, ADR, RevPAR (line + bar).
  - Per-month booking pace curve (current year overlaid on last year, grey line = 2 years ago).
  - Pickup quality: average lead time, % of nights closed-out, % over rack, % under floor.
  - Export CSV / XLSX (already have `revenue-export`).

---

## Build pipeline (delivery order)

1. **Phase A** — checklist + Sync Status panel + Sync rooms button.
2. **Phase B** — `previo-sync-availability` + crons + `revenue_yoy_daily` view.
3. **Phase C** — Revenue page rebuild (KPIs, YoY chart, pickup heatmap, ADR table, ticker).
4. **Phase D** — engine upgrade (rapid-pickup email, manual locks, floors, auto/recommend toggle).
5. **Phase E** — PredictHQ integration + demand badge + engine input.
6. **Phase F** — Settings UI for full customisation.
7. **Phase G** — Yearly performance reports.

Each phase is independently shippable behind a per-hotel feature flag so live `/rdhotels` operations are not affected.

---

## Open questions before I start coding Phase A

1. **Auto vs recommend default** — Push price changes to Previo immediately, or always require manager approval first (recommended for the first 30 days)?
2. **Price floors** — Infer from last 90 days minimum, or you'll enter floors per room type yourself in the settings UI (Phase F)?
3. **Manual lock duration** — 7 days, until manager clears, or 30 days?
4. **Alert recipients** — All admins + top_management, just `info@hotelcare.app`, or a custom distribution list per hotel?
5. **PredictHQ key** — Do you already have a PredictHQ API key, or should I add a secret slot and you'll paste it when you sign up?
