

## Plan: Fix Auto-Assign Scroll Issue and Improve Room Distribution Fairness

### Issue 1: Preview Section Not Scrollable

**Root Cause:** The `ScrollArea` component on line 275 of `AutoRoomAssignment.tsx` is used but doesn't have a proper height constraint. While the dialog has `max-h-[90vh] flex flex-col`, the ScrollArea just has `className="flex-1 px-1"` which doesn't reliably constrain its height for Radix ScrollArea to activate scrolling.

**Fix:** Add `overflow-y-auto` styling and ensure the ScrollArea has a constrained height by setting `max-h` or using `min-h-0` on the flex child (the standard flex overflow fix).

**File:** `src/components/dashboard/AutoRoomAssignment.tsx`
- Line 275: Change `<ScrollArea className="flex-1 px-1">` to `<ScrollArea className="flex-1 min-h-0 px-1">`
- This is the standard CSS fix: a flex child with `flex-1` needs `min-h-0` to allow shrinking below its content size, which then lets ScrollArea's internal overflow kick in.

---

### Issue 2: Unfair Room Count Distribution (16 vs 13 rooms)

**Root Cause:** The algorithm balances by **weight** but not by **room count**. From the screenshot:
- Anujin: 16 rooms (6 CO + 10 Daily), Weight 19.0
- Frank: 13 rooms (6 CO + 7 Daily)
- Others: 14 rooms each

The weight-based rebalancing pass (Step 4, line 244-297) has two problems:

1. **Too restrictive move condition** (line 279): `room.weight <= targetDiff + 0.5` prevents moving rooms when the weight gap is small but room count gap is large. Standard daily rooms have weight 1.0, but if `targetDiff` is small (e.g., 0.4), no room qualifies.

2. **No room count balancing**: The algorithm only looks at weight deviation. A housekeeper can end up with significantly more rooms if those rooms happen to be lighter (smaller size).

**Fix in `src/lib/roomAssignmentAlgorithm.ts`:**

1. **Relax the move condition** in the existing rebalancing loop: Remove the overly restrictive `room.weight <= targetDiff + 0.5` constraint. Instead, only verify that the move would actually reduce the imbalance (new difference < old difference).

2. **Add a room count rebalancing pass** after the weight rebalancing: If the max room count difference between any two staff exceeds 2, move a daily room from the staff with the most rooms to the staff with the fewest -- but only if it doesn't create a weight imbalance worse than 25%.

Here's the specific logic change:

**Step 4 fix (weight rebalancing, lines 244-297):**
```typescript
// Current (too restrictive):
if (diff < bestDiff && room.weight <= targetDiff + 0.5) {

// Fixed (verify move improves balance):
const newHeaviest = heaviestWeight - room.weight;
const newLightest = lightestWeight + room.weight;
if (Math.abs(newHeaviest - newLightest) < (heaviestWeight - lightestWeight)) {
  // This move improves balance
```

**New Step 5 (room count rebalancing):**
```typescript
// STEP 5: Room count rebalancing - ensure no housekeeper has >2 more rooms than another
let countRebalanced = true;
let countIterations = 0;
while (countRebalanced && countIterations < 20) {
  countRebalanced = false;
  countIterations++;
  
  // Find staff with most and fewest rooms
  const byCount = Array.from(assignments.entries())
    .map(([id, rooms]) => ({ id, count: rooms.length, weight: staffWeights.get(id)! }))
    .sort((a, b) => b.count - a.count);
  
  const most = byCount[0];
  const least = byCount[byCount.length - 1];
  
  if (most.count - least.count > 2) {
    // Find a daily room to move that won't cause >25% weight imbalance
    const mostRooms = assignments.get(most.id)!;
    const dailyRooms = mostRooms.filter(r => !r.is_checkout_room);
    
    // Pick lightest daily room
    const sorted = [...dailyRooms].sort((a, b) => a.weight - b.weight);
    if (sorted.length > 0) {
      const room = sorted[0];
      const newMostWeight = most.weight - room.weight;
      const newLeastWeight = least.weight + room.weight;
      const newAvg = totalWeight / staff.length;
      
      // Only move if it doesn't create excessive weight imbalance
      if (Math.abs(newLeastWeight - newAvg) <= newAvg * 0.25) {
        // Move room
        // ... splice from most, push to least, update weights
        countRebalanced = true;
      }
    }
  }
}
```

---

### Summary of Changes

| File | Change |
|------|--------|
| `src/components/dashboard/AutoRoomAssignment.tsx` (line 275) | Add `min-h-0` to ScrollArea to fix scroll |
| `src/lib/roomAssignmentAlgorithm.ts` (lines 274-283) | Relax weight rebalancing move condition |
| `src/lib/roomAssignmentAlgorithm.ts` (after line 297) | Add room count rebalancing pass (Step 5) |

### Expected Results

1. The preview section will be fully scrollable on both mobile and desktop
2. With 71 rooms and 5 staff, the distribution should be closer to 14-15 rooms each (instead of 13-16)
3. The existing manual assignment, fairness summary, and all other features remain unchanged

