## Root cause

I analyzed the uploaded XLSX (`cleaning-786631-2026-07-14.xlsx`) plus the two paths that write to the rooms table. There are two different sync paths in the app and they classify rooms differently — that's why the live env (which still runs on the last manual upload) looks correct, and the test env (which ran a fresh Previo API sync) shows 21 checkouts / 0 daily.

**Bug in `previo-pms-sync` edge function (line 380):**
```ts
const isCheckoutRoom = isCheckedOut || isDeparture || isDepartureTomorrow;
```
Every reservation with `departureDate === tomorrow` is being flagged as a checkout room. On any given day, most staying rooms are on some future night, and a large chunk of them happen to depart tomorrow — so they all get shoved into "Checkout Rooms" with a `C/O+1` badge and the Daily Rooms bucket empties out. That's exactly what the second screenshot shows (rooms 102/104/105/303/401/402/403/404 all have `C/O+1` and there are 0 daily rooms).

**What the XLSX actually says for today (2026‑07‑14):**
- Real checkouts today (rows with a `Departure` time and no `Night/Total`): 405, 201, 102, 103, 303, 402, 104, 204, 205, 406 → 10 checkout rooms.
- Already checked out (Occupied=No + Departure time): 401, 105 → 2 more.
- Daily / staying (has `Night/Total` where current < total): 101 (2/3), 301 (2/4), 202 (2/3), 302 (2/3), 304 (2/3) → 5 daily rooms.
- Last-night stays (current == total, depart tomorrow): 403 (4/4), 203 (2/2), 404 (3/3), 305 (2/2) → these should be **daily today** with a small "departs tomorrow" hint, NOT checkout rooms.

So the correct picture is roughly 12 checkouts + 9 daily. Currently the API sync produces 21/0 and the manual upload produces 19/2 (also wrong because the manual path's daily detection only counts rows where `Occupied=Yes` AND there's no departure — it drops rows once the XLSX marks them checked-out).

## Fixes

### 1. Stop treating "departs tomorrow" as a checkout room
`supabase/functions/previo-pms-sync/index.ts`:
- Change `isCheckoutRoom` to `isCheckedOut || isDeparture` only. Keep `DepartureTomorrow: true` in the emitted row so the UI can still render the `C/O+1` badge.
- Consequence: `pmsRefresh.ts` (line ~178 `shouldBeCheckoutRoom`) currently ORs in `isDepartureTomorrow` too — remove that. Rooms depart‑tomorrow will still get the C/O+1 chip because `pms_metadata.scheduledDepartureTomorrow` is still written, but they stop landing in the Checkout section and stay in Daily Rooms where they belong.

### 2. Fix the manual XLSX path so a room with `Occupied=No` + a `Departure` time still counts as a real checkout (already done today) but rooms with a `Night/Total` where current < total classify as Daily even when Occupied cell is blank/ambiguous
`src/components/dashboard/PMSUpload.tsx`:
- Extend the `else if (isOccupiedYes ...)` daily branch: if `parsedNightTotal && guestNightsStayed < totalNights` treat as daily too. This makes the XLSX path emit the same 5 daily rooms shown above.

### 3. Remove the confusing new "PMS SYNC" blue button block
`src/components/dashboard/HousekeepingTab.tsx` (or wherever `<PmsSyncControls />` is mounted above Team Management):
- Un-mount `<PmsSyncControls />` from the manager Team View. Keep it available for admins only inside `AdminTabs → PMS Config` (where it already lives). The existing `Refresh` button on the `Hotel Room Overview` card stays — that's the one you use.
- The green dot you noticed was `bg-emerald-500` on this same card; removing the block makes the question moot, and the health chip stays in the admin PMS Config panel.

### 4. Make the admin PMS Upload enable/disable toggle discoverable
The toggle already exists in `PMSConfigurationManagement` ("Hide legacy PMS Upload tab"). To find it today:
`Admin → PMS Config → pick the hotel → Previo Configuration card → "Hide legacy PMS Upload tab" switch.`

To reduce future confusion:
- Add a small `Settings` icon button labelled "Admin PMS settings" in the HousekeepingTab header (admin-only) that deep-links straight to `/admin?tab=pms-config&hotel=<id>` and scrolls to the toggle.
- Rename the toggle label to "Show PMS Upload tab to managers" (inverted, defaults to on) so it reads naturally.

### 5. Legend / chip sync
No code change — once fix #1 lands the counts will match again. Daily Rooms will be populated, `C/O+1` chip will still show for rooms departing tomorrow (badge is unchanged).

## Not doing right now (please confirm)
- **DB revert of yesterday's overwrites.** Code fixes above stop the bleeding but won't restore any `is_checkout_room` flags flipped during today's bad sync. If you want I can also run a targeted UPDATE that clears `is_checkout_room=false` for rooms whose `pms_metadata.scheduledDepartureTomorrow=true` AND `scheduledDepartureToday=false` — this reproduces the corrected classification for the affected hotel. Say the word and I'll add it as a migration in build mode.
- Auto-poller pause overnight — leaving on unless you say otherwise, since fix #1 makes it safe.

## Files touched
- `supabase/functions/previo-pms-sync/index.ts` (1 line)
- `src/lib/pmsRefresh.ts` (2 lines around `shouldBeCheckoutRoom`)
- `src/components/dashboard/PMSUpload.tsx` (daily branch extension)
- `src/components/dashboard/HousekeepingTab.tsx` (remove `<PmsSyncControls />` mount, add admin shortcut button)
- `src/components/admin/PMSConfigurationManagement.tsx` (toggle label rename)
