

## Plan: Add Contextual Help Tooltips Across the UI

### Approach
Create a reusable `HelpTooltip` wrapper component that wraps existing UI elements with a `Tooltip` showing a short description on hover. Apply it systematically across key areas without changing layout or visual appearance.

### 1. Create `HelpTooltip` Component
**File**: `src/components/ui/help-tooltip.tsx`

A thin wrapper around the existing Radix Tooltip that:
- Accepts `children` (the element) and `hint` (short text)
- Only renders the tooltip wrapper if `hint` is provided
- Uses `delayDuration={300}` so it doesn't trigger on quick passes
- Styled subtly (small text, muted background) to not distract

### 2. Define a Centralized Hints Map
**File**: `src/lib/ui-hints.ts`

A key-value map of hint strings for all major UI elements, organized by section. This keeps hint text maintainable and potentially translatable later. Examples:

- **Dashboard Tabs**: Tickets → "View and manage maintenance/service requests", Rooms → "See all hotel rooms and their current status", Housekeeping → "Manage cleaning staff, assignments, and approvals"
- **Room Overview Badges**: T → "Towel Change Required", RC → "Full Room/Linen Change Required", RTC → "Ready to Clean — guest checked out", SH → "Shabath room configuration", ACT → "Average Cleaning Time"
- **Housekeeping Sub-tabs**: Team View → "See staff assignments and room progress", PMS Upload → "Import room data from Property Management System", Performance → "Staff speed and quality rankings"
- **Approval View**: Suspiciously Fast → "Completed faster than realistic minimum", Normal → "Within expected time range", Approve All → "Approve all pending rooms for this hotel at once"
- **Buttons/Actions**: Auto Assign → "Automatically distribute rooms to available staff", Refresh → "Reload latest room statuses from the system", Bulk Approve → "Approve multiple rooms in one action"
- **Attendance**: Check In → "Record your work start time", Sign Out → "End your shift for the day", Break Request → "Request a timed break from your manager"

### 3. Apply `HelpTooltip` to Key Areas

| File | Elements to Wrap |
|------|-----------------|
| `Dashboard.tsx` | Main tab triggers (Tickets, Rooms, Housekeeping, Attendance, Admin) |
| `HousekeepingTab.tsx` | All sub-tab triggers (Staff Management, Pending Approvals, Team View, Performance, PMS Upload, etc.) |
| `HotelRoomOverview.tsx` | Legend items, badge abbreviations (T, RC, RTC, SH), Refresh button |
| `SupervisorApprovalView.tsx` | Summary stat cards, speed indicator badges, Approve/Reject buttons, Bulk Approve |
| `HousekeepingManagerView.tsx` | Auto Assign button, key action buttons |
| `PerformanceLeaderboard.tsx` | Score category labels (Speed, Productivity, Punctuality, Consistency, Quality) |
| `AttendanceTracker.tsx` | Check-in, break, sign-out buttons |

### 4. Implementation Details
- Wrap elements with `<HelpTooltip hint="...">` — no DOM changes, tooltip only appears on hover/long-press
- On mobile: tooltips show on long-press (Radix default behavior)
- Existing tooltips (like room cards in HotelRoomOverview) remain unchanged
- No layout, spacing, or visual changes — tooltips are purely additive

### Files to Create/Edit
| File | Action |
|------|--------|
| `src/components/ui/help-tooltip.tsx` | Create — reusable wrapper |
| `src/lib/ui-hints.ts` | Create — centralized hint strings |
| `src/components/dashboard/Dashboard.tsx` | Edit — wrap main tabs |
| `src/components/dashboard/HousekeepingTab.tsx` | Edit — wrap sub-tabs |
| `src/components/dashboard/HotelRoomOverview.tsx` | Edit — wrap legend + badges |
| `src/components/dashboard/SupervisorApprovalView.tsx` | Edit — wrap stat cards + badges |
| `src/components/dashboard/PerformanceLeaderboard.tsx` | Edit — wrap score labels |
| `src/components/dashboard/HousekeepingManagerView.tsx` | Edit — wrap key buttons |
| `src/components/dashboard/AttendanceTracker.tsx` | Edit — wrap action buttons |

