## Overview

Two independent, additive features. Neither touches existing housekeeping/maintenance flows.

1. **Revenue Management** — admin/top_management only. Upload Previo pickup XLSX → engine stages price recommendations per hotel/day → manager reviews and "Push to Previo" (Phase 2) or copies values manually.
2. **Public Breakfast Verification** — `/bb` page. Reception uploads daily overview XLSX each morning; breakfast staff types hotel code + room number, sees eligible guest names + pax.

---

## Feature 1 — Revenue Management

### Access
- New nav item **Revenue** visible **only** if `profile.role IN ('admin','top_management')`.
- Route: `/:organizationSlug/revenue`.
- All tables RLS-restricted to those two roles + organization_slug.

### Pages

**`/revenue` — Org Dashboard**
- Hotel cards in one grid: Mika Downtown, Memories, Gozsdu Court, Ottofiori. Each shows:
  - Today's pickup count (last 24h) + Δ vs same-day-last-year
  - Last 30-min check timestamp + status pill (`live` / `stale` / `abnormal`)
  - Recommended price action for next 14 days (mini sparkline up/down)
  - Button: **Open hotel** → `/revenue/:hotelId`
- Top-right: **Upload Pickup XLSX** (multi-hotel batch).
- Banner if any hotel flagged "abnormal pickup" (red).

**`/revenue/:hotelId` — Hotel detail**
- Calendar grid of next **120 days**: each cell = date, current rate, recommended rate, delta (€), pickup last interval.
- Color: green = increase suggested, red = decrease, grey = no change.
- Click a cell → side panel with reservation list for that night, override input (€ or %), save.
- Toolbar:
  - **Bulk adjust** modal: date range + value/% + Fri/Sat reduction rule (defaults: weekday −€3, Fri/Sat −€2).
  - **Run engine now** (re-evaluates after upload).
  - **Push to Previo** (disabled until creds confirmed — see Phase 2).
- Tabs: *Recommendations* | *History* (every change with who/when/why) | *Settings* (per-hotel rules).

### Pricing engine rules (configurable per hotel; defaults below)

```text
PICKUP-driven INCREASE (per date, last 30 min window):
  3 bookings        → +€10
  4–5 bookings      → +€17
  6–8 bookings      → +€22
  9+ bookings       → +€30  ← also flag "abnormal", notify admin + top_management
NO-PICKUP DECREASE (run every 12h, only if 0 pickups in window for that date):
  Mon–Thu, Sun → −€3
  Fri, Sat     → −€2
GUARDS:
  - Floor price per hotel/room-type (admin sets in Settings)
  - Max change per 24h: ±€40
  - Skip dates with occupancy ≥ 90%
  - Skip dates < 2 days out (too late)
```

### Background job (every 30 min)

- Cron-scheduled edge function `revenue-engine-tick`:
  1. For each hotel + each future date (today..+120), read latest `pickup_snapshots` row.
  2. Compare to previous snapshot → compute new bookings in window.
  3. Apply rules → write `rate_recommendations` (does NOT push live).
  4. If "abnormal" → insert into `revenue_alerts` and call `send-email-notification` to admin + top_management.
- Decrease rules run on a 12h cadence (same function, different branch).

### Data ingestion (Phase 1 = XLSX)

- New edge function `revenue-pickup-upload`: accepts XLSX, parses Previo format observed in your file:
  - Row 0 = "Pickup for Hotel X" (extract hotel)
  - Row 2 = date headers (`30. Apr`, `1. May`, ...) repeating in groups of 3
  - Row 3 = `2026 / 2025 / Change`
  - Row 4 = numeric values
- Inserts a `pickup_snapshots` row per (hotel, date) with `bookings_current_year`, `bookings_last_year`, `delta`, `uploaded_at`.
- The 30-min engine runs against the latest snapshot.

### Tables (new)

```text
hotel_revenue_settings(hotel_id PK, floor_price_eur, max_daily_change_eur,
  weekday_decrease_eur, weekend_decrease_eur, abnormal_pickup_threshold,
  pickup_increase_tiers JSONB, organization_slug)

pickup_snapshots(id, hotel_id, stay_date, bookings_current, bookings_last_year,
  delta, captured_at, uploaded_by, organization_slug)

rate_recommendations(id, hotel_id, stay_date, current_rate_eur, recommended_rate_eur,
  delta_eur, reason TEXT, status ENUM('pending','approved','pushed','overridden','expired'),
  created_at, reviewed_by, reviewed_at, pushed_at, organization_slug)

rate_history(id, hotel_id, stay_date, old_rate, new_rate, source ENUM('engine','manual','bulk','previo_push'),
  changed_by, changed_at, notes, organization_slug)

revenue_alerts(id, hotel_id, stay_date, alert_type ENUM('abnormal_pickup','floor_breached','engine_error'),
  payload JSONB, acknowledged_by, acknowledged_at, created_at, organization_slug)
```

All tables: RLS `organization_slug = get_user_organization_slug(auth.uid()) AND role IN ('admin','top_management')`.

### Phase 2 — Push to Previo (deferred until you confirm)

