# Plan

## 1. Fix "PMS Sync" button for Nykipanchuk_073 (Hotel Ottofiori)

**Root cause (confirmed):** `PmsSyncControls` looks up `pms_configurations` with:
```
.or(`hotel_id.eq.${hotelId},hotel_id.eq.${hotelId.toLowerCase().replace(/\s+/g,'-')}`)
```
Nykipanchuk's `profiles.assigned_hotel = "Hotel Ottofiori"` → slugified becomes `hotel-ottofiori`, but the config row uses `hotel_id = "ottofiori"`. No match → `cfg` is `null` → the whole card renders `null`, so no sync button appears.

**Fix (`src/components/pms/PmsSyncControls.tsx`):**
- Replace the ad-hoc slug logic with `resolveHotelKeys(hotelId)` (already used in AutoRoomAssignment) so any of {display name, slug, hotel_id} matches.
- Query `pms_configurations` with `.in('hotel_id', keys)` and pick the row (prefer live env).
- Also pass the resolved canonical `hotel_id` down to `runPmsRefresh`, `PmsChangesDrawer`, and `PmsRefreshPreviewDialog` so downstream queries stop breaking on the same mismatch.
- Same normalization for the `pms_change_events` count query.

## 2. Hybrid "manager + housekeeper" role — where admins enable it, and landing priority

**Where to enable (already exists, needs to be discoverable):**
- Admin/Manager → **Team → Users → Edit user** → toggle **"Also acts as housekeeper"** (`UserManagementDialog.tsx:1014`). This flips `profiles.acts_as_housekeeper = true` and makes the user appear in Auto-Assign and normal Assign Room pickers, while keeping full manager access.

**UX additions so admins actually find it:**
- Add a short helper caption under the toggle: "Enables the user for room assignments and adds a personal 'My Tasks' tab next to Team View."
- Show a small **"HK+Mgr"** badge next to hybrid users in the user list rows so admins can see at a glance who is configured.

**Refine landing tab for hybrid users (`HousekeepingTab.tsx`):**
Current priority is `active tasks → My Tasks, else → Team View`. Update to the exact rule requested:
1. Has active `assigned`/`in_progress` room assignments today → **My Tasks**.
2. Else if `pendingCount > 0` → **Pending Approvals**.
3. Else → **Team View**.
- Pending-approvals badge on the tab trigger remains for all three states.
- Keep the existing `initialTabAppliedRef` latch so later realtime updates don't yank the user off the tab they navigated to.

## 3. Housekeeper post-signin routing + empty-state message

**Goal:** Any user (housekeeper or hybrid) who is not yet checked in should land on the Attendance/sign-in view. After they sign in, jump them straight to **My Tasks**. If they have zero assignments for today, show a friendly "no rooms assigned yet" card instead of an empty list.

