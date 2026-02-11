

## Plan: Fix Scrolling Issues and Verify Dirty Linen Mobile UI

### Issue 1: PublicAreaAssignment Dialog - Cannot Scroll

**Root Cause:** Radix `ScrollArea` component does not reliably activate scrolling inside flex dialog containers, even with `min-h-0`. The content overflows but no scrollbar appears.

**Fix:** Replace `ScrollArea` with a plain `div` using `overflow-y-auto` and a constrained height.

**File:** `src/components/dashboard/PublicAreaAssignment.tsx`
- Line 104: Replace `<ScrollArea className="flex-1 min-h-0 px-1">` with `<div className="flex-1 min-h-0 overflow-y-auto px-1">`
- Line 175: Replace closing `</ScrollArea>` with `</div>`
- Remove the unused `ScrollArea` import (line 10)

---

### Issue 2: AutoRoomAssignment Dialog - Cannot Scroll in Preview

**Root Cause:** Same issue -- Radix `ScrollArea` not activating in the flex dialog.

**Fix:** Replace `ScrollArea` with a plain `div` using `overflow-y-auto`.

**File:** `src/components/dashboard/AutoRoomAssignment.tsx`
- Line 349: Replace `<ScrollArea className="flex-1 min-h-0 px-1">` with `<div className="flex-1 min-h-0 overflow-y-auto px-1">`
- Find the corresponding closing `</ScrollArea>` and replace with `</div>`
- Remove `ScrollArea` from imports if no longer used

---

### Issue 3: Dirty Linen Mobile UI

**Current State:** The code already has the mobile card layout implemented (line 335: `isMobile ? renderMobileCards() : renderDesktopTable()`). The `renderMobileCards()` function (lines 195-243) correctly displays all linen types in a vertical card-based grid.

**What the user sees:** The screenshot (image-387) shows the desktop table view with horizontal scrolling, which is the expected desktop behavior. On mobile devices (width less than 768px), the card layout will automatically activate.

**However**, the mobile breakpoint might not trigger on tablets. To ensure better coverage, I will also make the desktop table more responsive by removing the `min-w-[120px]` constraint on column headers so it fits better on medium screens, and lower the mobile breakpoint check or add an additional condition for when there are many linen items.

**File:** `src/components/dashboard/SimplifiedDirtyLinenManagement.tsx`
- Line 253: Remove `min-w-[120px]` from column headers to allow columns to compress on medium screens
- Line 335: Add a secondary condition: use mobile cards if `isMobile` OR if screen is narrow relative to number of items. Alternatively, simply use cards for any screen under 1024px when there are 8+ linen types.

---

### Summary

| File | Change |
|------|--------|
| `PublicAreaAssignment.tsx` | Replace `ScrollArea` with `div overflow-y-auto` |
| `AutoRoomAssignment.tsx` | Replace `ScrollArea` with `div overflow-y-auto` |
| `SimplifiedDirtyLinenManagement.tsx` | Remove min-width constraints, widen mobile card breakpoint for many columns |

### Technical Details

The core issue with `ScrollArea` (Radix) is that it uses an internal viewport element that doesn't respect flex shrinking in all browsers/contexts. A native `overflow-y-auto` on a `div` with `flex-1 min-h-0` is the reliable CSS solution for scrollable flex children.

