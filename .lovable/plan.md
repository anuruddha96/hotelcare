

## Plan: 4 Issues to Fix

### Issue 1: Tab Hierarchy Not Visible

**Root Cause**: The `TabsTrigger` in `tabs.tsx` uses `bg-primary text-primary-foreground` for active state — this is a solid dark blue that works. But the problem is **the main Radix Tabs component only sets `data-[state=active]` on the currently focused trigger within its own scope**. When you click a sub-tab inside `HousekeepingTab`, the **parent** `Tabs` component (in `Dashboard.tsx`) still has `value="housekeeping"` — so the parent trigger IS active. The styling should be visible.

After re-examining the screenshot: the main tabs (Tickets, Rooms, Housekeeping, Attendance) appear with NO highlight at all. The sub-tabs also show no highlight. Only the deepest active tab shows it.

The real issue: The `TabsTrigger` components are wrapped inside `HelpTooltip` components (lines 447-506 in Dashboard.tsx). The `HelpTooltip` wrapping may interfere with the Radix trigger's `data-[state=active]` attribute propagation, OR the `overflow-x-auto` on the parent div clips the visual styling.

**Fix**: Instead of relying solely on `data-[state=active]` CSS, I'll ensure the main tab and sub-tab containers explicitly pass a highlighted style. The approach:
- Keep the current `data-[state=active]` styling in `tabs.tsx` with high contrast (`bg-primary text-primary-foreground`)
- Verify the `HelpTooltip` wrapper doesn't break the active state — if it does, restructure so the tooltip wraps the trigger content, not the trigger itself

**Files**: `src/components/ui/tabs.tsx`, potentially `src/components/dashboard/Dashboard.tsx`

---

### Issue 2: PMS Upload Sets Rooms as "Clean" Incorrectly

**Root Cause**: In `PMSUpload.tsx` line 582, `newStatus` defaults to `'clean'`. Any room that doesn't match checkout, occupied, or PMS-status-dirty conditions falls through to clean. This is wrong — rooms where a guest departed (even early) should be `dirty` unless explicitly a no-show.

The no-show detection (line 677) requires: `Occupied=No AND Status=Untidy AND Arrival exists`. Only then is `clean` appropriate.

For rooms like 308 and 213: if they're unoccupied with no departure time and no "untidy" status, they default to `clean`. The fix: **default status should be `dirty`** for any room that was previously dirty or had guest activity, and only set to `clean` for confirmed no-shows.

**Fix**: Change the default `newStatus` from `'clean'` to keeping the current room status, and only set to `'clean'` explicitly for no-show rooms. If a room is unoccupied with no departure, no arrival, and no untidy status — it should remain as its current status (not forcefully set to clean).

**File**: `src/components/dashboard/PMSUpload.tsx`

---

### Issue 3: Switch Checkout ↔ Daily on Room Chip Hover & Settings

**Current State**: The switch button already exists in both the popover (line 635-657) and the room settings dialog (line 1261-1298). However, it's **only shown when an assignment exists** (`{assignment && (...)}` on line 635 and 1261). Rooms without assignments can't be switched.

**Fix**: Allow switching even without an assignment by updating the `is_checkout_room` flag on the room directly. When there's no assignment, just toggle the room's `is_checkout_room` field.

**File**: `src/components/dashboard/HotelRoomOverview.tsx`

---

### Issue 4: Auto-Saved Status for Manager Notes in Hotel Room Overview

**Current State**: The popover notes textarea (line 701-726) auto-saves on blur and shows a `toast.success` message. But there's no inline visual indicator showing the save status.

**Fix**: Add a small "Saved ✓" / "Saving..." indicator next to the notes textarea that appears briefly after auto-save completes.

**File**: `src/components/dashboard/HotelRoomOverview.tsx`

---

### Summary of Changes

| File | Changes |
|------|---------|
| `src/components/ui/tabs.tsx` | Verify/fix active state styling visibility |
| `src/components/dashboard/Dashboard.tsx` | Ensure HelpTooltip wrapping doesn't block active state |
| `src/components/dashboard/PMSUpload.tsx` | Change default room status logic — only no-shows get `clean`, all other unoccupied rooms keep current status |
| `src/components/dashboard/HotelRoomOverview.tsx` | Allow switch checkout/daily without assignment; add auto-save indicator for manager notes |

