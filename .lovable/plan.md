# Give Top Management full Housekeeping access

Top managers are blocked in two independent layers, which is why the modules look empty or "not loading" rather than throwing errors.

## What I confirmed

**Layer 1 — database (the main cause).** Almost every housekeeping RLS policy lists only `manager`, `housekeeping_manager`, `admin`. Checked policies with no `top_management` at all:

- `dirty_linen_counts` (select/update/delete)
- `room_minibar_usage`, `minibar_placements`
- `dnd_photos`
- `lost_and_found`
- `maintenance_issues`
- `housekeeping_notes`, `housekeeper_ratings`
- `staff_attendance`, `break_requests`, `early_signout_requests`
- `room_assignments` (only the "view their assignments" select policy includes it; create/update/delete do not)

So even where the UI renders, the queries return zero rows for a top manager.

**Layer 2 — frontend role checks.** Dozens of hardcoded role arrays omit top management, for example:

- `PmsRefreshButton.tsx:21-27` — `MANAGER_ROLES` has `top_management` but not `top_management_manager`
- `PMSUpload.tsx:1421, 1612, 1689` — refresh/upload buttons
- `DNDPhotosViewer.tsx:42`, `RoomPhotosViewer.tsx:35` — daily room pictures / DND
- `LostAndFoundManagement.tsx:52`
- `MaintenancePhotosManagement.tsx:66-67`
- `MinibarTrackingView.tsx:96, 105, 560-565`
- `AttendanceManagement.tsx:57`
- `HotelRoomOverview.tsx:192`, `RoomDetailDialog.tsx:524, 571`, `RoomAssignmentDialog.tsx:471, 538`, `RoomAssignmentChangeDialog.tsx:32`, `AssignedRoomCard.tsx:1245, 1435`, `PendingRoomsDialog.tsx:45`, `WorkingRoomDetailDialog.tsx:46`, `PerishablePlacementManager.tsx:609`, `RealtimeNotificationProvider.tsx:20, 42`

`HousekeepingTab.tsx:154` already grants top management manager access, which is why the tabs appear but their contents are empty or read-only.

## The fix

**1. Database migration — one shared role helper**

Add a `SECURITY DEFINER` helper, e.g. `public.has_hk_manager_powers(uuid)`, returning true for `admin`, `manager`, `housekeeping_manager`, `top_management`, `top_management_manager` (and keeping `is_super_admin`). Then rewrite the housekeeping policies listed above to call it instead of inlining the three-role array, preserving each policy's existing hotel/organization scoping exactly as-is. No policy becomes broader than its current hotel boundary — only the role list grows.

**2. Frontend — route every check through `roleAccess.ts`**

`hasManagerPowers()` in `src/lib/roleAccess.ts` already covers the correct five roles. Replace each hardcoded array above with `hasManagerPowers(profile?.role)`, and add `top_management_manager` to `PmsRefreshButton`'s `MANAGER_ROLES`. This removes the drift that caused the problem instead of patching one screen at a time.

**3. Verify**

Query the relevant tables as a top-management user to confirm rows return, then load Housekeeping in the preview and check that Approvals, Dirty Linen, Minibar, Daily Room Pictures, DND, Lost & Found, Staff Attendance and the PMS refresh button all render with data and working actions.

## Scope guard

Nothing changes for RD Hotels or Ottofiori operational roles, housekeepers, reception or maintenance — their policies and role checks are untouched. Only the top-management roles gain the manager-level powers they were meant to have.
