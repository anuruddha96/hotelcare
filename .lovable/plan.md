

## Plan: Fix Auto Room Assignment Algorithm Balance

### Problem Analysis

Comparing the manager's preferred assignment (BEFORE) with the current algorithm output (AFTER):

**BEFORE (preferred):** All 5 staff have 6-7 checkouts, times range 7h-7h25m (tight balance)
**AFTER (current):** Khulan gets 10 checkouts (8h45m, over shift), Tran Van Linh also over shift. Severe checkout imbalance.

Root causes in `src/lib/roomAssignmentAlgorithm.ts`:
1. **Rebalancing step (STEP 4, line 502-503) refuses to move checkouts**: `if (room.is_checkout_room) continue` — this hard block prevents fixing checkout imbalance
2. **No checkout equalization step** — weight-based rebalancing doesn't account for checkout count specifically
3. **Wing-split threshold too permissive** — a 12-room wing gets assigned to one person before splitting kicks in

### Changes

**File: `src/lib/roomAssignmentAlgorithm.ts`**

**1. Allow checkout moves during rebalancing when checkout imbalance is severe (STEP 4, ~line 500-503)**

Replace the hard `if (room.is_checkout_room) continue` with a conditional check:
- Calculate max and min checkout counts across all staff
- If the difference exceeds 2, allow moving checkouts from the heaviest-checkout staff
- Only skip checkout moves when the checkout distribution is already balanced (diff ≤ 2)

**2. Add a new STEP 4b: Checkout Equalization Pass (after STEP 4, before STEP 5)**

Insert a dedicated checkout-balancing loop:
- While (maxCheckouts - minCheckouts > 2): move one checkout room from the staff with the most checkouts to the staff with the fewest
- When choosing which checkout to move, prefer rooms on floors the target staff already works on (use existing `getFloorSpreadPenalty` + `getSequenceBonus`)
- Cap at 15 iterations to prevent infinite loops

**3. Lower the wing-split threshold (line 444)**

Change from `avgTargetWeight * 1.4` to `avgTargetWeight * 1.25` — this makes the algorithm split large wings sooner, preventing one housekeeper from being overloaded by a single large wing (like the 12-room Wing D).

**4. Reduce the checkout-skip bias in count rebalancing (STEP 5, line 557)**

Currently STEP 5 only moves daily rooms (`mostRooms.filter(r => !r.is_checkout_room)`). Change this to allow checkout room moves when the room-count difference exceeds 3, using the same floor-concentration and affinity scoring.

### Summary

| Change | Location | Impact |
|--------|----------|--------|
| Allow checkout moves in weight rebalancing | STEP 4, line ~502 | Fixes checkout concentration |
| Add checkout equalization pass | New STEP 4b | Ensures max 2 checkout difference |
| Lower wing-split threshold | Line 444 | Prevents overloading from large wings |
| Allow checkout moves in count rebalancing | STEP 5, line ~557 | Better room count distribution |

