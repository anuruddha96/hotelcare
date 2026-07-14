## Fix PMS Upload tab visibility + add No Show rooms section

### 1. PMS Upload tab still visible for managers
**Root cause:** `pms_configurations` RLS allows SELECT only for admins. Manager Ricsi's visibility query returns `null`, so `hidePmsUploadTab` stays `false` and the tab renders regardless of the admin toggle.

**Fix:** Add a `SECURITY DEFINER` RPC `get_pms_upload_hidden(hotel_key text)` that resolves the hotel key against `hotel_configurations` and returns the single `hide_pms_upload_page` boolean. Grant EXECUTE to `authenticated`. Replace the direct table read in `HousekeepingTab.tsx` with `supabase.rpc('get_pms_upload_hidden', { hotel_key: assignedHotel })`. RLS on the table itself is unchanged — admins keep exclusive write access.

### 2. No Show rooms
**Definition:** A PMS row where `Occupied = no` AND `Arrival`, `Departure`, and `Night / Total` are all blank.

**Detection**
- `previo-pms-sync/index.ts` row emitter: when a fetched room has no reservation for today (no arrival, no departure, no night counts) set `IsNoShow: true` on the emitted row. Orthogonal to existing daily/checkout logic.
- `pmsRefresh.ts`: when `row.IsNoShow === true`, set `pms_metadata.isNoShow = true` (clear otherwise). Do NOT set `is_checkout_room`. Emit a `pms_change_events` row of type `no_show_detected` on the false→true transition.

**UI in `HotelRoomOverview.tsx`**
- New collapsible section directly under **Daily Rooms** titled **No Show Rooms**. Lists rooms where `pms_metadata.isNoShow === true` AND `is_checkout_room === false`. Header shows count; entire section hidden when count is 0.
- Each card shows an amber `NO SHOW` badge and a one-line explainer: "Guest did not arrive — PMS shows no active reservation".
- Existing Mark Clean / Assign actions remain available, but tapping them opens a small confirm dialog: "This room is flagged as a no-show. Continue and move to clean?" (Confirm / Cancel). No changes to housekeeper allotments — same write paths as daily rooms.

**Safety guarantees**
- No-show flag never overrides an existing `room_assignments` row.
- Checkout poller and PMS sync continue to preserve assignments as before.
- No changes to PMS Upload XLS parser, auto-assign algorithm, or checkout poller.

### Files
- **New migration:** `public.get_pms_upload_hidden(text)` SECURITY DEFINER + GRANT EXECUTE to authenticated.
- `src/components/dashboard/HousekeepingTab.tsx` — switch visibility read to RPC.
- `supabase/functions/previo-pms-sync/index.ts` — emit `IsNoShow`.
- `src/lib/pmsRefresh.ts` — persist `pms_metadata.isNoShow` + change event.
- `src/components/dashboard/HotelRoomOverview.tsx` — No Show section, badge, confirm dialog.
- `src/lib/room-overview-translations.ts` — new strings in en/hu/es/vi/mn.

### Not doing
- No schema changes on `rooms` (reuse `pms_metadata` JSON).
- No changes to `pms_configurations` RLS.
- No changes to the PMS Upload XLS flow, blue Sync button, or admin toggle behavior.
