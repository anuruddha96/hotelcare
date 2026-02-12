

## Plan: Fix Bulk Unassign + Improve Performance Section

### Issue 1: Bulk Unassign Button Not Working As Intended

**Problem:** When "Bulk Unassign" is clicked, the mode activates (button changes to red "Cancel"), but the actual checkbox selection view appears far below at the bottom of the page (after Hotel Room Overview and team summary). Users cannot see it and think the button is broken.

**Fix:** Move the bulk unassign checkboxes INTO the existing staff cards instead of a separate section at the bottom.

**File:** `src/components/dashboard/HousekeepingManagerView.tsx`

- Remove the separate "Bulk Unassign View" Card section (lines 782-813)
- Instead, when `bulkUnassignMode` is true, show checkboxes on each room within each staff's card
- Add a "Select All" / "Deselect All" option per staff member
- Filter `roomAssignments` by staff member to show their rooms with checkboxes inline
- When mode is active, each staff card shows their assigned rooms with selectable checkboxes
- This way the user can immediately see and interact with rooms to unassign right where they are

### Issue 2: Auto Sign-Out Checkout Time

Already correctly set to 4:30 PM (16:30) in both:
- `supabase/functions/auto-signout/index.ts` (line 46)
- `AttendanceTracker.tsx` handleForgotSignout (line 322)

No changes needed here.

### Issue 3: Improved Performance Section

**Problem:** Current performance section shows a scoring explanation box, overview stats, and a leaderboard with score/daily/checkout/punctuality metrics. The UI is functional but could better highlight who is actively working well vs who needs attention.

**Improvements to `src/components/dashboard/PerformanceLeaderboard.tsx`:**

**A. Add "Working Hours" metric** - Include average daily working hours from attendance data (8 AM to 4:30 PM = 8.5h max). This directly shows who is putting in full shifts.

**B. Add "Rooms Per Hour" metric** - Calculate rooms cleaned per working hour to show true productivity, not just average cleaning time.

**C. Redesign the leaderboard cards:**
- Show a clear visual status indicator: green glow for top performers, red/orange for those needing attention
- Add a mini progress bar showing their score out of 100
- Show working hours alongside room counts
- Display "Rooms/Day" average prominently
- Add attendance streak (consecutive on-time days)

**D. Add a quick summary row at top** showing:
- "Top Performer" highlight card
- "Needs Attention" highlight card (lowest performer or frequent late arrivals)
- Team average comparison

**E. Mobile-optimized layout:**
- Stack metrics vertically on mobile instead of 4-column grid
- Use compact card layout with expandable details
- Larger touch targets for metric drill-down

**F. Remove the large scoring explanation box** - Replace with a small "How scores work" collapsible or tooltip, since it takes up too much space

**File:** `src/components/dashboard/PerformanceLeaderboard.tsx`

Key changes:
1. Fetch attendance data alongside performance data to calculate working hours
2. Add `avg_working_hours` and `rooms_per_hour` to `LeaderboardEntry` interface
3. Replace the 4-panel scoring explanation with a collapsible accordion
4. Add "Top Performer" and "Needs Attention" highlight cards above the leaderboard
5. Redesign each leaderboard card:
   - Left: rank icon + name + performance badge
   - Center: horizontal progress bar (score/100)
   - Bottom grid: 6 metrics (Score, Daily Avg, Checkout Avg, Punctuality, Working Hours, Rooms/Day)
   - Color-code the card border based on performance tier
6. On mobile: 2-column metric grid instead of 4, expandable card details

**File:** `src/components/dashboard/PerformanceDetailDialog.tsx`
- Add working hours detail view when clicking the new "Working Hours" metric

### Summary of Changes

| File | Change |
|------|--------|
| `HousekeepingManagerView.tsx` | Move bulk unassign checkboxes inline into staff cards; remove separate bottom section |
| `PerformanceLeaderboard.tsx` | Add working hours + rooms/hour metrics; redesign cards with progress bars, highlights, and better mobile layout; collapse scoring explanation |
| `PerformanceDetailDialog.tsx` | Add 'hours' metric type for working hours detail view |

### Technical Details

**Bulk Unassign inline integration:**
- When `bulkUnassignMode` is true, each staff card renders their assigned rooms (from `roomAssignments` filtered by `staff.id === assignment.assigned_to`)
- Each room shows as a small chip with a checkbox
- The existing `toggleAssignmentSelection` and `handleBulkUnassign` functions remain unchanged

**Performance metrics calculation:**
- Working hours: from `staff_attendance` table, average `total_hours` per day
- Rooms per hour: `total_completed / sum(total_hours)` across the timeframe
- Attendance streak: count consecutive days with `check_in_time <= 08:05`

**Card color coding:**
- Score >= 85: green left border
- Score 70-84: blue left border  
- Score 55-69: yellow left border
- Score < 55: red left border
