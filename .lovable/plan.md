# Revenue Management — Reorg + Previo Sync + Calendar Fixes

Scope is limited to the **Revenue Management** module and the four Previo edge functions it touches. Ottofiori and the other live hotels' housekeeping/PMS-upload paths are NOT modified — Previo sync is invoked only for hotels with a `pms_configurations` row of type `previo`.

---

## 1. Fix wrong hotel / organization in Revenue Management

**Root cause** (`src/pages/Revenue.tsx`, lines 70–86): the page resolves the org from `profile.organization_slug`, ignoring the URL param `organizationSlug`. When a user (especially admins) switches org via `HotelSwitcher`/`OrganizationSwitcher`, the URL updates but the profile row may lag a tick, so Revenue reloads using the old org → shows hotels from the wrong tenant (e.g. Hotelcare.app instead of RD Hotels).

**Fix**:
- Source the org from the URL param `organizationSlug` first, fall back to `profile.organization_slug`.
- Look up `organizations.id` by that slug, then filter `hotel_configurations.organization_id`.
- For admins / top_management, add an Organization + Hotel selector at the top of `Revenue.tsx` (reuses `OrganizationSwitcher` pattern). Non-admins are auto-scoped to their org and see only hotels in `hotels` from `TenantContext`.
- Re-trigger `load()` whenever `organizationSlug` changes.

---

## 2. Previo API sync for the three manual upload files (keep manual too)

The three current manual uploads map to Previo endpoints as follows, after reading both XML and REST docs:

| Manual file | Previo source | Endpoint |
|---|---|---|
| Pickup (bookings on-the-books per stay date) | XML `Hotel.searchReservations` (filter by stay range, count nights per day) + nightly delta vs prior snapshot | `https://api.previo.app/x1/hotel/searchReservations/` |
| Occupancy (rooms sold / capacity per day) | REST `reports/overview` (occupancy by date) with REST `Rooms` for total capacity | `/v1/reports/overview`, `/v1/rooms` |
| Daily Overview (per-room arrivals/departures, meals, housekeeping) | XML `Hotel.searchReservations` (arrivals/departures, meals) + REST `calendar/availability` (room status) + XML `Hotel.getMeals` for meal labels | mixed |

**New edge functions** (all hard-gated to hotels with `pms_configurations.pms_type='previo'`):
- `previo-sync-pickup` — fetches reservations for next 90 days, computes per-date bookings, writes to `pickup_snapshots` with `snapshot_label='previo-sync'`.
- `previo-sync-occupancy` — pulls `reports/overview` + rooms, writes to `occupancy_snapshots`.
- `previo-sync-daily-overview` — pulls reservations + meals + availability for a given date, writes to a new `daily_overview_snapshots` table (mirrors the manual XLSX schema).

**Orchestrator**: extend `previo-pms-sync/index.ts` with a `kind: "pickup" | "occupancy" | "daily" | "all"` switch so the UI can call one function.

**UI** (`src/pages/Revenue.tsx`):
- On each hotel card, if the hotel has a Previo config, add a "Sync from Previo" split button next to "Upload" with three options (Pickup / Occupancy / Daily Overview / All).
- Manual XLSX upload dialog stays exactly as today.
- Sync history records each API sync as a row in `revenue_sync_history` (same table the manual uploads use) tagged with `source='previo_api'` vs `source='manual_xlsx'`.

**Schema additions** (one migration):
- `daily_overview_snapshots` (hotel_id, stay_date, room_code, arrival, departure, meal_code, hk_status, captured_at, source).
- `revenue_sync_history.source TEXT` column (default `manual_xlsx`).
- Index on `(hotel_id, stay_date, captured_at desc)` for the new table.

---

## 3. Pickup details inside the Calendar (remove separate Pickup tab)

`RevenueHotelDetail.tsx` currently exposes Pickup as its own tab (`<TabsTrigger value="pickup">` line 443) and `PickupTab` (line 755). Issues:
- The heatmap on the test hotel is empty because no pickup snapshots exist for `previo-test` yet — solved by the new `previo-sync-pickup` function above.
- The user wants this info on the Calendar tab, not a separate one.

