

## Plan: Housekeeper-Manager Communication, Card Redesign, and No Service Fixes

### Issue 1: Drag-and-Drop Room Type Changes Not Reflected on Housekeeper Side

**Root Cause**: The `handleDrop` in `HotelRoomOverview.tsx` correctly updates `rooms.is_checkout_room` and `room_assignments.assignment_type` in the DB. The housekeeper's `HousekeepingStaffView` has a realtime subscription on `room_assignments` UPDATE events, which triggers `fetchAssignments()`. This should work — but the subscription filters by `assigned_to=eq.${user.id}`, so the UPDATE event should fire. The likely gap is that the housekeeper's `AssignedRoomCard` reads `assignment_type` from the initial fetch and doesn't re-render when the parent refetches. This actually works because `setAssignments` replaces state.

**Verification needed**: The realtime channel listens on UPDATE. The drag-drop updates `room_assignments.assignment_type`. This should trigger the subscription. The system should already work. Add a `ready_to_clean` reset when switching daily→checkout (set to false so it shows "waiting for checkout") and set to null/true when switching checkout→daily.

**Fix**: In `handleDrop`, when switching to checkout, also set `ready_to_clean: false`. When switching to daily, set `ready_to_clean: null`. This ensures housekeeper cards show correct state.

**File**: `src/components/dashboard/HotelRoomOverview.tsx`

---

### Issue 2: Two-Way Manager-Housekeeper Messaging with Translation

**Current state**: Managers send notes via room flags (`cleanNotes`). Housekeepers can translate via AI button. Housekeepers can add notes via `housekeeping_notes` table. But there's no reply/conversation UI.

**Fix**:
1. In `AssignedRoomCard.tsx`, add a "Messages" section that shows `housekeeping_notes` for this assignment as a chat-style thread (manager notes on left, housekeeper notes on right).
2. Each message bubble has a small "Translate" button that calls `translate-note` edge function.
3. Housekeepers can type a reply in their language. The note is saved to `housekeeping_notes` with `created_by` = housekeeper's ID.
4. Managers see these notes in the approval view / room overview popover, with their own translate button.

**Files**: `src/components/dashboard/AssignedRoomCard.tsx`, `src/components/dashboard/SupervisorApprovalView.tsx`

---

### Issue 3: No Service Button UI Fix

**Current state**: The No Service button renders correctly in code (line 937-997) but the screenshot shows it with a "Press & Hold to Start" label above it, which is confusing. The button is inside a Dialog trigger and should just be a simple click → dialog.

**Fix**: 
- Remove any "Press & Hold" text near the No Service button — it's for the Start button only
- Make the confirmation dialog use the user's app-selected language (already uses `t()` keys)
- After marking No Service, update the room's notes with `[NO_SERVICE]` flag so HotelRoomOverview chips show "NS" indicator in real-time

**File**: `src/components/dashboard/AssignedRoomCard.tsx`

---

### Issue 4: Redesign In-Progress Room Card — Remove Clutter, Highlight Important Info

**Current state** (from screenshot): Shows Hotel name block + Floor block taking large space, Room Name block, then Estimated Time. User wants: cleaning type, special requests, and notes at the top. Hotel/floor should be minimal. Room status should be a small inline badge, not a large alert block.

**Fix** in `AssignedRoomCard.tsx`:
1. **Remove** the large Hotel/Floor grid boxes (lines 860-906). Replace with a single compact line: "Floor 3 · Hotel Ottofiori" in small text under the room number.
2. **Remove** the separate Room Name block. Show room name inline next to room number in the header.
3. **Move** estimated time + timer to a compact inline badge next to the status badge in the header area.
4. **Keep** special instructions section exactly where it is (already between header and content — good).
5. **Replace** the Room Status Alert block (lines 1266-1277) with a small inline badge: just show "Dirty" / "Occupied" as a colored pill next to room number, not a large card.
6. **Result**: Card shows Room 305 (TRP-305) · Floor 3 · Dirty → then special instructions → then action buttons. Much more compact.

**File**: `src/components/dashboard/AssignedRoomCard.tsx`

---

### Issue 5: More Manager Options on Room Chips in Hotel Room Overview

**Current popover options**: Toggle towels, linen, ready-to-clean, notes, room size, bed config, switch type.

**Additional options to add**:
- Quick "No Service" override (mark a room as no-service from manager side)
- "Priority" toggle (set high priority flag on assignment)
- "Send Message to Housekeeper" — inline text input that saves to `housekeeping_notes` and shows on the housekeeper's card

**File**: `src/components/dashboard/HotelRoomOverview.tsx`

---

### Summary of Changes

| File | Changes |
|------|---------|
| `src/components/dashboard/AssignedRoomCard.tsx` | Compact card layout: remove large hotel/floor/status blocks; inline room name + floor + status as small text; add chat-style messages section with translate buttons; fix No Service button UI |
| `src/components/dashboard/HotelRoomOverview.tsx` | Set `ready_to_clean` on drag-drop type switch; add manager message input and priority toggle to room chip popover |
| `src/components/dashboard/SupervisorApprovalView.tsx` | Show housekeeper reply notes with translate button |

