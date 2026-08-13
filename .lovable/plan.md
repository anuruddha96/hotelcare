# SLNT operations planner and reliable shared revenue refresh

## Goal
Give SLNT Group a fast, venue-aware housekeeping workspace for planning tomorrow and the next month, while fixing revenue synchronization so one successful property refresh is reused by everyone for 30 minutes and its time/user are visible.

## Verified current state
- SLNT’s current Team View already supports a selected assignment date and writes `room_assignments.assignment_date`, so tomorrow’s work can use the existing `assigned` status without inventing a second lifecycle. Housekeepers already only see work for today and must be checked in before starting it.
- The existing attendance records represent actual clock-in/out only; there is no future shift/venue rota table. A separate schedule is required rather than creating fake future attendance rows.
- The revenue page claims the shared per-property lease before automatic refresh, but its displayed “last sync” still reads `pms_sync_history` rather than `revenue_sync_state`.
- There are currently no successful `revenue_sync` or `revenue_live` history rows. The Edge Function writes history only after completing the full pull, while the shared state stores neither the successful user nor enough display metadata.

## Changes

### 1. SLNT-only Operations Board
- Replace SLNT’s dense Hotel Room Overview with an at-a-glance operations board; leave RD Hotels and Ottofiori on their existing UI.
- Add clear Today / Tomorrow / Pick date controls. Tomorrow becomes the primary preparation view after 17:00 Budapest time, but remains available all day.
- Group units by venue with compact status/assignment chips, venue totals, unassigned counts, and a staff workload rail.
- Keep tap/click assignment and staged Apply/Discard behavior; add bulk selection and assignment so managers can allocate several units quickly without drag precision.
- Treat tomorrow’s saved rows as normal `assigned` work dated tomorrow. They remain non-startable until that date and then appear automatically in each housekeeper’s My Tasks.
- Filter staff, units, assignments, and attendance by SLNT organization, selected property, and venue scopes.

### 2. SLNT staff rota for 2 weeks or 1 month
- Add an authenticated `staff_schedules` table containing organization, property, employee, work date, shift start/end, status, notes, and audit fields, plus a linked schedule-to-venues table for multi-venue shifts.
- Grant authenticated/service-role access explicitly, enable RLS, and enforce that SLNT managers can manage only staff and venues in their own organization/property; employees can read only their own published shifts.
- Add a Schedule tab to SLNT HR with 2-week and 1-month views, copy-week support, working/off-day controls, shift times, multi-venue assignment, draft/published states, and conflict/coverage warnings.
- Show each SLNT housekeeper’s upcoming shift, time, and venues in the Attendance/Work Status view. Keep the rota separate from actual attendance; clock-in remains the authoritative work record.
- On the operations board, show scheduled/on-duty/off indicators and warn before assigning a unit outside the employee’s scheduled venue or day. Do not silently block an authorized manager; require an explicit override.

### 3. Make shared revenue freshness authoritative
- Extend `revenue_sync_state` with the last successful user id/name and expose them through the existing tenant-safe read policy/RPC.
- Update completion so only the user who owns the active lease can complete it, preventing one request from completing another user’s lease.
- Make the Revenue page and data hook read last-success time/user from `revenue_sync_state`, not empty legacy history, and render exact local date/time plus relative age.
- Keep one automatic owner: the property Revenue page calls the atomic claim on first entry and periodic visible-page checks. `fresh` reuses cached data; `already_running` shows “sync in progress” and polls state/data without starting another Previo call; only `claimed` invokes Previo.
- Keep Manual Sync as an explicit force action, but still acquire/coordinate the property lease so concurrent manual or automatic pulls cannot overlap.
- On Edge Function failure, always release the lease and preserve the previous successful timestamp; on success, persist the actor and reload the visible data automatically.
- Remove any remaining revenue auto-pull from global login/live-sync code so authentication/profile refreshes only reload local Supabase data and never independently call Previo.

### 4. Validation
- SLNT manager: prepare tomorrow’s assignments after 17:00, refresh/reopen, and confirm rows remain dated tomorrow and activate in housekeepers’ My Tasks the next morning.
- Verify bulk assignment, venue grouping, workload counts, attendance requirement, and venue-scope isolation on desktop and mobile.
- Create/publish 2-week and 1-month shifts with times and multiple venues; verify employees see only their own upcoming schedule in Attendance and that actual attendance remains unchanged.
- Confirm RD Hotels and Ottofiori UI/workflows are byte-for-byte unaffected by the SLNT feature gate.
- Revenue: verify two users/tabs on one property produce one claim/API pull, a second visitor within 30 minutes sees the same successful time/user without refreshing, stale data refreshes once, and manual sync remains available.
- Verify failed pulls release the lease, successful pulls update state/history, and cross-organization property access remains denied.

## Technical notes
- Use Budapest-local dates for operational day boundaries and the 17:00 tomorrow-planning cue.
- Reuse `room_assignments.assignment_date`; no new pending assignment status is needed.
- Scheduling is intentionally separate from `staff_attendance`: planned shifts and actual timekeeping have different audit semantics.
- New public tables include explicit GRANTs before RLS and tenant/property-scoped policies.
