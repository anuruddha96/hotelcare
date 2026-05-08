## Goal
Connect the Previo sandbox account (Hotel ID `730099`, login `test_api@hotelcare.app`) to a brand-new isolated test hotel under the `hotelcare` organization, then verify rooms / rates / reservations sync end-to-end without touching OttoFiori or any production hotel.

## Steps

### 1. Add the Previo test credentials as a Supabase secret
- Add one new secret: **`PREVIO_HOTEL_TEST`**
- Value format (matches existing per-hotel pattern in `previo-test-connection`): `test_api@hotelcare.app:O5pBtjv3a10s`
- This is consumed by every `previo-*` edge function via `cfg.credentials_secret_name`, so no code change is needed in the functions themselves once they all follow the same resolver. (Verify and align: `previo-sync-rooms`, `previo-sync-reservations`, `previo-pull-rates`, `previo-push-rates`, `previo-update-room-status`, `previo-update-minibar` — patch any that still only read `PREVIO_API_USER` / `PREVIO_API_PASSWORD` so they prefer `credentials_secret_name` first, fallback to legacy global env.)

### 2. Create a new test hotel via migration
Insert one row into `hotel_configurations` (and any required sibling rows the existing onboarding flow creates — check `HotelOnboarding.tsx` for the canonical insert set):
- `hotel_id`: `previo-test`
- `hotel_name`: `Previo Test Hotel (730099)`
- `organization_slug`: `hotelcare`
- Mark inactive for housekeeping/PMS until verified, no real rooms attached.

### 3. Create the PMS configuration row
Insert into `pms_configurations`:
- `hotel_id`: `previo-test`
- `pms_type`: `previo`
- `pms_hotel_id`: `730099`
- `credentials_secret_name`: `PREVIO_HOTEL_TEST`
- `is_active`: `true`
- `sync_enabled`: `true`
- `connection_mode`: `manual` (no scheduled background sync — we trigger manually)
- `auto_sync_enabled`: `false`

### 4. Test connection (read-only)
- Open Admin → PMS Configuration, select "Previo Test Hotel (730099)".
- Click **Test Connection** → invokes `previo-test-connection` → expects `ok: true` with a non-zero `roomCount`.
- If it fails, surface the exact Previo error in `last_test_error`.

### 5. Sync rooms → build room mappings
- Trigger `previo-sync-rooms` for `previo-test`.
- It should pull room types from `https://api.previo.app/rest/rooms`. Persist them and (optionally) auto-create starter rows in `pms_room_mappings` so we can preview reservations without manual entry.

### 6. Pull rates
- Trigger `previo-pull-rates` for `previo-test`. Confirm rate plans and currencies come back. Write to whatever local rates table the function targets, scoped to `hotel_id = previo-test`.

### 7. Sync reservations
- Trigger `previo-sync-reservations` for `previo-test` (date window: today − 7d through today + 30d).
- Verify reservations land in the project's reservations table with `hotel_id = previo-test` and that no rows are written for any other hotel.

### 8. Verify in UI
- Front Desk / Reservations pages, with the test hotel selected, should show the synced data.
- OttoFiori and all other hotels must remain untouched (spot-check `last_sync_at` on their PMS config rows — should be unchanged).

## Technical notes
- Allowed Previo methods per the test creds cover everything we need: `Hotel.searchReservations`, `Hotel.reservation`, `Hotel.getRates`, `Hotel.getRoomKinds`, `rest/rooms`, `rate-plan`, etc. No push-side methods (e.g. `Reservation.create`) — `previo-push-rates` may be limited or rejected; treat 403s on push as expected for the sandbox and log clearly rather than failing hard.
- All edge functions must continue to require admin/top_management OR `assigned_hotel === 'previo-test'` for the caller — the existing authorization block in `previo-test-connection` is the template.
- No frontend feature changes; this is purely configuration + edge-function credential resolution alignment.
- After the migration, the `src/integrations/supabase/types.ts` regeneration is automatic.

## Files expected to change
- `supabase/migrations/<timestamp>_previo_test_hotel.sql` (new) — hotel + pms_configuration rows
- `supabase/functions/previo-sync-rooms/index.ts` — align credential resolver (if needed)
- `supabase/functions/previo-sync-reservations/index.ts` — align credential resolver (if needed)
- `supabase/functions/previo-pull-rates/index.ts` — align credential resolver (if needed)
- `supabase/functions/previo-push-rates/index.ts` — align credential resolver (if needed)
- `supabase/functions/previo-update-room-status/index.ts` — align credential resolver (if needed)
- `supabase/functions/previo-update-minibar/index.ts` — align credential resolver (if needed)

## Out of scope
- No changes to OttoFiori configuration.
- No scheduled/auto-sync enablement.
- No new UI surfaces — using existing PMS admin screens.