**Changes:**
- `HousekeepingTab.tsx`:
  - Add an `attendanceStatus` query (`staff_attendance` for `user.id` + today's date) that runs alongside the existing effects.
  - Default-tab effect gains a new branch **before** the housekeeper/hybrid branches: if the user role can clean (housekeeping OR hybrid) AND they are **not** `checked_in`/`on_break` today → land on `attendance` and skip the "My Tasks" default.
  - Subscribe to `staff_attendance` realtime for `user.id`. When status flips to `checked_in`, if the current tab is still `attendance` and `initialTabAppliedRef` has already fired for attendance, programmatically switch to `assignments` (My Tasks) via `setActiveTab('assignments')`. Use a separate ref so this "post-signin jump" only fires once.
- `HousekeepingStaffView.tsx` empty state (`housekeeping.noAssignments`):
  - When the list is empty AND today's date is selected AND the user is signed in, render a distinct message: **"No rooms assigned yet — your supervisor hasn't published today's assignments. This screen will update automatically."** with a small refresh button and a subtle illustration.
  - Add two new translation keys `housekeeping.noAssignmentsYetTitle` and `housekeeping.noAssignmentsYetBody` (EN + UK + other supported languages) instead of reusing the generic "no assignments" copy.

## 4. Per-hotel Auto-Assign improvements (starting with Ottofiori) + learning loop

**Principle:** every hotel gets an isolated auto-assign profile. Ottofiori's algorithm knob changes must not affect other hotels.

### 4a. Per-hotel configuration
- New table `hotel_autoassign_profiles` (via migration) keyed by `hotel_id`, with tunable weights: `floor_grouping_weight`, `room_size_weight`, `checkout_distribution_weight`, `daily_count_weight`, `rtc_priority_weight`, `max_rooms_per_hk`, `checkout_first`, plus a JSON `learned_hints` blob for pattern data. RLS: readable by same-org members; write by admin/manager of that hotel; service_role full access.
- `AutoRoomAssignment.tsx` loads the profile for the manager's resolved hotel via `resolveHotelKeys` and passes those weights into `runAssignmentAlgorithm`. If no profile row exists, use the current defaults.

### 4b. Fairness + floor grouping (Ottofiori first, generic for all hotels)
Adjust `src/lib/roomAssignmentAlgorithm.ts`:
- Pre-sort rooms by `(floor, wing, room_number)` and give each housekeeper a **primary floor** = the floor of their first assignment. Subsequent picks penalize moving off the primary floor unless load-balance forces it.
- Split fairness into two dimensions computed per housekeeper:
  - `checkoutCount` (already exists) — keep tight (max diff ≤ 1).
  - `dailyCount` (stayovers) — keep tight (max diff ≤ 1).
  - `weightedLoad` = Σ(room_size * type_factor) — used only when both counts are balanced.
- **RTC (Ready-To-Clean) checkouts** at planning time: fetch `pms_metadata.cleanReadyStatus`/`checkout_time` freshness and mark rooms with `rtc = true` when they are already vacated. Distribute RTC rooms first, round-robin across available housekeepers, so nobody gets all the "waiting" ones.
- Expose a per-hotel `checkoutFirstGrouping` flag (default true for Ottofiori) so all checkouts get the earliest slots.

### 4c. Learning from historical assignments
- Already have `assignment_patterns` (room-pair frequency). Add a nightly aggregation (extend existing `analyze-assignment-patterns` edge function or add `analyze-hotel-autoassign`) that runs per hotel and writes back into `hotel_autoassign_profiles.learned_hints`:
  - Preferred floor-per-housekeeper (mode of floors they cleaned in the last 30 days).
  - Typical checkout share per housekeeper (used only as a soft prior — never overrides fairness).
  - Typical rooms/day per housekeeper (informs `max_rooms_per_hk` suggestion, shown to manager but not auto-applied).
- Algorithm reads `learned_hints` as *tie-breakers only*. Hard constraints (fairness, floor grouping, RTC distribution) always win, so learned patterns can never cause hallucinated skewed assignments.
- Add a small "Learning summary" panel inside Auto-Assign preview so managers can see *why* the algorithm proposed what it did (e.g. "Anna → floor 3 (prior pattern), 4 checkouts of 12").

### 4d. Guardrails against hallucination
- Only ingest data actually present in the DB: skip housekeepers with < 5 historical days, skip rooms without floor metadata, ignore any pattern with confidence < 0.6.
- The learning job logs its inputs/outputs to `pms_snapshots`-style audit rows so the manager can inspect what the model considered.

## Technical notes

- Migration: `hotel_autoassign_profiles` — CREATE TABLE + explicit GRANTs (`SELECT, INSERT, UPDATE, DELETE` to `authenticated`, `ALL` to `service_role`; no `anon`) + RLS policies scoped via existing `has_role` helper and `organization_slug`/`hotel_id` match.
- No changes to auth schema. No secrets required.
- Translation keys added to `src/hooks/useTranslation.tsx` for the new empty-state and the hybrid toggle helper.
- All PMS-sync code that currently slugifies `hotelId` inline should be migrated to `resolveHotelKeys` in a follow-up sweep — this plan only touches `PmsSyncControls` and the components it hands the hotel id to.

## Out of scope
- Full automation (removing the manager's confirm step) — user explicitly wants human intervention for now; this plan only produces better proposals, still gated by the existing "Confirm assignments" step.
- Rewriting `roomAssignmentAlgorithm` for non-Ottofiori hotels beyond the shared fairness/floor changes above.
