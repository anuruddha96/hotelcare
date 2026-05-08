# Fix List

Four scoped fixes. All Previo-related changes stay gated to `previo-test` so OttoFiori and other live hotels remain untouched.

## 1. "Import from Previo" button (Rooms tab) not working

The button in `RoomManagement.tsx` calls `previo-sync-rooms` with `{ hotelId: '730099', importLocal: true }`. The edge function expects the **Previo numeric hotel ID** in `hotelId` and looks up the config row by `pms_hotel_id = '730099'`. We will:

- Add proper error surfacing (read `data.error` even when `error` is null — supabase-js swallows non-2xx into `data`).
- Verify the edge function's auth header forwarding (currently it pulls the user from `Authorization`, but `supabase.functions.invoke` already sends it — confirmed).
- The most likely real cause based on the screenshot ("Edge Function returned a non-2xx status code") is the `pms_hotel_id` lookup or credentials secret resolution. Add detailed `console.error` logging in the function and return the underlying message in the response body so the toast shows the real reason.
- Also accept `hotelId` as the HotelCare `hotel_id` (`previo-test`) and resolve the Previo numeric ID from the config row, so the frontend doesn't have to hard-code `730099`.

## 2. Auth page logo spacing

In `src/pages/Auth.tsx` (lines 211-221) the logo image is `h-16 sm:h-20 md:h-24` inside a `flex-col` with `gap-1`, but the `CardHeader` has `space-y-1 pb-3 sm:pb-4` and the image is `object-contain` inside its own box, leaving visual whitespace below the lotus.

- Replace the existing `hotelcare-logo-auth.png` asset with the newly uploaded `Hotelcare_app_logo-2.png` (copy to `src/assets/hotelcare-logo-auth.png`, overwriting).
- Tighten spacing: remove `gap-1`, set the image to `-mb-2` (or wrap in a tighter container) so the lotus visually sits right above "Hotel Care".
- Keep responsive sizing but reduce to `h-14 sm:h-16 md:h-20` so it doesn't dominate the card.

## 3. Memories Budapest — room 216 missing on `/bb` page

The roster file has the room as `66EC.QRP216`. The current `breakfast-roster-upload` edge function inserts the raw cell value (`row[cRoom]`) as `room_number`, so it stores `66EC.QRP216` while the rooms table / lookup uses `216`.

Fix in `supabase/functions/breakfast-roster-upload/index.ts`:
- Add a `normalizeRoomNumber(raw)` helper that:
  - Trims whitespace.
  - If the value matches a pattern like `<prefix>.QRP<digits>` or `<letters/digits>.<letters>(\d+)`, extracts the trailing digit group.
  - Otherwise, if the value contains digits, returns the last contiguous digit group (≥2 digits).
  - Falls back to the original trimmed string.
- Apply it to `room` before pushing into `upserts`.
- This is hotel-agnostic and safe: existing rooms that are already plain numbers (e.g. `101`) pass through unchanged.

Also re-run / re-upload the latest Memories Budapest roster after deploy (user action) so the row updates from `66EC.QRP216` → `216`.

## 4. Sync issues + auto Refresh Checkouts every 30 min

Two sub-fixes, all `previo-test` only:

### 4a. Surface real sync errors
- In `PMSUpload.tsx` `handlePrevioSync`, when `error` is set by `supabase.functions.invoke`, also fetch `data?.error` from the response context and show it in the toast (currently the user just sees the generic non-2xx message).
- Same treatment for the `Refresh Checkouts` button.
- In `previo-pms-sync` and `previo-poll-checkouts`, log and return the upstream Previo HTTP status + first 300 chars of body so failures are diagnosable.

### 4b. Auto Refresh Checkouts every 30 min + last-update display
Frontend-only polling (no new cron, keeps the change isolated to `previo-test` UI):

- In `PMSUpload.tsx`, when `selectedHotel === 'previo-test'`:
  - On mount, read `pms_sync_history` for the most recent `sync_type = 'checkouts_poll'` row for this hotel and store `lastCheckoutSync`.
  - Set up a `setInterval` (30 min) that calls the same `previo-poll-checkouts` invocation as the manual button, then refreshes `lastCheckoutSync`.
  - Also auto-trigger one poll on mount if `lastCheckoutSync` is older than 30 min.
  - Render a small muted line next to the "Refresh Checkouts" button: `Last auto-update: <relative time>` (using a simple `formatDistanceToNow` from `date-fns`, already in the project).
  - Clear the interval on unmount / when the hotel changes away from `previo-test`.

No changes to scheduled jobs, OttoFiori, or any other hotel.

## Files to touch

- `src/pages/Auth.tsx` — logo asset + spacing.
- `src/assets/hotelcare-logo-auth.png` — replace with uploaded `Hotelcare_app_logo-2.png`.
- `src/components/dashboard/RoomManagement.tsx` — better error surfacing on Import from Previo.
- `src/components/dashboard/PMSUpload.tsx` — better error surfacing + auto-poll interval + last-update label.
- `supabase/functions/previo-sync-rooms/index.ts` — accept `hotelId === 'previo-test'`, more verbose error responses.
- `supabase/functions/previo-pms-sync/index.ts` — return upstream Previo error details.
- `supabase/functions/previo-poll-checkouts/index.ts` — return upstream Previo error details.
- `supabase/functions/breakfast-roster-upload/index.ts` — `normalizeRoomNumber` helper.

## Verification

- Click **Import from Previo** in Rooms tab while on `previo-test` → toast shows either success counts or the real Previo/Supabase error.
- Auth page → lotus logo sits visually adjacent to the "Hotel Care" wordmark.
- Re-upload the Memories Budapest breakfast roster → `/bb` lookup for room `216` returns the row.
- On `previo-test` PMS Upload tab → "Last auto-update: X minutes ago" is visible; after 30 min (or immediate stale poll) the timestamp advances; OttoFiori PMS Upload UI is unchanged.