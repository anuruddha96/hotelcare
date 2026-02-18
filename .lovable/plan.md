

## Plan: Smart Auto Room Assignment -- Auto-Save, Better Preview UI, and Proximity-Based Distribution

---

### 1. Auto-Save Housekeeper Selection and Manual Edits

Currently, when the Auto Room Assignment dialog opens, all state resets (line 98-108). Managers lose their staff selection and manual room moves if they close and reopen the dialog.

**Fix**: Persist the following to `localStorage` (keyed by hotel + date):
- Selected staff IDs (step 1)
- Assignment previews after generation or manual edits (step 2)
- Restore on dialog open if saved data exists for the same date

| File | Change |
|------|--------|
| `src/components/dashboard/AutoRoomAssignment.tsx` | On staff selection change, save to `localStorage`. On preview generation or room drag/move, save updated previews. On dialog open, check for saved state matching today's date and restore it, skipping to preview step if previews exist. Add a "Clear Saved" button. |

---

### 2. Improved Consolidated Preview UI

The current preview (step 2) shows one card per housekeeper stacked vertically. For 5+ staff, this requires lots of scrolling. The manager needs a bird's-eye view.

**Improvements**:
- Add a compact **summary table** at the top showing all housekeepers in one glance: name, checkout count, daily count, towel/linen tasks, estimated time, and a workload bar
- Each housekeeper card below shows rooms grouped by floor/wing for spatial context
- Add floor grouping labels within each housekeeper's room chips (e.g., "Floor 1", "Floor 2") so managers can see spatial distribution at a glance
- Show a **workload balance indicator** (colored bar proportional to max workload) in each card header

| File | Change |
|------|--------|
| `src/components/dashboard/AutoRoomAssignment.tsx` | Add summary table above the cards. Add floor grouping within each card's room list. Add workload bar visualization. |

---

### 3. Smarter Room Assignment Algorithm -- Proximity and Sequential Rooms

The algorithm already groups by wing and uses `WingProximityMap`. Based on the hotel floor map provided:

**Map analysis** (from the hand-drawn layout):
- Left corridor: rooms 101, 127 (floor 1) and 201, 215, 217 (floor 2)
- Center block: 114 (floor 1), 202-210, 212, 216 (floor 2)
- Bottom corridors: 130-136, 131-147 (floor 1)
- Right side: 144 (floor 1)
- Ground floor: 002, 010, 032-036, 034, 044
- Top floor: 302-308

**Improvements to the algorithm**:
1. **Sequential room number bonus**: When assigning rooms within a split wing, prefer keeping sequential room numbers together (e.g., 101-104 stays with the same housekeeper). Add a "sequence bonus" during the split phase that rewards placing a room next to rooms with adjacent numbers.
2. **Floor continuity bonus**: Prefer assigning rooms on the same floor to the same housekeeper to minimize elevator trips.
3. **Better sorting within assignments**: Sort each housekeeper's rooms in optimal cleaning order -- checkouts first (sorted by room number), then daily rooms (sorted by room number), within each category grouped by floor.

| File | Change |
|------|--------|
| `src/lib/roomAssignmentAlgorithm.ts` | Add `getSequenceBonus()` function that scores how well a room fits with existing assigned rooms based on room number adjacency. Integrate into the wing-split phase (line 313-327) and rebalancing phase. Update final sort to group by checkout-first then floor then room number. |

---

### 4. Early Checkout Prioritization for Housekeepers

Currently rooms are sorted by room number within checkout/daily groups. Early checkouts (rooms where guests depart early) should appear at the top of the housekeeper's list.

**Changes**:
- In the algorithm's final sort (Step 6, line 427-431), sort checkout rooms before daily rooms, and within checkouts sort by `priority` or `checkout_time` if available
- In the preview UI, add a note: "Checkouts appear first for housekeepers"
- When assignments are saved to the database, set `priority` field so checkout rooms have lower priority numbers (higher priority)

| File | Change |
|------|--------|
| `src/lib/roomAssignmentAlgorithm.ts` | Update final sort: checkouts first, then daily. Within each group, sort by floor then room number for optimal walking path. |
| `src/components/dashboard/AutoRoomAssignment.tsx` | Update priority assignment in `handleConfirmAssignment` -- checkouts get priority 1-N, daily rooms get priority N+1 onwards. Add info text in preview about room order. |

---

### Technical Details

