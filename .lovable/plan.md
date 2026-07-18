## Goal

Formalise the "supervisor who also cleans" pattern currently hard-coded for `Nykipanchuk_073` (via the `profiles.acts_as_housekeeper` flag) into a first-class, admin-toggleable capability that any manager-level user can have. The user keeps their full manager access AND gets the housekeeper "My Tasks" tab, and appears in every housekeeper-picker (auto-assign + manual).

No new role is added — the existing role stays (e.g. `housekeeping_manager` or `manager`) and the `acts_as_housekeeper` boolean turns them into the hybrid. This keeps all existing manager RLS, tabs, and Revenue/Invoices access working untouched.

## Changes

### 1. Admin UI to toggle the hybrid (UserManagementDialog)
- In the Edit User form, add a Switch: **"Also acts as housekeeper (can be assigned rooms)"**.
- Shown only when the selected role is manager-level (`manager`, `housekeeping_manager`, `top_management_manager`, `admin`, `reception_manager`, etc. — i.e. not for pure `housekeeping` / `reception` / `maintenance` staff where it's meaningless).
- Persists `profiles.acts_as_housekeeper` on save (column already exists).
- Same switch mirrored in the Create User form for the same roles.

### 2. Housekeeper "My Tasks" tab for hybrid managers (HousekeepingTab.tsx)
- Compute `isHybridHousekeeper = hasManagerAccess && profile.acts_as_housekeeper === true`.
- Tab order for hybrids: keep the manager tab list as-is, but insert the **My Tasks** trigger immediately after **Team View (`manage`)** so the two sit side-by-side (matches the request "keep Team View and My Tasks close to each other"). For non-hybrid managers, no My Tasks tab is shown (unchanged).
- Render `<TabsContent value="assignments"><HousekeepingStaffView /></TabsContent>` for hybrids too (already exists at the bottom — just needs to remain gated to include hybrids).

### 3. Smart default tab for hybrids
- In the existing `checkDefaultTab` effect, extend the logic:
  - Query `room_assignments` for `staff_id = user.id`, `assigned_date = today`, `status in ('assigned','in_progress')`.
  - If hybrid AND count > 0 → default to `assignments` (My Tasks).
  - Else if hybrid AND `pendingCount > 0` → `supervisor`.
  - Else → `manage` (Team View), matching current manager default.

### 4. Dashboard top-level "Housekeeping" tab already covers them
- No change needed to `Dashboard.tsx`; hybrids already match the manager branch of the top-tab switch because their role is still a manager role.

### 5. Auto-assign & manual-assign lists — already work
- `AutoRoomAssignment.tsx`, `HousekeepingManagerView.tsx`, `SimpleRoomAssignment.tsx`, `EasyRoomAssignment.tsx` already filter with `role.eq.housekeeping,acts_as_housekeeper.eq.true`, so any newly-flagged manager will appear automatically. No code change required — this plan just adds the admin toggle that populates the flag.

### 6. Type/profile plumbing
- `useAuth` currently returns `profile` from the `profiles` table which already includes `acts_as_housekeeper` (present in `types.ts`). No schema migration needed.

## Out of scope
- No new role enum value, no new RLS policies (manager RLS already covers everything the hybrid needs; the housekeeper `room_assignments` RLS already keys off `staff_id = auth.uid()` which works for any user, manager or not).
- No changes to Revenue, Invoices, or notification routing.

## Verification
1. As admin, toggle **Also acts as housekeeper** on a `housekeeping_manager` user → save.
2. Log in as that user with no room assignments → lands on Team View, My Tasks tab visible right next to Team View.
3. From another admin session, assign them a room via Auto-Assign → they appear in the picker; assignment succeeds.
4. Refresh the hybrid user's dashboard → now defaults to My Tasks (because active assignment exists today). Can start/complete the room exactly like a regular housekeeper.
5. All manager tabs (Team View, Approvals, Performance, PMS Upload, etc.) still accessible.
