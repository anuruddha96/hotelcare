

## Plan: Fix DND Stale Data Bug and Improve Wing-Based Room Assignment Algorithm

### Issue 1: Room 002 Stuck as DND

**Root cause found:** The PMS upload uses `selectedHotel = profile?.assigned_hotel` which can be either a hotel_id (e.g., `memories-budapest`) or a hotel_name (e.g., `Hotel Memories Budapest`). The DND batch reset query uses `.eq('hotel', selectedHotel)` but the `rooms` table stores `hotel` as the full name (`Hotel Memories Budapest`). When `selectedHotel` is the hotel_id format, the reset matches zero rows and silently fails.

**Fix:** Move the hotel name resolution (lines 450-458) to BEFORE the reset queries (before line 357), so all reset operations use the resolved hotel name.

### Issue 2: Algorithm Scattering Rooms Across Too Many Wings

**Root cause:** The current algorithm separates checkout rooms from daily rooms and distributes checkouts via pure weight-based round-robin -- completely ignoring wings. This means each housekeeper gets checkout rooms scattered across 4-6 different wings. Daily rooms are then assigned by wing, but the damage is done.

Example from screenshot: Anujin has rooms from wings A, E, H, I, D, B (6 wings!) -- she'd be running across the entire hotel.

**Fix:** Redesign the algorithm to group ALL rooms (checkout + daily) by wing first, then distribute entire wing groups to housekeepers. This ensures each housekeeper works in 1-3 adjacent wings maximum.

### Issue 3: Incorrect Elevator Proximity Values

Based on the hand-drawn floor map, some proximity values are wrong. The elevator is between rooms 002 and 032 on the ground floor. Rooms on higher floors and at the far ends of corridors should have higher proximity values.

**Corrections needed:**

| Wing | Rooms | Current Proximity | Correct Proximity |
|------|-------|-------------------|-------------------|
| L | 302-308 | 1 | 3 (furthest from elevator, top floor) |
| I | 202-210 | 1 | 2 (above elevator but 2nd floor) |
| J | 201-217 | 2 | 3 (far side, 2nd floor) |
| K | 212-216 | 2 | 3 (far from elevator, 2nd floor) |
| D | 101-127 | 2 | 2-3 (far corridor, 1st floor) |

### Changes

#### 1. Fix hotel name resolution order (`PMSUpload.tsx`)

Move the hotel name resolution block (currently at lines 450-458) to before the reset section (before line 357). Then use the resolved name for all reset queries (DND, T/RC, assignments).

#### 2. Redesign algorithm to group ALL rooms by wing (`roomAssignmentAlgorithm.ts`)

New approach:
1. Group ALL rooms (checkout + daily together) by wing
2. Sort wing groups by total weight (heaviest first)
3. Assign entire wing groups to the housekeeper with lowest current weight, using proximity to prefer nearby wings for the same housekeeper
4. Only split a wing if assigning it whole would exceed 40% above average
5. Run a gentler rebalancing pass that prefers moving rooms within similar wings

This ensures each housekeeper gets a compact work area (1-3 adjacent wings) rather than rooms scattered across 6+ wings.

#### 3. Fix elevator proximity values (SQL migration)

Update proximity values to match actual physical layout:
- Wing L (302-308): change from 1 to 3
- Wing I (202-210): change from 1 to 2
- Wing J (201-217): keep at 2 (close rooms) or set to 3 (far rooms)
- Wing K (212-216): change from 2 to 3

### Files to modify

| File | Changes |
|------|---------|
| `src/components/dashboard/PMSUpload.tsx` | Move hotel name resolution before reset queries |
| `src/lib/roomAssignmentAlgorithm.ts` | Redesign to group ALL rooms by wing before distributing |
| SQL migration | Fix elevator proximity values for wings I, J, K, L |

### Technical Details

**New algorithm flow:**

```text
STEP 1: Group ALL rooms by wing (checkout + daily together)
STEP 2: Sort wing groups by total weight (heaviest first)
STEP 3: For each wing group:
   - Find housekeeper with lowest weight
   - If weights are close, prefer housekeeper already working in nearby wings (similar proximity)
   - If assigning whole wing exceeds 40% above average, split it
   - Otherwise assign entire wing to one housekeeper
STEP 4: Light rebalancing (only move rooms if it keeps wing coherence)
STEP 5: Sort each housekeeper's rooms: checkout first, then by floor/room number
```

**Hotel name resolution fix:**

```typescript
// Resolve hotel name FIRST before any reset queries
let resolvedHotelName = selectedHotel;
if (selectedHotel) {
  const { data: hotelConfig } = await supabase
    .from('hotel_configurations')
    .select('hotel_name')
    .eq('hotel_id', selectedHotel)
    .maybeSingle();
  resolvedHotelName = hotelConfig?.hotel_name || selectedHotel;
}

// Now use resolvedHotelName for ALL queries
```

**Proximity SQL fix:**

```sql
UPDATE rooms SET elevator_proximity = 3 WHERE wing = 'L';
UPDATE rooms SET elevator_proximity = 2 WHERE wing = 'I';
UPDATE rooms SET elevator_proximity = 3 WHERE wing = 'J' AND room_number::int >= 211;
UPDATE rooms SET elevator_proximity = 3 WHERE wing = 'K';
```

