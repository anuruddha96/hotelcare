
# Previo API Integration — Preparation Plan

## Information to send to Previo (answers ready to paste)

**1. For what purpose will the API connector be used?**
- Revenue Management System (primary, phase 1)
- Channel manager (read availability/rates, push rates in phase 2)
- Booking engine (read reservations for forecasting/pickup)
- Housekeeping (room status sync, phase 3)
- *Other:* PMS room/reservation sync for operational dashboards (already partially in use for OttoFiori)

**2. Where does the application run?**
- On your server (Lovable Cloud / Supabase Edge Functions, EU region)

**3. Outbound IP addresses for whitelisting (sensitive data access)**
- Supabase Edge Functions egress IPs for project `pcmszqqklkolvvlabohq` (EU region). I will pull the current static egress IP list from Supabase dashboard and provide it. As of today Supabase Edge Functions egress through a small set of fixed IPs per region; we will share that exact list with Previo.
- Custom domain origin: `my.hotelcare.app` (no inbound traffic to Previo, listed for reference only).

**4. APIs we will use** (per the linked docs)
- REST API (`api.previo.app`) — rooms, reservations, rate plans, calendar, reports
- CHM API (`chm.apidocs.previo.app`) — channel manager rates/availability push
- XML API (`xml.apidocs.previo.app`) — fallback for any endpoint missing in REST
- POS / EQC — not in scope yet

**5. Auth method:** HTTP Basic (login + password per hotel), stored as Supabase secrets, never in DB or client code.

---

## Guarantee: OttoFiori is not affected

Today only OttoFiori uses Previo (via `previo-sync-rooms`, `previo-sync-reservations`, `previo-update-room-status`, `previo-update-minibar`, `previo-push-rates`). We will:

1. Add a new column `pms_configurations.auto_sync_enabled` (default **false**) and a `connection_mode` enum (`manual` | `scheduled`). OttoFiori's existing row will be backfilled with its current behaviour so nothing changes for them.
2. All new hotels default to `is_active=false`, `sync_enabled=false`, `auto_sync_enabled=false`. Nothing connects to Previo until an admin explicitly flips the switches in the PMS Configuration screen and clicks "Connect".
3. No global cron will be added. Any future scheduled job will read `auto_sync_enabled=true` AND `sync_enabled=true` AND `is_active=true` — OttoFiori stays on its current manual flow unless you opt them in.
4. All new edge functions will hard-filter by `hotel_id` passed from the client and will refuse to run if `pms_configurations.is_active=false` for that hotel.

---

## Phase 1 — Revenue Management connection (this round)

### Database (migration)
- Add to `pms_configurations`:
  - `credentials_secret_name TEXT` — the name of the Supabase secret holding `login:password` for that hotel (e.g. `PREVIO_HOTEL_<slug>`).
  - `auto_sync_enabled BOOLEAN DEFAULT false`
  - `connection_mode TEXT DEFAULT 'manual' CHECK (connection_mode IN ('manual','scheduled'))`
  - `last_test_at TIMESTAMPTZ`, `last_test_status TEXT`, `last_test_error TEXT`
- New table `previo_rate_snapshots` (per-hotel, per-day pulled rates/availability for the RMS pickup engine):
  - `id`, `hotel_id`, `organization_slug`, `stay_date`, `rate_plan_id`, `room_kind_id`, `rate_eur NUMERIC`, `availability INT`, `restrictions JSONB`, `pulled_at TIMESTAMPTZ`, unique `(hotel_id, stay_date, rate_plan_id, room_kind_id)`.
- RLS: hotel-scoped read for `manager`/`top_management`/`admin` via `has_role` + `assigned_hotel` match; service role writes only.

### New edge functions (all `verify_jwt = true`, hotel-scoped)
1. `previo-test-connection` — calls `GET /rest/hotels` with the hotel's stored credentials, writes `last_test_*` fields. Returns 200/4xx with a clear message.
2. `previo-pull-rates` — for a given `hotelId` + date range, pulls rate plans + calendar from REST, upserts into `previo_rate_snapshots`. Used by RMS pickup. Manual trigger only in phase 1.
3. `previo-pull-reservations-rms` — minimal reservation pull (arrivals/departures/ADR) for pickup calculations, scoped to the requesting hotel. Read-only, no writes to operational `rooms` table.
4. (Re-use existing) `previo-push-rates` stays a 501 placeholder until you confirm rate-plan IDs.