- Add edge function `previo-push-rates` once you provide:
  - Previo Rate API endpoint + auth method (likely same Basic auth as existing `previo-sync-*` functions).
  - Rate plan / room-type ID mapping per hotel.
- Until then, the **Push** button is greyed out and shows "Awaiting Previo Rate API setup". Manager can copy recommended values manually.

---

## Feature 2 — Breakfast Verification (`/bb`)

### Public page (no auth)

- Route: `my.hotelcare.app/bb` (also under tenant: `/:organizationSlug/bb` for safety).
- Form:
  1. Hotel code input (e.g. `mika-2026`, `mem-2026`, `gozsdu-2026`, `otto-2026`) — short token stored in `hotel_breakfast_codes`.
  2. Room number input (e.g. `Q-101`, `DB/TW-203`).
  3. Date defaults to today; can override.
- On submit → calls public edge function `breakfast-lookup` with `{ code, room, date }`.
- Returns: `{ guests: [{name, pax, breakfast_count}], lunch, dinner, all_inclusive, notes }` or `not_found` / `not_eligible`.
- Big-text card UI optimized for staff use on tablet/phone.

### Daily upload (reception/manager dashboard)

- New tile in dashboard "Breakfast Roster" → upload `daily_overview` XLSX.
- Edge function `breakfast-roster-upload` parses:
  - Sheet name = date (e.g. `2026-04-30`)
  - Cols: `Date(arrival)`, `Room`, `Departure`, `Arrival`, `Ongoing`, `Date(departure)`, `Bre`, `Lun`, `Din`, `All`, ...
  - Extract guest names from `Arrival` / `Ongoing` strings (pattern `(N) NAME, NAME` already in file).
- Upserts into `breakfast_roster`.

### Tables (new)

```text
hotel_breakfast_codes(hotel_id PK, code TEXT UNIQUE, organization_slug, is_active)
  -- pre-seeded: mika-downtown→'mika-2026', memories-budapest→'mem-2026', etc.

breakfast_roster(id, hotel_id, stay_date, room_number, guest_names TEXT[],
  pax INT, breakfast_count INT, lunch_count INT, dinner_count INT, all_inclusive_count INT,
  source_notes TEXT, uploaded_at, uploaded_by, organization_slug,
  UNIQUE(hotel_id, stay_date, room_number))
```

- RLS: roster table — only managers/admins can INSERT/UPDATE; **edge function reads with service role** (page itself has no client SELECT access).
- `hotel_breakfast_codes`: SELECT denied to client; only edge function reads.

### Security

- `/bb` is fully public: no Supabase session required.
- Lookup is rate-limited in the edge function (in-memory map per IP, 30 req/min) and returns minimal data (no notes, no payment info).
- Hotel code is a shared secret rotated by admin in **Admin → Hotels → Breakfast Code**.

---

## Files to create / change

### Database
- One migration with all 6 new tables + RLS + 1 trigger to auto-expire `rate_recommendations` after 24h.

### Edge functions (5 new)
- `revenue-pickup-upload` — XLSX parser
- `revenue-engine-tick` — cron, runs every 30 min (pg_cron schedule via insert tool)
- `breakfast-roster-upload` — XLSX parser
- `breakfast-lookup` — public lookup
- `previo-push-rates` — stub returning 501 until Phase 2

### Frontend
- `src/pages/Revenue.tsx`, `src/pages/RevenueHotelDetail.tsx`
- `src/pages/Breakfast.tsx` (public, no providers needing auth)
- `src/components/revenue/HotelRevenueCard.tsx`, `RatePlannerGrid.tsx`, `BulkAdjustDialog.tsx`, `PickupUploadDialog.tsx`, `RevenueAlertsBanner.tsx`, `RecommendationSidePanel.tsx`
- `src/components/breakfast/BreakfastLookupForm.tsx`, `BreakfastRosterUpload.tsx` (manager tile)
- `src/components/admin/BreakfastCodeManagement.tsx` (added to AdminTabs)
- `src/components/layout/Header.tsx` — add Revenue link gated on role
- `src/App.tsx` — add `/revenue`, `/revenue/:hotelId`, `/bb`, `/:organizationSlug/bb` routes
- `src/lib/comprehensive-translations.ts` — keys for HU/ES/VI/MN

### Memory
- New `mem://features/revenue` (engine rules, abnormal threshold, role gating)
- New `mem://features/breakfast` (hotel codes, public route, RLS pattern)
- Update `mem://index.md`

---

## Out of scope for this round
- Live push to Previo (Phase 2 — pending Rate API confirmation from you).
- Channel manager rate parity checks.
- Competitor scraping / market data.
- Forecasting beyond rule-based engine (no ML).
- Breakfast: per-guest check-off / consumption tracking (only eligibility lookup).

## Open items needing your input later
1. Previo Rate API endpoint, auth, and rate-plan IDs per hotel (for Phase 2 push).
2. Confirm initial floor prices per hotel (or I'll seed €60 default and you edit in Settings).
3. Confirm the 4 breakfast hotel codes you want pre-seeded.