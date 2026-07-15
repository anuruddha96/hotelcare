# Fix "PMS not connected" toast for manager ricsi.007 (Ottofiori)

## What's happening

- `pms_configurations` RLS only allows `admin` role to `SELECT`. Manager `ricsi.007` cannot read the row.
- `LiveSyncContext` queries `pms_configurations` from the browser to decide `hasPrevio`. For non-admins the query returns `null`, so `enabled = false` and the "PMS Refresh" button shows the "PMS not connected" toast.
- The 5-minute cron runs on the server with service role, so Ottofiori keeps auto-syncing correctly — matching what the user observed ("it automatically synced without me refreshing").
- Confirmed in DB: `profiles.assigned_hotel = 'ottofiori'`, `pms_configurations` row exists with `hotel_id='ottofiori'`, `pms_type='previo'`, `is_active=true`, `snapshot_read_enabled=true`.

## Fix (minimal, no behavior change for admins, no touch to cron / manager-approval flow)

1. **Add a SECURITY DEFINER RPC** `public.hotel_has_active_previo(_hotel_id text) → boolean` that returns `true` when a row exists in `pms_configurations` with `pms_type='previo'` and `is_active=true` for that hotel. Grant `EXECUTE` to `authenticated`. This exposes only a boolean — no credentials or config columns.
2. **Update `src/contexts/LiveSyncContext.tsx`** hasPrevio detection to call this RPC instead of `.from('pms_configurations').select(...)`. Preserve the existing `hotelId` fallback to `profile.assigned_hotel`.

## Not changed

- `previo-poll-checkouts` edge function and its cron — untouched.
- `previo-update-room-status` (manager-approved clean push) — untouched.
- RLS policies on `pms_configurations` themselves — unchanged; admins keep full access, managers still cannot read credential columns.
- `PmsSyncControls` (admin-only card) — unchanged.

## Verification

- Log in as `ricsi.007`, open Team View: "PMS Sync" pill shows "Up to date" and the PMS Refresh button is active (no "PMS not connected" toast).
- Clicking PMS Refresh runs `runPmsRefresh('ottofiori')` and completes with a success toast.
- Admin experience unchanged.
