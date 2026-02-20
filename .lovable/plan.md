

## Plan: Smarter Auto-Assignment Algorithm, Room Category Labels, and Admin-Only Minibar Logo

---

### Problem Analysis

From the screenshot, **Otgo** has rooms on **4 different floors** (F0: 044, F1: 130-143, F2: 216, F3: 304). The manager (Eva) prefers housekeepers concentrated on 1-2 floors maximum. The current floor penalty (`newFloorCount * 5`) is too weak -- it gets overridden during the split and rebalance phases (STEP 4 and STEP 5) where floor penalties are not enforced at all.

Also, the room chips in the auto-assignment preview show only room numbers -- the user wants short category names like "Queen", "DB/TW", "Triple", "Quad".

Finally, the Minibar Guest Page Logo upload feature is currently visible to `admin`, `manager`, and `housekeeping_manager` roles but should be restricted to `admin` only.

---

### 1. Fix Algorithm: Enforce Floor Concentration

**File: `src/lib/roomAssignmentAlgorithm.ts`**

**Root cause**: The floor spread penalty is only applied in STEP 3 (wing assignment), but STEP 4 (weight rebalancing) and STEP 5 (count rebalancing) freely move rooms across floors without any floor penalty. This is how Otgo ends up with rooms on 4 floors.

**Changes:**

A. **Increase floor penalty strength** in `getFloorSpreadPenalty`:
   - Change from `newFloorCount * 5` to `newFloorCount * 15` (3x stronger)
   - This makes it much harder for any housekeeper to get assigned a 3rd or 4th floor

B. **Add floor penalty to STEP 3 split phase** (lines 390-405):
   - When splitting a wing, include `getFloorSpreadPenalty` in the candidate scoring, not just weight + affinity + sequence
   - This prevents the split from scattering rooms across floors

C. **Add floor guard to STEP 4 rebalancing** (lines 435-457):
   - Before moving a room, check if it would add a NEW floor to the target housekeeper
   - If moving to a new floor (3rd+ floor for that housekeeper), apply a very high penalty (50+) to strongly discourage it
   - Only allow cross-floor moves if the balance improvement is dramatic

D. **Add floor guard to STEP 5 count rebalancing** (lines 486-498):
   - Add floor penalty to the sorting score when picking which room to move
   - Skip rooms that would give the target a 3rd+ floor unless absolutely necessary

E. **Increase affinity weight** in split and rebalance phases:
   - Multiply affinity bonuses by 5x (from `* 2` to `* 10`) so historical manager patterns have stronger influence
   - This makes the algorithm respect Eva's corrections more aggressively

---

### 2. Show Room Category Short Names in Auto-Assignment Preview

**File: `src/components/dashboard/AutoRoomAssignment.tsx`**

Add a helper function to convert full room category names to short labels:

```text
Category mapping:
  "Economy Double Room"        -> "Eco"
  "Deluxe Double or Twin Room" -> "DB/TW"  
  "Deluxe Queen Room"          -> "Queen"
  "Deluxe Triple Room"         -> "Triple"
  "Deluxe Quadruple Room"      -> "Quad"
  "Comfort Quadruple Room"     -> "Quad"
  "Comfort Double Room..."     -> "Comfort"
  "Deluxe Single Room"         -> "Single"
  "...Synagogue View"          -> "SV" (suffix)
```

In `renderRoomChip` (line 559), add the short category label after the room number:
```
130 DB/TW    instead of just    130
```

Display it as a smaller, muted text next to the room number.

---

### 3. Restrict Minibar Logo Upload to Admin Only

**File: `src/components/dashboard/MinibarTrackingView.tsx`**

Change the guard on line 492 from:
```typescript
{canManageItems && (    // canManageItems = admin, manager, housekeeping_manager
```
To a new admin-only check:
```typescript
{userRole === 'admin' && (
```

This ensures only admins can see and use the "Minibar Guest Page Logo" upload section. The `canManageItems` permission (which includes managers) remains for other minibar management features.

---

### 4. Show Room Category in Hotel Room Overview Tooltip

**File: `src/components/dashboard/HotelRoomOverview.tsx`**

The tooltip already shows `room.room_category` (line 389). No changes needed here -- the category is already visible in the expanded tooltip.

---

### Technical Summary

| File | Changes |
|------|---------|
| `src/lib/roomAssignmentAlgorithm.ts` | Increase floor penalty 3x. Add floor guards to STEP 3 split, STEP 4, and STEP 5. Increase affinity weights 5x. |
| `src/components/dashboard/AutoRoomAssignment.tsx` | Add `getCategoryShortName()` helper. Show short category labels in room chips. |
| `src/components/dashboard/MinibarTrackingView.tsx` | Change Minibar Logo section guard from `canManageItems` to `userRole === 'admin'`. |

