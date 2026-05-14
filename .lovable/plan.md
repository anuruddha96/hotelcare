# Plan — Live Previo → Revenue auto-sync (previo-test only) + checkout count fix

## Scope guard
**Only `hotel_id = 'previo-test'` is touched by the new automation.** All other hotels (incl. `hotelcare-test`, OttoFiori, etc.) keep the current XLSX-upload flow unchanged.

---

## Part A — Real Previo data into Revenue (auto on login)

The previous fix made the 405 silent because we were calling a non-existent `/rest/calendar` endpoint. Previo's actual data we *do* have access to is the **XML `searchReservations`** API (already used in `previo-pms-sync` for today). We will reuse it over a 12-month window to derive Pickup, Occupancy, and Daily Overview ourselves — no new Previo endpoint needed.

### A1. New edge function `previo-pull-revenue` (replaces `previo-pull-rates` for previo-test)
- Hard-gate: returns `{ ok:true, supported:false }` for any `hotelId !== 'previo-test'`.
- Inputs: `{ hotelId, days = 365 }`.
- Steps:
  1. Load `pms_configurations` row, parse credentials (same logic as `previo-pms-sync`).
  2. Fetch `/rest/rooms` once → total room inventory (denominator for occupancy).
  3. Call XML `searchReservations` with `term = [today, today + 365d]`. Skip statusId 7 (cancelled) and 8 (no-show).
  4. For each day D in the next 365 days, compute:
     - **rooms_sold(D)** = count of reservations where `arrivalDate ≤ D < departureDate`.
     - **occupancy_pct(D)** = rooms_sold / total_rooms.
     - **bookings_current(D)** = count of reservations whose `arrivalDate == D` (new arrivals — used as "pickup current" baseline).
     - **breakfast/people(D)** = sum of `<guest>` count for reservations active on D, plus their notes (used by /bb).
  5. Upsert per stay_date into:
     - `occupancy_snapshots` (`hotel_id, organization_slug, stay_date, occupancy_pct, rooms_sold, snapshot_label='previo-live', source='previo'`).
     - `pickup_snapshots` (`bookings_current = arrivals_for_D`, `bookings_last_year = NULL`, `delta = NULL`, `snapshot_label='previo-live'`, `source='previo'`). Pickup deltas vs prior snapshot are computed by the existing pickup engine on read; we only write the current-day booking count.
     - `breakfast_roster` per `(hotel_id, stay_date, room_number)`: `pax = guestsCount`, `breakfast_count = guestsCount` if reservation note contains a breakfast marker (configurable: default treat all bookings as breakfast=pax for previo-test since Previo Test is the breakfast pilot — toggleable later). `guest_names` left empty until guest-list endpoint is wired (out of scope).
  6. Return `{ ok:true, supported:true, days, rooms, reservations, upserts: { occupancy, pickup, breakfast } }`.
- Conflict targets already exist on these tables (used by current XLSX uploads); we'll match the same `onConflict` keys to avoid duplicates.

### A2. Wire into LiveSync (`src/contexts/LiveSyncContext.tsx`)
- Replace the `previo-pull-rates` invocation with `previo-pull-revenue`.
- Remove the "unsupported" sessionStorage short-circuit *for previo-test* (keep it for any other hotel — they remain "not supported"). 
- While the call is in-flight, `tasks.revenue.status = 'syncing'` is already wired → the existing pill + Revenue page banner will show "Refreshing live data…".
- On success, store `meta = { reservations, upserts, days }` so the Revenue page can show "Live · 365 days from Previo · last refresh hh:mm".

### A3. Revenue page (`src/pages/Revenue.tsx`)
- Replace the "Live rate sync not available" muted banner (for previo-test only) with a live status row:
  - Syncing → spinner + "Pulling 12 months from Previo…".
  - Success → green dot + "Live · last refresh ⟨relative⟩ · ⟨reservations⟩ reservations".
  - Error → red banner with retry button.
- Keep XLSX upload visible as a manual fallback (don't hide it).

### A4. Header pill (`LiveSyncIndicator.tsx`)
- No structural change — the existing Revenue task line will now show real progress for previo-test.

---

## Part B — Checkout count discrepancy (PMS pill = 3, Overview = 2)

### Root cause confirmed in DB
Right now only **room 105** has `is_checkout_room = true` in `rooms` for previo-test, yet the overview renders Salto 101 + 106. That means:
- The overview's "Checkout Rooms" count uses `is_checkout_room || assignment_type='checkout_cleaning'` (already known).
- `runPmsRefresh` did update `is_checkout_room=true` for the 3 PMS departures returned by Previo — but only **one of them** (room name "Salto 101") matches a `rooms` row, because the new XML reservation includes 3 rooms whose Previo `name` doesn't cleanly map to numeric `room_number`. Room 106 in the overview is purely from a manual `checkout_cleaning` assignment, not from PMS.

### Fix
1. **`supabase/functions/previo-pms-sync`** — when emitting rows, also include `roomId` (Previo numeric ID) and the raw `roomKindName` so the client can fall back through more matchers.
2. **`src/lib/pmsRefresh.ts`** — extend lookup order:
   - exact `room_number == rawRoomName`
   - exact `room_number == extractedDigits` 
   - **new:** match against `rooms.pms_room_id` (or `pms_room_mappings`) using Previo `roomId`
   - **new:** ilike fallback on the trailing token (`Salto 101` → matches room with code `Salto 101` *or* number `101`)
3. **Reset stale flags:** before applying the new snapshot, clear `is_checkout_room=false, checkout_time=null` for all rooms in the hotel that are NOT in today's PMS departure set. This prevents yesterday's checkout (room 105) from lingering.
4. **Overview component** (`HotelRoomOverview.tsx`) — add a tiny breakdown under the "Checkout Rooms" header: `{pmsCount} from PMS · {manualCount} manual` so the source of each room is obvious.

After this, the PMS pill ("3 checkouts") and the overview count will reconcile to 3 (assuming all 3 PMS departures match a local room — if any still don't match, the sync history will show `notFound` and we'll surface that as a warning chip on the pill).

---

## Out of scope
- Pushing rates back to Previo.
- Wiring `hotelcare-test` (788619) — left as-is until the user confirms.
- Guest-name population in `breakfast_roster` (Previo XML doesn't return guest first/last in the reservation block; would need `getReservationDetails` per ID — defer).
- Any change to non-Previo hotels' upload flows.

## Files

**New**
- `supabase/functions/previo-pull-revenue/index.ts`

**Edited**
- `src/contexts/LiveSyncContext.tsx` — call new function, drop unsupported gate for previo-test.
- `src/pages/Revenue.tsx` — live status row.
- `src/lib/pmsRefresh.ts` — extra lookup strategies + clear stale checkout flags.
- `supabase/functions/previo-pms-sync/index.ts` — emit `roomId` + raw name in rows.
- `src/components/dashboard/HotelRoomOverview.tsx` — PMS vs manual breakdown.

**Removed/deprecated**
- `supabase/functions/previo-pull-rates/index.ts` — kept as a thin shim that returns `supported:false` so any cached client still works; will delete once LiveSync is updated.
