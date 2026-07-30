## 1. Clear special bed instructions after checkout (like minibar)

Today `rooms.bed_configuration` persists after the guest leaves. PMS refresh only clears it when the value was auto-inferred and still matches the stored marker (`src/lib/pmsRefresh.ts` ~L513-575); manager-set values are deliberately preserved forever.

- In `SupervisorApprovalView.tsx`, extend the existing checkout auto-clear block (the one that clears minibar on `checkout_cleaning` approval, ~L679) to also reset the room to default: `bed_configuration = null`, drop `pms_metadata.inferredBedConfig` and any manual bed-override marker.
- In `pmsRefresh.ts`, when PMS confirms the guest has departed (`isCheckedOut`) and the incoming housekeeping note carries no bed instruction, clear `bed_configuration` regardless of whether it was manager-set — the override belonged to the finished stay.
- Keep during-stay behaviour unchanged: daily cleans on nights 1..n-1 still show the instruction.

## 2. PMS sync history + room summary for admins & managers

- Make the PMS Refresh pill (`src/components/dashboard/PmsRefreshButton.tsx`) clickable to open a history dialog; also link it from `PmsSyncControls`.
- Enrich the `pms_sync_history` insert in `pmsRefresh.ts` to record `synced_by_user_id` / `synced_by_name` (current profile, or `System (auto sync)` when triggered by LiveSync/scheduler) and a room summary in `data`: daily rooms, checkout rooms, updated, unmatched, total, plus the room-number lists.
- New dialog shows, per sync: time, who triggered it (or System), status, and a summary block mirroring the old manual XLSX upload report (checkout rooms vs daily rooms, counts and room chips).
- Migration: add a manager-readable RLS policy already exists for `pms_sync_history` (admin/manager/housekeeping_manager) — no change needed there.

## 3. Francesca's sync failure (investigate first)

Confirmed so far: Francesca is `role = manager`, `assigned_hotel = 'ottofiori'`, org `rdhotels` — identical to Ricsi/Petra, so it is not a role or hotel-alias mismatch. Confirmed problem area: `pms_configurations` has **admin-only SELECT policy**, so any manager-facing code that reads that table directly (e.g. `PmsSyncControls`) silently gets nothing, while the dashboard button works through the `hotel_has_active_previo` security-definer RPC. Whether that is the exact failure she hit is **unconfirmed**.

Steps:
1. Reproduce by checking her recent `pms_sync_history` / `pms_change_events` rows and the room-update RLS path for her profile.
2. Add a migration granting managers/housekeeping managers/front office SELECT on `pms_configurations` for their own hotel (read-only; write stays admin-only) so the sync card and status are consistent for every manager.
3. Replace the silent failure with an explicit error toast naming the cause (no config / not permitted / API error) instead of a generic "PMS not connected".

## 4. Dirty Linen dialog shows raw keys in English

`src/hooks/useTranslation.tsx` — add the missing keys to the **en** bundle (they exist for hu/es/vi/mn/uk/ru): `dirtyLinen.itemsCollectedFrom`, `totalItemsLabel`, `latest`, `saving`, `saved`, `removeConfirmTitle`, `removeConfirmDescription`, `remove`.

## 5. Delete User is broken

`supabase/functions/admin-delete-user/index.ts` calls `soft_delete_user_profile` on the service-role client, so `auth.uid()` inside the SECURITY DEFINER function is NULL and it always returns "Not authenticated".

- Migration: add an optional `p_caller_id uuid default null` parameter; the function uses `coalesce(p_caller_id, auth.uid())` and keeps all existing permission checks against that caller.
- Edge function: pass `p_caller_id: callerId` (already derived from the verified JWT). Ownership can never be spoofed because `callerId` comes from `supabase.auth.getUser()`, not the request body.
- Verify end-to-end by deleting a throwaway profile and confirming `deleted_at` / `deleted_by` are set and the badge shows for admins only.

## 6. Towel-change noise on checkout rooms

`AssignedRoomCard` already hides it, but the flag still surfaces elsewhere. Suppress the towel badge/instruction whenever the room/assignment is a checkout clean in: `SupervisorApprovalView` (~L1033), `ApprovalHistoryView` (~L448), `MobileHousekeepingCard`, `EnhancedRoomCardV2`, `HotelFloorMap`, and the Auto-Assign chips/summary. Additionally, in `pmsRefresh.ts` stop writing `towel_change_required = true` for rooms flagged as checkout so the data itself stays clean.

## Technical notes

- Two migrations: (a) `soft_delete_user_profile` caller-id parameter, (b) manager SELECT policy on `pms_configurations`.
- No schema change needed for sync history; existing `synced_by_user_id` / `synced_by_name` / `data` columns cover the new panel.