**Auto-save localStorage key structure:**
```typescript
const SAVE_KEY = `auto_assignment_${profile?.assigned_hotel}_${selectedDate}`;

// Save on changes
useEffect(() => {
  if (selectedStaffIds.size > 0) {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      staffIds: Array.from(selectedStaffIds),
      previews: assignmentPreviews,
      savedAt: Date.now()
    }));
  }
}, [selectedStaffIds, assignmentPreviews]);

// Restore on open
useEffect(() => {
  if (open) {
    const saved = localStorage.getItem(SAVE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      // Only restore if less than 12 hours old
      if (Date.now() - data.savedAt < 12 * 60 * 60 * 1000) {
        setSelectedStaffIds(new Set(data.staffIds));
        if (data.previews?.length > 0) {
          setAssignmentPreviews(data.previews);
          setStep('preview');
        }
      }
    }
    fetchData();
  }
}, [open]);
```

**Sequential room number bonus:**
```typescript
function getSequenceBonus(roomNumber: string, existingRooms: RoomForAssignment[]): number {
  const num = parseInt(roomNumber, 10);
  if (isNaN(num)) return 0;
  let bonus = 0;
  for (const existing of existingRooms) {
    const existingNum = parseInt(existing.room_number, 10);
    if (isNaN(existingNum)) continue;
    const diff = Math.abs(num - existingNum);
    if (diff === 1) bonus += 3;       // Adjacent room - strong bonus
    else if (diff === 2) bonus += 2;   // Two apart - moderate bonus
    else if (diff <= 4) bonus += 1;    // Close by - small bonus
    // Same floor bonus
    if (Math.floor(num / 100) === Math.floor(existingNum / 100)) bonus += 0.5;
  }
  return bonus;
}
```

**Improved final sort (checkout-first, floor-grouped, sequential):**
```typescript
const sortedRooms = staffRooms.sort((a, b) => {
  // Checkouts always first
  if (a.is_checkout_room && !b.is_checkout_room) return -1;
  if (!a.is_checkout_room && b.is_checkout_room) return 1;
  // Within same type: sort by floor, then room number
  const floorA = getFloorFromRoomNumber(a.room_number);
  const floorB = getFloorFromRoomNumber(b.room_number);
  if (floorA !== floorB) return floorA - floorB;
  return parseInt(a.room_number) - parseInt(b.room_number);
});
```

**Summary table in preview:**
```typescript
<div className="grid grid-cols-[1fr,auto,auto,auto,auto] gap-x-4 gap-y-1 text-xs px-3 py-2 bg-muted/40 rounded-lg">
  <span className="font-semibold">Staff</span>
  <span className="font-semibold text-center">CO</span>
  <span className="font-semibold text-center">Daily</span>
  <span className="font-semibold text-center">Tasks</span>
  <span className="font-semibold text-right">Time</span>
  {assignmentPreviews.filter(p => p.rooms.length > 0).map(p => (
    <>
      <span>{p.staffName}</span>
      <span className="text-center text-amber-600">{p.checkoutCount}</span>
      <span className="text-center text-blue-600">{p.dailyCount}</span>
      <span className="text-center text-red-600">
        {p.rooms.filter(r => r.towel_change_required).length}T
      </span>
      <span className="text-right">{formatMinutesToTime(p.totalWithBreak)}</span>
    </>
  ))}
</div>
```

**Priority assignment fix in handleConfirmAssignment:**
```typescript
const assignments = assignmentPreviews.flatMap(preview => {
  // Sort: checkouts first, then daily, by floor and room number
  const sorted = [...preview.rooms].sort((a, b) => {
    if (a.is_checkout_room && !b.is_checkout_room) return -1;
    if (!a.is_checkout_room && b.is_checkout_room) return 1;
    return parseInt(a.room_number) - parseInt(b.room_number);
  });
  return sorted.map((room, index) => ({
    room_id: room.id,
    assigned_to: preview.staffId,
    assigned_by: user.id,
    assignment_date: selectedDate,
    assignment_type: room.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning',
    status: 'assigned',
    priority: index + 1, // Checkouts get lowest numbers (highest priority)
    organization_slug: profile?.organization_slug,
    ready_to_clean: !room.is_checkout_room
  }));
});
```

---

### Summary of All Changes

| Area | Changes |
|------|---------|
| `src/components/dashboard/AutoRoomAssignment.tsx` | Auto-save/restore staff selection and previews via localStorage. Add summary table at top of preview. Add floor grouping labels in room chips. Improve priority ordering when saving assignments. Add "Clear Saved" button. |
| `src/lib/roomAssignmentAlgorithm.ts` | Add `getSequenceBonus()` for sequential room number affinity. Integrate into wing-split and rebalancing phases. Update final sort: checkouts first, then by floor and room number. Add floor continuity bonus. |

