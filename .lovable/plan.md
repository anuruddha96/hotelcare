# Revenue Management fixes: access, accuracy, navigation + linen UI

## 1. Top management cannot see the Rate & pickup calendar

Verified cause: both top-management accounts (Dimi, Ricsi) have the role `top_management_manager`, but the database read policy on `room_types` only allows `admin`, `top_management`, `manager`, `housekeeping_manager`. With no room types readable the grid falls back to "No room types yet — run a sync". The same role is missing from the `is_revenue_user()` helper and from the sync-history read policy (so "last synced" never shows either).

Fix: add `top_management_manager` to
- the `room_types` read (and write) policies,
- `is_revenue_user()` / `user_can_access_hotel()` role lists,
- the `pms_sync_history` read policy (admins, managers, top management).

## 2. Navigation while in Revenue Management

The revenue detail page renders no app header and no main tab bar, so top managers get stuck with no way to reach Maintenance / Reception / Housekeeping / HR / Invoices, switch hotel, change language, or log out.

Fix: render the standard app `Header` plus `MainTabsBar` (current = revenue) at the top of both `/:org/revenue` and `/:org/revenue/:hotelId`, exactly like the admin screenshot. Keep the quiet revenue sub-header underneath.

## 3. Pickup shows "+" for negative movement

Verified cause: net pickup needs a comparison snapshot from N days back, and only one snapshot date exists so far, so the grid and chart fall back to `newBookings`, which counts newly created nights only and can never go negative.

Fix:
- Store cancelled / no-show reservations during the Previo revenue sync instead of discarding them (a `revenue_cancelled_nights` table with stay date and cancellation timestamp).
- Net pickup for a window = nights created in the window − nights cancelled in the window, so Aug 14–17 reads negative just like Previo.
- Keep the snapshot-difference method as a cross-check once older snapshots exist; never silently fall back to a positive-only number — show "·" when unknown.
- Same value feeds the grid Pickup row, the horizon chart bars and the "rooms in view" badge.

## 4. Occupancy is wrong (44% shown while the hotel is full)

Verified cause: occupancy divides rooms sold by the sum of `num_rooms` across all 11 Previo room types for Ottofiori = 45. That list double-counts inventory (physical unit groups "Room (cap 2) — 15 units", "cap 3 — 5", "cap 4 — 1" = 21 rooms **plus** the rate-plan types Deluxe Queen 4 / Deluxe Twin 10 / Luxusní 5 / Čtyřlůžkový 1 / Ekonomický 1 = the same 21 rooms) and also includes three non-room products (Látógatóközpont, Breakfast, Coffee and Desserts). 20 sold ÷ 45 = 44%. Real sellable inventory is 21, and daily snapshots separately use 24, which is also wrong.

Fix:
- Add flags on room types: `is_sellable` (excludes breakfast/coffee/visitor-centre products) and `counts_toward_inventory` (only one of the two duplicate groupings counts), set automatically by the sync and editable by admins in Rooms Setup.
- Add an optional `sellable_rooms` override per hotel in revenue settings for cases where the PMS list is ambiguous; set Ottofiori to 21.
- Every occupancy figure (rate grid row, horizon chart, KPIs, daily snapshots written by the sync) uses this single inventory number, so today/tomorrow read ~100%.
- Backfill `rooms_available` on existing snapshot rows for Ottofiori.

## 5. RevPAR explanation

Add an info icon next to the RevPAR row (and the ADR row) in the rate grid, with a tooltip/tap popover: "RevPAR = ADR × Occupancy = room revenue ÷ all sellable rooms. It shows what every room in the hotel earns on average, sold or not." Works on touch as well as hover.

## 6. Morning PMS sync prompt

Verified cause: the morning sync is remembered in the browser per user (`liveSync.morningPms.<user>.<hotel>.<date>`), so every new user re-runs it, and the toast text is hard-coded "Good morning" regardless of the hour.

Fix:
- Decide from the property's sync history, not local storage: if a successful PMS sync already exists for that hotel today, do nothing for later users.
- If no sync exists for today, do not run silently — show a clear prompt ("Today's PMS data hasn't been synced yet") with a Refresh now button, and neutral time-aware wording (no "Good morning" in the afternoon).
- Keep the live progress + result toast once the user starts the refresh.

## 7. Dirty linen labels cut off (Russian / Ukrainian)

The item cards put the label and the counter side by side in a half-width card, so long Cyrillic words get clipped ("Простыни (Twin…", "Наматрас…").

Fix: restructure each item card so the full label sits on its own line above the − / value / + controls, wrapping instead of clamping, with the counter row full width and comfortable tap targets. Single column on narrow phones, two columns from ~420 px up, keeping the dialog fit-to-page.

## Technical notes

- Migration: policy/role updates, `revenue_cancelled_nights` table with grants + RLS, room-type inventory flags, `sellable_rooms` setting, snapshot backfill.
- Edge function `previo-revenue-sync`: record cancellations, classify sellable/inventory room types, write snapshots with the corrected `rooms_available`.
- Frontend: `useRevenueHotelData` (inventory + net pickup), `revenueAnalytics.buildDayMetrics`, `RateStrategyGrid`, `PickupHorizonChart`, `RevenueHotelDetail` (header/tabs), `LiveSyncContext` (sync prompt), `DirtyLinenDialog` (layout).

## Security note

Your message included what looks like a personal password. I have not used or stored it — please change that password.
