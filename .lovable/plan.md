# Previo Integration & Automated Revenue Management — Roadmap

## Phase 0 — Fix current bugs (immediate, this loop)

**0.1 PMS Upload "108 issues — room not found"**
- Cause: rooms in test hotel haven't been synced from Previo yet, so the upload's room-code matching can't find 201/203/204…
- Fix: run `previo-sync-rooms` for `previo-test` first (also wire a "Sync rooms now" button on the PMS Upload screen).

**0.2 "Failed to fetch rooms" toast on /rdhotels housekeeping**
- Investigate which call throws. Likely the same Previo endpoint (Channel Manager / Rooms tab) failing because the base URL secret previously pointed at help.previo.app. Confirm `PREVIO_API_BASE_URL=https://api.previo.app` is now correct and the front-end query handles a non-Previo hotel gracefully (don't toast for hotels without PMS configured).

**0.3 Hardening already in place**
- `previoAuth.ts` already strips `/soap`, ignores docs hosts, and throws a descriptive error on HTML responses. Keep.

---

## Phase 1 — Solid Previo data layer (foundation for everything else)

Goal: one reliable, cached, rate-limited Previo client used by every feature.

- New shared module `_shared/previoClient.ts` with typed methods: `listRooms`, `listReservations(from,to)`, `getReservation(id)`, `listGuests`, `getAvailability(from,to)`, `getRates(from,to)`, `pushRates`, `updateRoomStatus`.
- Persist raw API pulls in new tables so the UI reads from DB (fast) and Previo is the source-of-truth refresher:
  - `previo_rooms_cache`, `previo_reservations_cache`, `previo_guests_cache`, `previo_availability_daily`, `previo_rates_daily`.
  - Each row scoped by `hotel_id`, `pms_hotel_id`, `fetched_at`.
- Cron edge functions (pg_cron → invoke):
  - `previo-sync-rooms` — daily
  - `previo-sync-reservations` — every 30 min, rolling 90-day window
  - `previo-sync-availability` — every 2 hours, **next 12 months**
  - `previo-sync-rates` — every 2 hours, next 12 months
- All syncs are **append-only snapshots** for occupancy/pickup so we keep history forever (yearly performance comparisons).

---

## Phase 2 — Channel Manager UI in Previo style

Rebuild `/[org]/channel-manager` to match the Previo grid screenshots:
- Top toolbar: rate plan dropdown, date navigator, "Bulk settings" button (matches "Bulk settings for rate plan").
- Grid: rows per room type → Room status, Rooms for sale, % occupancy, single-occ price, double-occ price, Min stay, Max stay. Columns = days, grouped by month header.
- Color cells (green/orange/red) by `room_status` from API.
- Bulk-edit dialog mirroring screenshot: date range, weekday checkboxes, currency, "Set following values" checkboxes, per-room-type matrix.
- Reads from `previo_rates_daily` + `previo_availability_daily`. Writes go through `previo-push-rates` (already exists) + a new `previo-bulk-update`.

---

## Phase 3 — Reservations & Guests from API

- `/[org]/reservations`: list view matching Previo "RESERVATIONS LIST" (Created, Date, Nights, Voucher, Guests, Price, Balance, Type, Room) with the same filter sidebar (Date, Operation, Room, Currency, Status, Type, Payment, Company, Partner, Source, Number of rooms/guests, Check-in done).
- `/[org]/guests`: pulled from `previo_guests_cache`, search + detail page, link to reservations.
- All writes (create / modify / cancel reservation, check-in/out) proxied through new edge functions to Previo, then re-cached.
- **Housekeeping is untouched.** New tables; the existing `rooms`, `cleaning_assignments`, attendance, etc. keep working. Only additive linking via `pms_reservation_id`.

---

## Phase 4 — Automated Revenue Management (the core ask)

### 4.1 Data foundation
- Pull occupancy & rate snapshots every 2h for **next 365 days**.
- `pickup_snapshots` already exists — extend to write a row per (hotel, stay_date, captured_at) on every sync. Pickup = rooms_sold(now) − rooms_sold(prev snapshot).
- `revenue_yearly_performance` materialized view: ADR, RevPAR, Occ%, total revenue per (hotel, year, month, day-of-week) — for YoY comparison.

### 4.2 Pickup detection engine (every 2h cron)
For each (hotel, stay_date in next 90 days):
1. Compute Δ vs. last snapshot and rolling 24h Δ.
2. **Email alert** to admins if ≥ 2 bookings for the same stay_date in the last 60 minutes.
3. **Sudden pickup rule** (configurable defaults — see Phase 4.4):
   - If 60-min Δ ≥ 2 OR 24h Δ ≥ 4 OR occupancy crossed a threshold (60/75/85/90%), raise price by **+€10 to +€20** (scaled by occupancy band — 60%→+€10, 75%→+€12, 85%→+€15, 90%+→+€20).
   - Push new price via `previo-push-rates`.
   - Log to `rate_changes_audit` with reason, old price, new price, trigger metrics.
   - Emit in-app notification (Sonner toast + bell) to revenue managers: "System raised €X on dd/mm — reason: pickup +N in 1h".

### 4.3 Manual-override protection
- New table `manual_rate_overrides(hotel_id, stay_date, room_type, set_by, set_at, locked_until)`.
- Whenever a revenue manager edits a price in the Channel Manager UI → insert/refresh override (default lock 7 days).
- Engine **never** auto-changes a locked cell. Instead it creates a `rate_recommendations` row (status=`pending_manual_review`) and shows a visual badge on that cell ("System suggests +€15 — approve / reject"). Approval applies via `previo-push-rates`.

### 4.4 "Budapest 4★ city-center" pricing brain
Encoded as configurable rules (UI in `/revenue/settings`) seeded with sensible defaults from research:
- **Never undercut floor**: floor price per room type per season (high/shoulder/low). Engine cannot drop below floor even if occupancy is weak.
- **Pace-based**: compare current pickup pace to same day last year (from `revenue_yearly_performance`). Below pace → small drop (€5) only if > 21 days out and not below floor. Above pace → raise.
- **Day-of-week weighting**: Fri/Sat premium, Sun/Mon discount.
- **Event awareness**: keep existing `revenue-events-fetch`; events boost ceiling by 30%.
- **Length-of-stay**: encourage 2+ nights when occupancy < 50%, 14+ days out (min-stay tweak instead of price drop).
- **Compset placeholder** for future rate-shopper integration.
- Goal function: maximize occupancy × ADR (RevPAR), with hard floor and soft ceiling. Bias toward filling the house at fair price rather than discounting deeply.

### 4.5 UI surfacing
- On `/revenue/[hotel]`: 12-month grid showing Occ%, ADR, system-set price, manual-override badge, pending recommendations, YoY comparison chip.
- "Activity feed" panel: every automatic price change in last 7 days with reason.
- Email digest daily 08:00 to admins summarizing changes + alerts.

---

## Phase 5 — Housekeeping API bridge (additive only)

- New `previo-sync-housekeeping-status` reads room-status from Previo (clean/dirty/inspected) and **mirrors** to a new column `pms_status` on existing `rooms` table.
- Existing housekeeping logic continues to use its own `status` field — no behavioral change.
- Optional toggle per hotel: "Trust PMS status as source of truth". Off by default so live operations are not disrupted.
- On checkout in our app → push status to Previo via existing `previo-update-room-status`.

---

## Build pipeline (delivery order)

1. **P0 hotfixes** — sync test hotel rooms, silence "Failed to fetch rooms" for non-PMS hotels.
2. **P1 data layer** — previoClient + cache tables + cron syncs.
3. **P4.1 + 4.2** — pickup detection, email/in-app alerts, automatic +€10–€20 pricing (writes blocked behind a feature flag until reviewed).
4. **P4.3 + 4.4** — manual overrides, Budapest pricing rules, settings UI.
5. **P4.5** — 12-month grid, activity feed, daily digest.
6. **P2** — Channel Manager Previo-style UI.
7. **P3** — Reservations + Guests pages from API.
8. **P5** — Housekeeping mirror (opt-in).

Each phase ships behind a feature flag per hotel so `/rdhotels` production is unaffected until you opt in.

---

## Technical notes

- All Previo calls go through `_shared/previoClient.ts` (Basic auth, retries, redirect=manual, JSON guard — already implemented in `previoAuth.ts`).
- New tables get RLS scoped by `assigned_hotel` + `organization_slug` per project memory.
- Email alerts use existing `send-email-notification` function; recipients = users with role `admin` or `top_management` for that org.
- Cron via `pg_cron` + `pg_net` invoking edge functions with service-role JWT.
- No changes to existing `cleaning_assignments`, `attendance_records`, `rooms.status`, ticket flow.

---

## Open questions before I start (will ask after plan approval)

1. Auto-push price changes immediately, or always require manager approval first (safer rollout)?
2. Default price floor per room type for the test hotel — do you have numbers, or should I infer from last 90 days minimum?
3. Lock duration for manual overrides — 7 days OK, or until manager clears it?
4. Email recipients — all admins/top_management, or a specific revenue distribution list?
