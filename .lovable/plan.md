

## Plan: Fix Multiple Auto-Assignment and PMS Issues

This plan addresses 8 distinct issues reported by the user.

---

### Issue 1: Room 032 Showing "Twin Bed" Incorrectly

**Root Cause**: `bed_configuration` is a manual field set via the Room Settings popover. It persists across PMS uploads because the PMS `updateData` never resets it. Room 032 has a stale `bed_configuration` value from a previous guest.

**Fix**: Reset `bed_configuration` to `null` during PMS upload batch reset (alongside DND, towel/linen flags). Add `bed_configuration: null` to the batch reset query for the hotel's rooms in `PMSUpload.tsx` (around line 482-492).

**File**: `src/components/dashboard/PMSUpload.tsx`

---

### Issue 2: Room 134 Showing "Extra Cot" Incorrectly + Rename to "Baby Bed" for Memories

**Root Cause**: Same as above — stale `bed_configuration`. Additionally, the label "Extra Cot Added" should be "Baby Bed" for Hotel Memories Budapest.

**Fix**:
1. The batch reset (Issue 1) will clear stale bed configs.
2. Add hotel-aware labels: In `HotelRoomOverview.tsx` and `AutoRoomAssignment.tsx`, show "Baby Bed" instead of "Extra Cot" when the hotel is Hotel Memories Budapest. Update the dropdown options and chip display accordingly.

**Files**: `src/components/dashboard/HotelRoomOverview.tsx`, `src/components/dashboard/AutoRoomAssignment.tsx`

---

### Issue 3: Workload Imbalance (Khulan: 4co + 11d vs Others: 7co + 7d)

**Root Cause**: The algorithm's wing-first grouping assigns entire wing groups to the lightest housekeeper. When Khulan's zone has many daily rooms and few checkouts, she gets an imbalanced mix. The rebalancing pass (Step 4) avoids moving checkouts unless the checkout diff exceeds 2, but the total room weight may still be balanced (daily rooms are lighter).

**Fix**: Tighten the checkout equalization pass threshold from `> 2` to `> 1` (line 595 in `roomAssignmentAlgorithm.ts`). Also add a secondary rebalancing step that considers the ratio of checkouts-to-daily rooms, not just absolute counts.

**File**: `src/lib/roomAssignmentAlgorithm.ts`

---

### Issue 4: Nicolas Has Rooms 206 + 202 (Far from Main Cluster) / Otgo Has F3 + F1 Mix

**Root Cause**: The room count rebalancing pass (Step 5) moves rooms without strongly enough penalizing floor distance. Rooms from floor 2 (206, 202) get moved to Nicolas who primarily works floor 0. Similarly, Otgo gets F3 rooms (302, 304, 306, 308) mixed with F1.

**Fix**: Increase the floor-spread penalty in the count rebalancing pass (Step 5) to match the main assignment pass. Currently the penalty in Step 5 only uses `getFloorSpreadPenalty` but doesn't multiply it strongly enough. Add a 2x multiplier for floor penalties in the count-balance step to prevent cross-floor moves unless absolutely necessary.

**File**: `src/lib/roomAssignmentAlgorithm.ts`

---

### Issue 5: Auto-Mark Checkout Rooms as "Ready to Clean" When Guest Already Left

**Root Cause**: PMS upload detects checkout rooms (departure time set) but doesn't auto-mark them as ready to clean. When a departure time exists in the PMS file, the guest has already left.

**Fix**: When creating/updating checkout rooms during PMS upload, if a `departureParsed` exists (guest already departed), automatically set `ready_to_clean: true` on the room assignment created for that room. Add a note indicating it was "Auto-marked as Ready to Clean (guest departed per PMS)". Show this info to managers in the checkout rooms summary.

**File**: `src/components/dashboard/PMSUpload.tsx`

---

### Issue 6: Rename "Room Cleaning (RC)" to "Clean Room (C)" for Hotel Memories Budapest

**Root Cause**: The legend and toggle buttons use "Room Cleaning" terminology, but Hotel Memories uses "Clean Room" with a "C" marker.

**Fix**: Make the label hotel-aware. In `HotelRoomOverview.tsx`:
- Legend: Show "Clean Room" with "C" text (instead of "Room Cleaning" with "RC") when hotel is Memories Budapest
- Toggle button in popover: Show "🧹 Clean Room (C)" instead of "🧹 Room Cleaning (RC)"
- Keep "RC" for other hotels

Also update the `C` indicator label in `AutoRoomAssignment.tsx` print view from "Change Room" to "Clean Room" for consistency.

**File**: `src/components/dashboard/HotelRoomOverview.tsx`

---

### Issue 7: Towel/Clean Room Cycle Verification

The user lists:
- T days: 3,7,11,15,19,23,27
- C days: 5,9,13,17,21,25

Current code: `(guestNightsStayed - 3) % 4` — yields T at 3,7,11,15,19,23,27 (cyclePosition=0) and C at 5,9,13,17,21,25 (cyclePosition=2). **This already matches.** The user also mentions supporting Hungarian PMS headers for Night/Total — let me verify this is covered.

**Fix**: Verify Hungarian header fuzzy matching includes the Night/Total column pattern. Add any missing Hungarian variants (e.g., "Éjszaka/Összes", "Éj/Össz") to the fuzzy matcher. Also add a log showing the detected cycle for each room.

**File**: `src/components/dashboard/PMSUpload.tsx`

---

### Issue 8: PMS Upload Warning Not Showing + Hotel Isolation

**Root Cause**: The `checkFirstUploadToday` function uses a single localStorage key `pms_last_upload_date` — this is shared across ALL hotels. If you upload for Hotel A, then upload for Hotel B, it shows the warning for Hotel B even though it's the first upload for that hotel.

**Fix**: Make the localStorage key hotel-specific: `pms_last_upload_date_${selectedHotel}`. This ensures:
1. The warning correctly shows only for repeat uploads to the SAME hotel
2. Uploading for one hotel never affects another hotel's warning state

**File**: `src/components/dashboard/PMSUpload.tsx`

---

### Summary of Changes

| File | Changes |
|------|--------|
| `src/components/dashboard/PMSUpload.tsx` | Reset `bed_configuration` during batch reset; hotel-specific upload tracking key; auto-mark checkout rooms as ready-to-clean when departure exists; verify Hungarian Night/Total headers |
| `src/lib/roomAssignmentAlgorithm.ts` | Tighten checkout equalization to max diff of 1; increase floor penalty multiplier in count-rebalance step |
| `src/components/dashboard/HotelRoomOverview.tsx` | Hotel-aware labels: "Clean Room (C)" for Memories, "Room Cleaning (RC)" for others; "Baby Bed" vs "Extra Cot" |
| `src/components/dashboard/AutoRoomAssignment.tsx` | "Baby Bed" label for Memories; "Clean Room" in print view |

