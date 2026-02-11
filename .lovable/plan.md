
## Plan: Fix Multiple Issues - Scroll, Login, Public Areas, Dirty Linen UI

This plan addresses 5 distinct issues reported by the user.

---

### Issue 1: "Assign Public Areas" Dialog Cannot Scroll

**Root Cause:** The `ScrollArea` in `PublicAreaAssignment.tsx` (line 104) lacks `min-h-0`, same issue as the auto-assign dialog had.

**Fix:** In `src/components/dashboard/PublicAreaAssignment.tsx`:
- Line 104: Change `<ScrollArea className="flex-1 px-1">` to `<ScrollArea className="flex-1 min-h-0 px-1">`
- Also improve mobile layout: move Cancel/Assign buttons to a stacked layout on mobile with `flex-col-reverse sm:flex-row` in DialogFooter

---

### Issue 2: Hotel Memories Budapest Housekeepers Cannot Log In

**Root Cause:** The `profiles.email` field is empty for these housekeepers, while their actual email exists in `auth.users`. When a user types their username (e.g., "Suli_016"), the `get_email_by_nickname` database function looks up the email from `profiles.email` -- which is empty -- so Supabase auth receives an empty email and login fails.

This happened because older housekeepers were created via a database function that didn't populate the email field, while the newer `create-housekeeper` edge function correctly sets it.

**Fix (two parts):**

1. **Immediate data fix:** Update the `get_email_by_nickname` RPC function to fall back to `auth.users.email` when `profiles.email` is empty. This requires modifying the SQL function:

```sql
CREATE OR REPLACE FUNCTION public.get_email_by_nickname(p_nickname text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT COALESCE(
    NULLIF(p.email, ''),
    (SELECT a.email FROM auth.users a WHERE a.id = p.id)
  )
  FROM public.profiles p
  WHERE LOWER(p.nickname) = LOWER(p_nickname)
  LIMIT 1;
$$;
```

This is the cleanest fix because it handles all existing and future cases without needing to backfill data.

2. **Also sync profile emails (belt-and-suspenders):** Update profiles with empty emails to match their auth.users email. This is done via a migration:

```sql
UPDATE public.profiles p
SET email = a.email
FROM auth.users a
WHERE p.id = a.id
AND (p.email IS NULL OR p.email = '')
AND a.email IS NOT NULL;
```

**Files:** New Supabase migration file.

---

### Issue 3: Integrate Public Areas into Auto-Assign Flow + Summary Filter

**What:** After auto-assigning rooms, supervisors should be able to also assign public areas. Add a "Public Areas" step/option in the auto-assign dialog, plus a summary filter (Rooms / Public Areas toggle) in the Team View.

**Changes to `src/components/dashboard/AutoRoomAssignment.tsx`:**
- After Step 3 (Confirm), add a new step or a section that shows the Public Area assignment checklist
- After rooms are confirmed and assigned, show an optional "Assign Public Areas" section where supervisors can check areas and assign them to specific staff
- Add this as a post-confirmation step so it doesn't block the room assignment flow

**Changes to `src/components/dashboard/HousekeepingManagerView.tsx`:**
- Add filter buttons at the top of the Team View section: "Rooms" | "Public Areas" | "All" to toggle between room assignments and public area tasks
- Show public area task summary cards (assigned, in progress, completed counts)

---

### Issue 4: Public Area Tasks Visibility for Housekeepers + Hotel Room Overview

**What:** Ensure public area tasks show properly in housekeeper view (similar UI to room cards), and show assigned public areas in the Hotel Room Overview.

**Changes to `src/components/dashboard/HotelRoomOverview.tsx`:**
- Add a "Public Areas" section below Checkout and Daily rooms
- Only show if there are public area tasks assigned for the day
- Display each assigned area with the housekeeper name and status (similar chip style)

**Changes to `src/components/dashboard/MobileHousekeepingView.tsx`:**
- The public area tasks section already exists (lines 475-494) but only shows when `publicTasks.length > 0` -- this is correct
- Verify tasks always show regardless of status filter

**Changes to `src/components/dashboard/HousekeepingStaffView.tsx`:**
- Same verification for desktop view

---

### Issue 5: Dirty Linen Mobile View - Horizontal Scroll Issue

**Root Cause:** The table in `SimplifiedDirtyLinenManagement.tsx` uses `min-w-[120px]` for each column header (line 247), forcing horizontal scroll on mobile with 9+ linen types.

**Fix in `src/components/dashboard/SimplifiedDirtyLinenManagement.tsx`:**
- For mobile, replace the horizontal-scrolling table with a card-based layout
- Each housekeeper gets a card showing their linen items in a vertical or wrapped grid
- On desktop, keep the existing table layout
- Use `useIsMobile()` hook to detect viewport

The mobile layout will show:
```text
+---------------------------+
| Housekeeper: Ana          |
| Bed Sheet Twin: 5         |
| Bed Sheet Queen: 3        |
| Duvet Covers: 2           |
| ... (all types visible)   |
| Total: 15                 |
+---------------------------+
| Housekeeper: Natali       |
| ...                       |
+---------------------------+
```

---

### Summary of Changes

| File | Change |
|------|--------|
| `src/components/dashboard/PublicAreaAssignment.tsx` | Add `min-h-0` to ScrollArea, improve mobile button layout |
| New migration SQL | Fix `get_email_by_nickname` RPC + sync empty profile emails from auth.users |
| `src/components/dashboard/AutoRoomAssignment.tsx` | Add optional Public Area assignment step after room confirmation |
| `src/components/dashboard/HousekeepingManagerView.tsx` | Add Rooms/Public Areas filter toggle in Team View |
| `src/components/dashboard/HotelRoomOverview.tsx` | Add Public Areas section showing assigned areas |
| `src/components/dashboard/SimplifiedDirtyLinenManagement.tsx` | Mobile-friendly card layout for linen data |

### No Changes To
- Room assignment algorithm (already fixed)
- Manual assignment dialog
- Existing housekeeper room card UI
- Public area task card component (already working)
