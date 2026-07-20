## Fixes

### 1. Nykipanchuk sees "PMS not connected" toast on Ottofiori
**Root cause:** `LiveSyncContext` calls `hotel_has_active_previo(profile.assigned_hotel)`. Nykipanchuk's `assigned_hotel` is the display name `"Hotel Ottofiori"`, but `pms_configurations.hotel_id` is `"ottofiori"`, so the RPC returns `false` and `enabled=false`. The PMS status pill (`PmsRefreshButton`) then fires "PMS not connected" every time she clicks refresh, even though the sync itself works via `PmsSyncControls`.

**Fix:** In `LiveSyncContext.tsx`, resolve the profile's `assigned_hotel` via `resolveHotelKeys(...)` and probe the RPC with each alias until one returns `true` (same pattern used in `PmsSyncControls`). Store the resolved slug as `hotelId` so downstream `pms_sync_history`/poll queries also match.

### 2. Landing-tab routing (Housekeeping section)

Update the default-tab effect in `src/components/dashboard/HousekeepingTab.tsx`. Extend attendance gating so managers also route through the HR (attendance) tab when not checked in. `top_management` / `top_management_manager` remain exempt (view-only executives don't clock in).

New priority when `userRole` has resolved:

| Role | Not signed in | Signed in |
|---|---|---|
| Housekeeper | `attendance` | `assignments` (My Tasks) |
| Hybrid (mgr + housekeeper) | `attendance` | active rooms → `assignments`; else pending → `supervisor`; else `manage` |
| Manager / housekeeping_manager / front_office / hr / marketing / control_finance | `attendance` | `pendingCount>0` → `supervisor`; else `manage` |
| Executive read-only (`top_management*`) | — | `manage` |
| Reception | — | `manage` |

Reuse the existing `isSignedInToday` state and realtime subscription, but broaden `canClean` → `requiresAttendance` = `hasManagerAccess && !isExecutiveReadOnly` OR `userRole === 'housekeeping'`.

Post-signin auto-jump (`postSigninJumpFiredRef`):
- Housekeeper → `assignments`
- Hybrid → priority chain above
- Manager → `pendingCount>0` ? `supervisor` : `manage`

### 3. Auto-scroll after landing on Team View / Pending Approvals

When the manager lands on `manage` after check-in, smoothly scroll to the Hotel Room Overview card. When they land on `supervisor`, scroll to the first pending approval card.

Implementation:
- Add stable DOM ids in the two views:
  - `HotelRoomOverview` root → `id="hotel-room-overview"`
  - `SupervisorApprovalView`'s pending-list container → `id="pending-approvals-list"`
- In `HousekeepingTab.tsx`, after `applyDefaultTab(...)` for `manage` / `supervisor`, schedule `requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior:'smooth', block:'start' }))` with a small delay so the tab content has mounted. Only fire on the initial default landing (not on manual navigation) — gated by `initialTabAppliedRef`.
- Same behavior on the post-signin jump for managers.

### 4. Attractive "Swipe right to check in" animation

Enhance `src/components/ui/swipe-action.tsx` to draw the user's eye toward the swipe gesture while idle (industry-standard cue for swipe affordances: a repeating right-moving sheen + a subtle bouncing thumb, disabled while the user is dragging).

- **Animated gradient sheen:** an absolutely-positioned overlay inside the track running a `@keyframes swipe-hint-sheen` from `translateX(-40%)` to `translateX(140%)` with a soft `bg-gradient-to-r from-transparent via-primary/25 to-transparent`, 2s ease-in-out infinite. Pauses when `isDragging` or `isCompleted`.
- **Thumb nudge:** the chevron thumb gets a `swipe-hint-nudge` keyframe (translate 0 → 8px → 0, 1.6s infinite) plus a soft glow ring, pauses on drag.
- **Chevron trail:** two faint chevrons fading right of the thumb (opacity 0.4 → 0), staggered with animation-delay.
- Respect `prefers-reduced-motion` via a `motion-safe:` prefix so the animations are disabled for users who opted out.
- No emoji, uses design tokens (`primary`, `primary/25`, `primary/10`), no hardcoded colors.

### Files to change
- `src/contexts/LiveSyncContext.tsx` — alias-aware Previo detection.
- `src/components/dashboard/HousekeepingTab.tsx` — extended attendance gating for managers, post-signin jump, auto-scroll trigger.
- `src/components/dashboard/HotelRoomOverview.tsx` — add anchor id.
- `src/components/dashboard/SupervisorApprovalView.tsx` — add anchor id on pending list.
- `src/components/ui/swipe-action.tsx` — sheen + nudge animations, reduced-motion safe.

No schema, RLS, or business-logic changes.
