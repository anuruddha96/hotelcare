

## Plan: ACT in Hotel Room Overview + Button Styling + Attendance UI Cleanup

### Change 1: Add Average Clean Time (ACT) to Hotel Room Overview

**File:** `src/components/dashboard/HotelRoomOverview.tsx`

- Fetch completed room assignments for the selected date and hotel to calculate average cleaning time
- Query `room_assignments` where `status = 'completed'` and both `started_at` and `completed_at` are not null
- Calculate average time in minutes across all completed rooms
- Display "ACT: Xm" badge next to the room count badge in the CardHeader (line 292)
- If no completed rooms yet, show "ACT: --"

### Change 2: Swap Auto Assign / Assign Room Button Styles

**File:** `src/components/dashboard/HousekeepingManagerView.tsx`

- **Auto Assign button** (line 567-574): Change from `variant="secondary"` to `variant="default"` and add `className` with `bg-primary text-white` to make it the prominent blue button
- **Assign Room button** (line 585-591): Change from `variant="default"` (no variant = default) to `variant="outline"` to make it a plain outlined button, discouraging its use

### Change 3: Simplify Attendance Tracker UI

**File:** `src/components/dashboard/AttendanceTracker.tsx`

Key improvements for the "Work Status & Attendance" page:

**A. Cleaner "Not Checked In" state:**
- Remove the notes textarea from the initial view (before check-in) -- notes are rarely needed before starting work
- Make the location card more compact
- Make the swipe-to-check-in area more prominent and centered

**B. Cleaner "Checked In" state:**
- Show check-in time and status more prominently at the top
- Move the notes textarea below the action buttons (less important)
- Reduce visual clutter of the break type selector

**C. Hide Break Types Management for non-admin:**
- Already handled (line 757), no change needed

**D. Remove the "Getting your location..." card when not needed** -- only show location status if location is not yet acquired, and make it a small inline message instead of a full card

**E. Overall:**
- Reduce vertical spacing to show more content above the fold on mobile
- Make the status badge larger and more visible at the top
- Keep existing functionality intact -- just reorganize for clarity

### Summary of Changes

| File | Change |
|------|--------|
| `HotelRoomOverview.tsx` | Add ACT (average clean time) badge in header, fetched from completed assignments |
| `HousekeepingManagerView.tsx` | Auto Assign: blue bg + white text (default variant). Assign Room: outline variant |
| `AttendanceTracker.tsx` | Simplify layout: compact location, remove pre-checkin notes, larger status badge, cleaner spacing |

### Technical Details

**ACT calculation:**
```
1. Query room_assignments WHERE assignment_date = selectedDate AND status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
2. For each: duration = completed_at - started_at (minutes)
3. ACT = average of all durations, rounded to nearest minute
4. Display as badge: "ACT: 23m" or "ACT: --" if no data
```

**Button styling changes (HousekeepingManagerView lines 567-591):**
- Auto Assign: `variant="default"` with `className="bg-primary text-primary-foreground hover:bg-primary/90"`
- Assign Room: `variant="outline"` (removes the filled blue background)

**Attendance UI simplification:**
- Move `Textarea` for notes after action buttons (checked-in state) or remove from pre-check-in state entirely
- Reduce card padding on mobile from `p-6` to `p-4`
- Make the "Ready to start?" section the primary focus with no distracting elements above it

