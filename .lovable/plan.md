## What I found (verified against the live database)

Today's PMS sync for Ottofiori actually **worked correctly**. In the `rooms` table for 2026‑08‑03, exactly **14 rooms** carry `is_checkout_room = true` (102, 103, 104, 105, 202, 204, 301, 303, 304, 305, 402, 404, 405, 406) — this matches the 14 departure rows in your Previo Cleaning list. `pmsSyncDate` is today on all 21 rooms.

The "19" comes from the **UI**, not the sync:

- `HotelRoomOverview.tsx` buckets a room into Checkout Rooms if `is_checkout_room` **OR** today's assignment has `assignment_type = 'checkout_cleaning'`.
- Today's assignments for **101, 201, 205, 401, 403** were created as `checkout_cleaning` while those rooms still carried yesterday's checkout flags (they were genuine checkouts on 08‑02). Today's PMS sync correctly cleared their flags, but the already-created assignment rows kept the old type.
- 14 PMS checkouts + those 5 stale assignments = the 19 shown, and Daily Rooms drops to 2 instead of the real 6–7.

Also confirmed: **no-show count of 0 is correct** — no reservation for today has a no-show status or note in the current snapshot. Room 401 is a special case: it is vacant with an arrival today (14:30), so it is neither a checkout nor a daily stayover, but the current code has no arrival bucket and would fall into Daily.

## The fix

**1. Make PMS the single source of truth for buckets (frontend)**
- In `HotelRoomOverview.tsx`, when today's PMS snapshot is authoritative (`pms_metadata.pmsSyncDate` = today's Budapest date), bucket **only** on `is_checkout_room` / `scheduledDepartureToday` / `manual_checkout`. Use `assignment_type` as a fallback only when there is no fresh PMS data for the room.
- Same rule applied wherever the checkout/daily label is derived for cards: `AssignedRoomCard.tsx` (housekeeper "Checkout Clean" header), `HousekeepingManagerView.tsx`, `FloorMap`, and the section counters ("14 PMS · 0 manual").

**2. Reconcile assignments on every PMS refresh (frontend sync path)**
- In `src/lib/pmsRefresh.ts`, after room updates, correct today's `room_assignments` whose `assignment_type` no longer matches the PMS classification, but only for assignments still in `assigned` / `dnd_pending_retry` state (never touch `in_progress`, `completed`, or approved work).
- Also realign `ready_to_clean` and the checkout-derived towel/linen expectations for those rows, and log a `pms_change_events` entry (`assignment_type_corrected`) so managers can see it in the changes drawer.
- Rooms already started as a checkout clean keep their type and get a small "PMS: daily" mismatch hint on the chip instead of being silently switched.

**3. Add an Arrival bucket so vacant-with-arrival rooms are correct**
- Persist `arrivalToday` in `pms_metadata` during refresh (the Previo row already carries `Arrival` / `ArrivalDate`).
- In the overview, rooms that are not checkout, not occupied, and have an arrival today render in a small **Arrivals** section (prep/inspection) instead of being counted as Daily Rooms.

**4. One-off data correction for today**
- Reset the 5 stale `checkout_cleaning` assignments (101, 201, 205, 401, 403) to `daily_cleaning` where they have not been started, so today's board is right immediately without waiting for the next sync.

## Result
Checkout Rooms shows 14, Daily Rooms shows the real stayovers, Arrivals are separated, no-show stays accurate, and a future auto-assign run before the day's sync can no longer poison the buckets.
