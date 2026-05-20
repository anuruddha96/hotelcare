# PMS Change Sync & Conflict Awareness

## Problem (what's broken today)

1. **Checkouts don't update reliably.** `previo-poll-checkouts` is **hard-gated to `hotel_id = 'previo-test'`** (lines 13, 66–71) and **never scheduled in pg_cron** — it only runs from the browser via `LiveSyncContext` every 10 min, *and only while a manager has the tab focused*. So for real hotels and overnight/idle periods, reception's checkout in Previo is invisible to the app.
2. **PMS changes are silent.** `pmsRefresh` overwrites room fields without diffing or notifying anyone. If reception changes a guest's room/status in Previo *after* the manager has assigned that room to a housekeeper, the local row is mutated with no signal — assignments may suddenly point at the wrong guest, wrong checkout, or a freshly-occupied room.
3. **No audit of "what the PMS just changed".** We log sync runs in `pms_sync_history`, but not per-room field changes, so managers can't see what flipped.

## Goal

Make Previo the source of truth on a fixed cadence, server-side, for *every* Previo hotel — and whenever an incoming change collides with an existing assignment or with an in-progress housekeeping task, surface it clearly to eligible users and offer a one-click resolution.

## Plan

### 1. Server-side checkout polling for all Previo hotels

- **Remove the `previo-test` hard-gate** from `previo-poll-checkouts` (keep an opt-out flag in `pms_configurations.settings` for safety).
- Add a **fan-out** mode: when called without `hotelId`, iterate every active Previo config and poll each (same pattern as `revenue-engine-tick`).
- Add a **pg_cron job** `previo-poll-checkouts-tick` running **every 5 minutes** that POSTs to the function with the `x-cron-secret` header (cron path already supported, lines 39–41). This guarantees checkouts flip without depending on any browser being open.
- Keep client-side `LiveSync` 10-min poll as a *nice-to-have* for instant feedback when a manager is active, but the cron is the authoritative loop.

### 2. Use the existing 2-min PMS sync as a second checkout signal

`previo-pms-sync` already returns `CheckedOut` per room and `pmsRefresh` writes `is_checkout_room` from it. Today this is only triggered from the browser. We will:

- Have the new cron tick also invoke `previo-pms-sync` per hotel (every 5–10 min), so room status, departures, guest count, and checkouts converge even with no user logged in.
- Continue updating only PMS-derived fields; never touch assignment fields.

### 3. Detect & record PMS changes (new `pms_change_events` table)

New table `pms_change_events`:
- `hotel_id`, `room_id`, `event_type` (`checkout_confirmed` | `guest_changed` | `room_swapped` | `status_changed` | `dates_changed` | `occupancy_changed`)
- `before` JSONB, `after` JSONB, `previo_reservation_id`, `detected_at`, `source` (`poll_checkouts` | `pms_sync`)
- `acknowledged_at`, `acknowledged_by`, `resolution` (`auto_released` | `reassigned` | `dismissed` | `pending`)
- `conflicts_with_assignment_id` (nullable FK to `room_assignments`)

Both `previo-poll-checkouts` and `previo-pms-sync` will, before writing a room update, **compare the new values against the current row** and emit a row into `pms_change_events` for every meaningful diff.

### 4. Conflict detection on assignment-touching changes

When the sync detects a change to a room that already has a same-day assignment (`room_assignments` with `assignment_date = today` and `status in ('assigned','in_progress')`), classify the conflict:

| Detected change                          | Action                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Guest checked out                        | Set `is_checkout_room=true`, set `ready_to_clean=true`, emit `checkout_confirmed` event  |
| Room newly occupied (was vacant)         | Block the existing cleaning assignment, emit `room_swapped` event flagged as **conflict** |
| Guest swapped (different reservation id) | Keep assignment, emit `guest_changed` event flagged as **conflict**                       |
| Departure date pushed (extended stay)    | Convert `checkout_cleaning` → `stayover` assignment, emit `dates_changed` event           |
| Status flipped clean↔dirty by reception  | Mirror status, emit `status_changed` event (informational, no conflict)                   |

The function never silently overrides an in-progress cleaning; it pauses the assignment (new `room_assignments.pms_hold = true` flag, migration in step 5) and waits for manager acknowledgement.

### 5. Migrations

