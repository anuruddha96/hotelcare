## What's broken (evidence)

Ground truth from the uploaded Cleaning Excel (Previo's own report) — a room is a **checkout** only when the `Departure` column has a time (e.g. `11:00`). Everything else with `Occupied=Yes` is a **daily** room; when `Night/Total` shows the guest is on their last night (e.g. `2/2`, `3/3`) it should also carry the **C/O+1 "departs tomorrow"** badge.

Actual `rooms` table right now (Ottofiori):

- 102, 103, 105, 204, 205, 402, 406 → `is_checkout_room=true`, `departureTime="12:00"`, `currentNight=null`, `totalNights=null`, `guest_count=0` — should be **daily**.
- 203, 305, 403 → `is_checkout_room=false`, no `departureTime` — should be **checkout** (Excel has `11:00`).
- Every "checkout" row still has the old hardcoded `"12:00"` and `guest_count=0`, so the fresh `previo-pms-sync` output (real `departureTime`, real guest counts) never landed. The edge function needs a fresh deploy AND the classification/`Departure`/`Night-Total` fields have to actually come from the XML.
- DND flags from yesterday (`is_dnd=true` on 101, 203, 302, 404) are still set — nothing clears them on a new-day PMS refresh.

Plus a UI overflow: at ~1000 px the Dirty Linen desktop table with 9 columns escapes the surrounding Card.

## Fix plan

### 1. `supabase/functions/previo-pms-sync/index.ts` — align classification with the Excel

- **Checkout definition**: a room is `IsCheckoutRoom` only when the winning reservation has `departureDate === today` (or `statusId === 5` today). Rooms whose reservation runs past today (`departureDate > today`) — including guests on their last night — are **not** checkouts, even when `currentNight === totalNights`.
- **`Departure` field**: emit `res.departureTime` when present, else `"11:00"` (Ottofiori house rule), only when `isCheckoutRoom` is true. Never emit `"12:00"`.
- **`DepartureTomorrow` (C/O+1)**: true when `res.departureDate === today+1` AND `currentNight === totalNights` (guaranteed last night). This drives the C/O+1 chip without moving the room to Checkout Rooms.
- **Guest count**: always emit `res.guestsCount` when a reservation exists; never fall through to `0` for occupied rooms.
- **Night/Total**: always emit `CurrentNight` / `TotalNights` / `Night / Total` for any room with a matched reservation (currently missing for rooms where `<to>` accidentally equals today).
- Keep the widened `[today-30, today+3]` XML window and the `pms_upload_summary` rescue path untouched.

### 2. `src/lib/pmsRefresh.ts` — write what the sync returns, and prep the new day

- Persist `pms_metadata.currentNight` / `totalNights` / `departureTime` / `scheduledDepartureTomorrow` from every synced row, even when the room is not a checkout, so daily rooms show `Night/Total` and the C/O+1 badge.
- Always overwrite `guest_count` from the sync row (drop the current path that leaves `0` when the field is missing).
- **New-day DND reset**: at the top of a manual PMS Refresh, when the hotel's last `pms_metadata.lastPmsRefreshDate` is older than today, clear `is_dnd`, `dnd_marked_at`, `dnd_marked_by` for every room in the hotel before applying the sync rows. This gives housekeeping a clean DND slate for the new day (existing DND submitted today is untouched because the reset runs once per calendar day).
- Keep `preserveExistingCheckout` guard, but base it on the sync's own `reservationFallbackSource === null && pmsCheckoutSignals === 0` (true "empty feed") so a healthy sync that legitimately reclassifies a stale checkout back to daily is allowed to write `is_checkout_room=false`.

### 3. `src/components/dashboard/CheckoutRoomsView.tsx` — keep chip in sync

- Read `departureTime` from either the sync row or `pms_metadata.departureTime`; never render `"12:00"`. Fall back to `"11:00"` only when the metadata is truly blank.

### 4. `src/components/dashboard/SimplifiedDirtyLinenManagement.tsx` — table overflow

- Force the mobile card layout below `lg` (`< 1024 px`) using `useIsMobile`-style reactive breakpoint hook instead of the one-shot `window.innerWidth` check, so 1000–1023 px viewports render the compact cards.
- Add `overflow-hidden` to the wrapping `Card` and keep the existing `overflow-x-auto` scroll wrapper for the desktop table, so the table can never visually escape the Card even at intermediate widths.

### 5. Redeploy edge function

- After the code edits, deploy `previo-pms-sync` and immediately trigger one PMS refresh from the UI (or the plan runner) to overwrite the stale `"12:00"` / `guest_count=0` rows with the corrected values.

## Verification

- Post-refresh, query `rooms` for Ottofiori and confirm: only rooms 104, 201, 203, 303, 305, 401, 403, 404, 405 have `is_checkout_room=true`; every other occupied room has `currentNight`/`totalNights` populated; DND flags on 101/203/302/404 cleared; no `departureTime="12:00"` remains.
- Team View shows Checkout Rooms count = 9 with real check-out times; Daily Rooms show C/O+1 badge on 102, 103, 202, 302, 304, 402, 105, 205, 406 (last-night guests).
- Load Dirty Linen at 1000 px viewport: mobile cards render, table no longer bleeds outside the Card.

## Out of scope

No DB schema changes, no RLS changes, no changes to manual XLSX upload classification (already matches Excel), no changes to `previo-poll-checkouts` clean-status logic.