**Changes** (`RevenueHotelDetail.tsx` + `StrategyCalendar.tsx` /  the inline calendar):
- Remove the `Pickup` TabsTrigger and `PickupTab` component.
- In each calendar day cell, show a small pickup chip (`+3` / `-2` / `0`) under the price, color-coded with the existing 5-step scale.
- Hovering a day shows a popover with: bookings on the books, pickup since last snapshot, last-year same date, abnormal flag.
- Top 5 pickup-movement dates are surfaced as a compact strip above the calendar grid (replaces the previous heatmap header).

---

## 4. Historical data for YoY / MoM

Today the calendar only queries `stay_date >= today`. Historical snapshots are written but never displayed.

**Fix**:
- Calendar fetcher: when the user navigates to a past month/quarter/year, query `pickup_snapshots`, `occupancy_snapshots`, and `rate_snapshots` for that exact range (no `gte today` clamp).
- For each day cell, additionally fetch the same date −365d and −30d and surface `YoY%` and `MoM%` chips.
- Add an explicit `rate_snapshots` write on every Previo sync so historical ADR is preserved (today only `pickup_snapshots` carry historical rate info).
- Add a nightly cron (`revenue-engine-tick` already exists) to snapshot today's occupancy + rate so we always have a historical record going forward.
- Retention: keep at least 24 months. Add a `pg_cron` job to delete snapshots older than 730 days (configurable).

---

## 5. Calendar prices do not match Previo

Looking at the screenshots: app shows €692 / €1526 / €3021 / etc., Previo Pricelist shows €60 / €75 / €90 per room. The Revenue page is summing the booked revenue across all rooms for the day (ADR × rooms sold or sum of reservation totals) and labeling it as "ADR", which is misleading.

**Findings**:
- `RevenueHotelDetail.tsx` line 661–666 picks PMS / ADR / default label. The `ADR` branch is actually showing **revenue total**, not average daily rate.
- `previo-pull-revenue` (the source) needs to be inspected — most likely it stores `sum(price)` instead of `sum(price)/rooms_sold` per stay date.
- Previo's authoritative per-night price for the reference room comes from REST `rate-plan` / `calendar/availability` (`price` field per room kind), NOT from booked-revenue aggregates.

**Fix**:
- Update `previo-pull-revenue` (and add to `previo-sync-occupancy`) to also fetch REST `rate-plan` for the configured reference room and store `pms_rate_eur` per stay_date in a new `rate_snapshots` table.
- Calendar prefers `pms_rate_eur` (label "PMS"); falls back to true ADR `revenue / rooms_sold` (label "ADR"); falls back to `room_types.base_price_eur` (label "default").
- Add a tooltip in the calendar header that links the price source name to the exact Previo screen so the user can verify.

---

## Files to touch

```
src/pages/Revenue.tsx                                    — org/hotel scoping + Sync button
src/pages/RevenueHotelDetail.tsx                         — remove Pickup tab, historical query, price source
src/components/revenue/StrategyCalendar.tsx              — day-cell pickup chip + YoY/MoM
src/components/revenue/CalendarYearView.tsx              — same chips on the mini view
supabase/functions/previo-pms-sync/index.ts              — add kind switch
supabase/functions/previo-sync-pickup/index.ts           — NEW
supabase/functions/previo-sync-occupancy/index.ts        — NEW
supabase/functions/previo-sync-daily-overview/index.ts   — NEW
supabase/functions/previo-pull-revenue/index.ts          — store true ADR + pms_rate
supabase/functions/revenue-engine-tick/index.ts          — nightly snapshot write
1 migration: daily_overview_snapshots, rate_snapshots, revenue_sync_history.source, retention cron
```

## Hotels-affected guarantee

Every new edge function starts with:

```ts
const { data: cfg } = await service.from("pms_configurations")
  .select("pms_type").eq("hotel_id", hotelId).maybeSingle();
if (cfg?.pms_type !== "previo") return jsonError(400, "Not a Previo hotel");
```

Ottofiori, Memories, Mika, Gozsdu continue to use spreadsheet uploads unless someone explicitly adds a `pms_configurations` row for them.

## Out of scope (ask before doing)

- Auto-syncing all hotels on a schedule — first cut is manual button + the existing daily cron only for hotels that opted into Previo.
- Pushing prices back to Previo from this work (already handled by `Push to Previo`).