- `pms_change_events` table + RLS (managers/admins of the hotel can SELECT; service role inserts).
- `room_assignments.pms_hold boolean default false` + index.
- `pms_configurations.settings jsonb` opt-out: `{ "disable_checkout_poll": true }`.
- `pg_cron` job for `previo-poll-checkouts-tick` (separate from migrations, inserted via the insert tool since it embeds the function URL + anon key).

### 6. UI — make PMS changes visible

**a. LiveSync indicator** (header pill, already exists):
- Add a new task `pms_changes` showing count of unacknowledged `pms_change_events` for the hotel. Red dot + count badge when conflicts exist.

**b. Per-room visual signals** on every room card (`EnhancedRoomCardV2`, `CompactRoomCard`, `HotelFloorMap`, `AssignedRoomCard`):
- Small pulsing amber `PMS update` chip when the room has an unacknowledged non-conflict event.
- Red `PMS conflict` chip when there is a conflict; clicking opens the resolution dialog.

**c. Toast on detection** for eligible roles (`admin`, `top_management`, `manager`, `housekeeping_manager`, `front_office`) via Sonner — *one toast per batch*, matching the existing single-notification rule:
`"3 rooms updated by reception · 1 conflicts with current assignment"` with a "Review" action.

**d. New `PmsChangesDrawer`** (opened from the LiveSync popover and from the toast):
- Lists today's `pms_change_events` grouped by status (Conflicts / Updates / Resolved).
- Each row shows room, event type, before → after diff, time, source.
- Conflict rows expose actions: **Release assignment**, **Reassign to another housekeeper**, **Keep as stayover**, **Dismiss**. Each writes to `room_assignments` (clearing `pms_hold`) and stamps `acknowledged_at`/`resolution` on the event.

**e. Assignment screens** (`AutoRoomAssignment`, `RoomAssignmentDialog`, `RoomAssignmentChangeDialog`):
- Before saving an assignment, check `pms_change_events` with unresolved conflicts on the selected rooms and warn inline.
- Show a "Held by PMS change" badge on assignments where `pms_hold = true`, with the inline resolve actions.

### 7. Telemetry / audit

Every event row is the audit trail. Add a "PMS change history" tab to the hotel detail page (admin-only) backed by `pms_change_events` with date range filters, so messes can be reconstructed after the fact.

## Technical notes

- All XML/REST parsing reuses helpers already in `previo-poll-checkouts` and `previo-pms-sync`.
- The cron fan-out function (`previo-poll-checkouts` without `hotelId`) uses `service_role` and the `x-cron-secret` path already in place.
- Diff detection is done in the edge functions — UI just reads `pms_change_events`.
- `pms_hold` is a soft signal; it never changes `room_assignments.status`, so existing flows keep working. Cleaners simply see a banner that the room is on hold pending manager confirmation.
- Realtime: subscribe the LiveSync context to `pms_change_events` inserts (Supabase realtime channel) so the badge and toast appear within seconds — no polling needed in the UI.

## Files touched

- `supabase/functions/previo-poll-checkouts/index.ts` — remove gate, add fan-out, emit events, conflict classification.
- `supabase/functions/previo-pms-sync/index.ts` — diff before update, emit events.
- `supabase/migrations/...` — `pms_change_events`, `pms_hold`, settings column, RLS.
- pg_cron job for the 5-min tick (insert tool, not migration).
- `src/contexts/LiveSyncContext.tsx` — new `pms_changes` task + realtime subscription.
- `src/components/layout/LiveSyncIndicator.tsx` — badge + entry to drawer.
- `src/components/pms/PmsChangesDrawer.tsx` (new) — review/resolve UI.
- Room card components (5 files) — chip rendering.
- Assignment dialogs (3 files) — conflict warnings + hold badge.
- `src/pages/RevenueHotelDetail.tsx` (or hotel admin page) — "PMS change history" tab.

## Open questions

1. **Cadence**: 5 min for checkouts cron OK, or do you want 2–3 min? More frequent = more Previo API load.
2. **Conflict default**: when reception swaps a guest into an already-assigned room, should the app **auto-release** the old assignment, or **always wait** for the manager to choose? My recommendation: hold + notify, never auto-release on guest swaps.
3. **Scope of events**: should `status_changed` (clean↔dirty mirrored from Previo) generate a chip too, or only log silently? It can be noisy.
