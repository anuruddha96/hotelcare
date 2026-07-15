
## Problem

`previo-pms-sync` misclassifies rooms because the XML `searchReservations` window is `[today, today+3)`. Previo's `<term>` filters by **arrival date**, so any guest who arrived *before* today (all mid-stay and today-departing guests) is missing from the result. Every such room then falls through to the `!res` branch and is flagged `IsNoShow=true`.

That produces the exact symptoms you reported:
- **101, 202** (mid-stay, e.g. 1/3): reservation not returned → classed as no-show instead of daily.
- **301 (3/4), 302, 304** (mid-stay): same reason → no-show instead of daily.
- **203, 305** (departing today, arrived earlier): reservation not returned → no-show instead of checkout.

Second bug: `isNoShow = !res && ...` treats *any* room without a reservation as a no-show. A true no-show requires a reservation whose arrival ≤ today that the reception marked as no-show. Empty rooms are just vacant.

Third: checkout time (`departure`) is currently hard-coded to `"12:00"` and not shown on the checkout room chip.

## Fix

### 1. Widen the reservation fetch window (`supabase/functions/previo-pms-sync/index.ts`)
- Change the XML `<term>` from `today → today+3` to `today-30 → today+3`. That guarantees every ongoing stay (arrival up to 30 days ago) plus today's/tomorrow's departures are captured. 30 days safely covers Previo's longest realistic stays; guests still get filtered downstream by the `arrival ≤ today < departure` check.
- Keep the existing `indexReservation` rank so same-day turnover still picks the outgoing reservation.

### 2. Parse a real departure time from the reservation XML
- Add a `departureTime` field to `ParsedReservation`. Read Previo's `<toTime>` (or the time portion of `<to>` when present) — fall back to `"11:00"` (Hotel Ottofiori standard) instead of `12:00` only when the reservation truly has no time.
- Propagate it into the emitted row as `Departure: res.departureTime`.

### 3. Correct no-show detection
- Redefine: a room is a **no-show** only when a reservation exists with `arrivalDate === today` AND Previo `statusId` indicates no-show. Previo uses `statusId = 6` for "no show" (documented in `searchReservations`) — capture that explicitly.
- Also honour the reception-side status: if `statusId === 6` OR the note contains `"no show"` (case-insensitive), flag it.
- Rooms with no reservation at all become plain **vacant** (`IsNoShow=false`, `Occupied=No`, no Departure, no Arrival) — the downstream PMSUpload flow already leaves those alone.

### 4. Show checkout time on the chip (`src/components/dashboard/CheckoutRoomsView.tsx`)
- The chip already renders `room.departureTime` in the right-hand meta area. Move/duplicate it directly under the room number line so it's visible on the chip itself (small muted text, e.g. `Check-out 11:00`). Only render when `status === 'checkout'` or `'early_checkout'`.

### 5. Regression guard
- After the widened window, `rooms.length === 0` fallback path stays untouched.
- The `pms_upload_summary` rescue block also stays as a belt-and-braces fallback when the XML feed is empty.

## Verification (after 5-min cron or manual "Refresh PMS")
1. Ottofiori test account, today 2026-07-15:
   - 101, 202, 301, 302, 304 → appear in **Daily Rooms** with correct `N/Total`.
   - 203, 305 → appear in **Checkout Rooms** with a `Check-out HH:MM` line on the chip.
   - Any true no-show (Previo statusId 6 for today's arrival) → still flagged No Show badge.
2. Edge logs show `[previo-pms-sync] XML returned N reservations, indexed M rooms` with M covering all occupied rooms.
3. No manual room status writes — wait for the 5-minute `previo-poll-checkouts` cron to reconcile.

## Files touched
- `supabase/functions/previo-pms-sync/index.ts` — window, no-show logic, departure time parsing.
- `src/components/dashboard/CheckoutRoomsView.tsx` — render checkout time on chip.
- `.lovable/plan.md` — log the change.

No DB migration, no RLS change, no manual room overrides.
