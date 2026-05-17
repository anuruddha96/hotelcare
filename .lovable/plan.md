## Problem

On Ottofiori (live), the Housekeeping Manager Team view is showing the bottom "Team Summary" card with `0 Team Members / 21 Total Assignments`, and the per-staff cards (Done / Working / Pending) above it are gone. Ottofiori actually has 5 housekeeping staff in the database, so this is a regression caused by recent Previo / checkout work, not missing data.

## What I found

1. `HousekeepingManagerView` still renders per-staff cards (lines ~600–836) above the Summary card (lines ~840–867). If `housekeepingStaff` is empty, only the Summary card shows — exactly what the screenshot displays.

2. `fetchHousekeepingStaff()` in `HousekeepingManagerView.tsx` builds a `hotel_configurations` lookup using:
   ```ts
   .or(`hotel_id.eq.${profileData.assigned_hotel},hotel_name.ilike.%${profileData.assigned_hotel}%`)
   .limit(1).single()
   ```
   For Ottofiori, `profiles.assigned_hotel = "Hotel Ottofiori"` (string with a space). PostgREST `.or()` rejects unquoted spaces in `eq.` values, so the config lookup fails, falls back to a single-name list, and the case-insensitive JS filter then drops staff whose `assigned_hotel` is stored under a different casing/variant. Result for Ottofiori: 0 staff. Same risk in `fetchTeamAssignments()` and `fetchRoomAssignments()` (they share the same lookup).

3. Migration `20260516184533_...sql` (the "global trigger neutralize" one) also runs an unconditional `UPDATE` that resets `ready_to_clean = false` for every open checkout assignment whose room is not currently flagged checkout — for ALL hotels except `previo-test`. On Ottofiori this silently re-blocks any checkout room that staff had already manually released, which can show up as rooms looking "stuck" / not ready and may also confuse the team view counts.

4. `pmsRefresh.ts` (line ~125) now hard-overwrites `rooms.status` from Previo for any hotel that runs through it. Ottofiori currently uses the spreadsheet/PMS upload path (`PMSUpload.tsx`), so this should not fire for them, but it must be verified — this is the kind of side-effect the user is worried about.

## Plan

### 1. Fix the team view on Ottofiori (root cause: hotel lookup)

In `src/components/dashboard/HousekeepingManagerView.tsx`:

- Replace the brittle `.or(hotel_id.eq.${value},hotel_name.ilike.%${value}%)` lookup in `fetchHousekeepingStaff`, `fetchTeamAssignments`, and `fetchRoomAssignments` with the existing helper `resolveHotelKeys(hotelId)` from `src/lib/hotelKeys.ts` (already used in `pmsRefresh.ts`). This returns every canonical/variant key for a hotel and avoids the PostgREST `or` parsing issue.
- Pass that key list directly into the staff/assignment queries (`.in('assigned_hotel', keys)` and `.in('hotel', keys)` on `rooms`), removing the manual case-insensitive JS filter and the `.single()` call that silently fails.
- Keep the existing `organization_slug` guard.

### 2. Undo the over-broad re-block on live hotels

Add a corrective migration that:

- Re-marks `ready_to_clean = true` for open checkout assignments on hotels other than `previo-test` where a staff/manager release had been wiped by migration `20260516184533`. Scope: `assignment_type = 'checkout_cleaning'`, `assignment_date = CURRENT_DATE`, `status IN ('assigned','in_progress')`, and an audit signal that the row was last touched by that migration (use `updated_at` window since the migration timestamp combined with `ready_to_clean = false` as a best-effort restore).
- Leaves `previo-test` untouched (its readiness is driven by `previo-poll-checkouts`).

If the audit window is too ambiguous, fall back to: for non-`previo-test` hotels with `is_checkout_room = true` AND an existing assignment, set `ready_to_clean = true`. Ottofiori's manager workflow expects checkout rooms flagged at reception to be releasable; this matches their pre-regression behavior.

### 3. Ottofiori audit — verify no other live behavior changed

Read-only verification, no edits unless something is found:

- `pmsRefresh.ts`: confirm only `previo-test` triggers `previo-poll-checkouts`; status overwrite path only fires when the user explicitly runs the Previo refresh button (Ottofiori uses spreadsheet upload, so safe). Add a guard if the LiveSync auto-sync could call `runPmsRefresh('ottofiori')`.
- `previo-poll-checkouts`, `previo-pms-sync`, `previo-nightly-sync`, `previo-sync-reservations`: confirm each is hard-scoped to `hotelId === 'previo-test'` at function entry. Report any that aren't.
- `handle_room_status_change()` trigger: already neutralized — confirm no other triggers on `rooms`/`room_assignments` were added in recent migrations that affect live hotels.
- Frontend release entry points (`HotelRoomOverview`, `PendingRoomsDialog`, `WorkingRoomDetailDialog`): confirm manual "Mark Ready" still works for Ottofiori managers and no test-hotel gating accidentally blocks live users.

Deliver the audit as a short findings list in the chat after step 1+2 land.

### 4. Verify

- Reload Ottofiori dashboard → per-staff team cards appear with Done / Working / Pending counts and the Summary shows the real `Team Members` count.
- Open a checkout room on Ottofiori that was manually released earlier today → it is back in the eligible-staff "ready to clean" state.
- Trigger `previo-test` PMS sync → still scoped to test hotel only; Ottofiori rooms unaffected.

## Technical details (for reference)

Files to edit:
- `src/components/dashboard/HousekeepingManagerView.tsx` (replace hotel lookup in 3 fetchers, drop `.single()`)
- New migration under `supabase/migrations/` restoring `ready_to_clean` for live-hotel checkout assignments

Files to read for the audit (no edits expected):
- `src/lib/pmsRefresh.ts`
- `supabase/functions/previo-poll-checkouts/index.ts`
- `supabase/functions/previo-pms-sync/index.ts`
- `supabase/functions/previo-nightly-sync/index.ts`
- `supabase/functions/previo-sync-reservations/index.ts`
- `src/components/dashboard/HotelRoomOverview.tsx`
- `src/components/dashboard/PendingRoomsDialog.tsx`
- `src/components/dashboard/WorkingRoomDetailDialog.tsx`

## Outcome

Ottofiori managers see the full per-staff Team view again with live Done/Working/Pending counts. Any checkout rooms that were silently re-blocked by the recent global migration are restored. All Previo-specific behavior stays scoped to `previo-test`.