All four use the same pattern as the post-fix `revenue-*` functions: `anonClient.auth.getUser(token)` for auth, then `serviceClient` for DB writes, and they refuse to run unless `pms_configurations.is_active=true` for the requested hotel.

### UI changes
- **`PMSConfigurationManagement.tsx`** (admin only):
  - Add a "Connection mode" radio: Manual / Scheduled (default Manual).
  - Add a "Test connection" button that calls `previo-test-connection` and shows the result inline (green ✓ or red error with Previo's message).
  - Add a "Credentials secret name" field — admin pastes the Supabase secret name they configured (we will not store the password in the DB).
  - Add a clear banner: *"This hotel will not contact Previo until both 'Active' and 'Sync enabled' are turned on."*
- **`RevenueHotelDetail.tsx`**:
  - Add a "Pull from Previo" button next to the existing "Upload pickup file" button. Disabled if no active Previo config for the hotel. Calls `previo-pull-rates` then refreshes the grid.
  - Show last-pull timestamp + source badge ("Previo" vs "Manual upload") on each rate cell tooltip via `PricingDriverChips`.

### Secrets (per hotel, you create them when ready)
- `PREVIO_HOTEL_OTTOFIORI` — already implicitly in use via `PREVIO_API_USER` / `PREVIO_API_PASSWORD`. We will keep those env vars working as a fallback for OttoFiori only and migrate them to the new per-hotel secret on your signal.
- For each new hotel: `PREVIO_HOTEL_<SLUG>` containing `login:password` base64 — added via Supabase secrets, not in code.

---

## Phase 2 / 3 (sketched, not built now)
- Phase 2: Channel-manager push (rates/availability/restrictions) once you confirm rate-plan ID mapping per hotel.
- Phase 3: Operational sync (rooms, reservations, minibar, room status) — re-use existing `previo-sync-*` functions, gated by the same `auto_sync_enabled` flag.

---

## New Logo rollout

Three uploads provided:
- `Hotelcare_app_logo.png` — bright cyan lotus on white, full-bleed (use as **app icon / PWA / favicon**).
- `1.png` — lighter cyan lotus, transparent background (use as **header logo on dark backgrounds**).
- `2.png` — same as 1, slightly different crop (use as **email / login splash**).

Steps:
1. Copy assets:
   - `Hotelcare_app_logo.png` → `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`, `public/favicon.ico` source, and `src/assets/hotelcare-logo-mark.png`.
   - `1.png` → `src/assets/hotelcare-logo-light.png` (header on dark bg).
   - `2.png` → `src/assets/hotelcare-logo-auth.png` (Auth/Breakfast/GuestMinibar splash).
2. Replace logo references in: `Header.tsx`, `Auth.tsx`, `GuestMinibar.tsx`, `Breakfast.tsx`, `CompanySettings.tsx` default, and `manifest.webmanifest` icons.
3. Update `index.html` `<link rel="icon">` and `<meta property="og:image">` to the new mark.
4. Service worker notification icon already points to `/icon-192.png` — no code change, just the asset swap.

---

## Files touched (summary)

**New:**
- `supabase/migrations/<ts>_previo_phase1.sql`
- `supabase/functions/previo-test-connection/index.ts`
- `supabase/functions/previo-pull-rates/index.ts`
- `supabase/functions/previo-pull-reservations-rms/index.ts`
- `src/assets/hotelcare-logo-mark.png`, `hotelcare-logo-light.png`, `hotelcare-logo-auth.png`

**Modified:**
- `supabase/config.toml` (register 3 new functions, `verify_jwt = true`)
- `src/components/admin/PMSConfigurationManagement.tsx` (test/connect UI, mode toggle, secret-name field, safety banner)
- `src/pages/RevenueHotelDetail.tsx` (Pull-from-Previo button + source badges)
- `src/components/revenue/PricingDriverChips.tsx` (show source line)
- `src/components/layout/Header.tsx`, `src/pages/Auth.tsx`, `src/pages/Breakfast.tsx`, `src/pages/GuestMinibar.tsx`, `src/components/dashboard/CompanySettings.tsx`
- `index.html`, `public/manifest.webmanifest`, `public/icon-*.png`, `public/favicon.ico`

No changes to OttoFiori's existing edge functions, room-mapping data, or sync history.
