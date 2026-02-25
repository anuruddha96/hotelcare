

## Plan: Fix Current Stays Minibar Logic to Show All Active Guest Usage

### Root Cause

The "Current Stays" view filters by `is_cleared = false`, but all usage records for Room 302 (and others) are already marked `is_cleared = true`. The guest in Room 302 is still staying (checkout 02/27, 4 nights stayed), and their brownie box usage from 02/23 should be visible for billing — but it's hidden.

**14 rooms currently have active guests** with `guest_nights_stayed > 0`. Several have minibar usage that's all marked cleared but guests haven't checked out yet.

### The Fix

**File: `src/components/dashboard/MinibarTrackingView.tsx`**

Replace the "Current Stays" logic entirely. Instead of filtering by `is_cleared = false`:

1. **Step 1**: Fetch all rooms for the user's hotel that have active guests (`guest_nights_stayed > 0`)
2. **Step 2**: For each room, calculate the stay start date: `today - guest_nights_stayed + 1`
3. **Step 3**: Fetch ALL `room_minibar_usage` records for those room IDs where `usage_date >= stay_start_date`, regardless of `is_cleared` status
4. **Step 4**: Display these records grouped by room, showing both cleared and uncleared items

**Specific code change in `fetchMinibarData`** (lines 480-494):

```typescript
if (viewMode === 'current') {
  // Step 1: Get all rooms with active guests
  const { data: activeRooms } = await supabase
    .from('rooms')
    .select('id, room_number, hotel, guest_nights_stayed, is_checkout_room')
    .or(`hotel.eq.${userHotel},hotel.eq.${hotelNameToFilter}`)
    .gt('guest_nights_stayed', 0);

  if (activeRooms && activeRooms.length > 0) {
    const roomIds = activeRooms.map(r => r.id);
    // Calculate earliest possible check-in across all rooms
    const maxNights = Math.max(...activeRooms.map(r => r.guest_nights_stayed));
    const earliestCheckIn = startOfDay(subDays(new Date(), maxNights - 1));

    // Step 2: Fetch ALL usage during active stays
    const { data, error } = await supabase
      .from('room_minibar_usage')
      .select(`...same fields...`)
      .in('room_id', roomIds)
      .gte('usage_date', earliestCheckIn.toISOString())
      .order('usage_date', { ascending: false });

    // Step 3: Filter per-room to only include usage within that room's stay period
    filteredData = (data || []).filter(record => {
      const room = activeRooms.find(r => r.id === record.room_id);
      if (!room) return false;
      const stayStart = startOfDay(subDays(new Date(), room.guest_nights_stayed - 1));
      return new Date(record.usage_date) >= stayStart;
    });
  }
}
```

This means:
- Room 302 (4-night stay, check-in ~Feb 22) will show the brownie box from Feb 23 even though it's cleared
- All rooms with active guests and any minibar usage during their stay will appear
- Both cleared and uncleared items are visible for accurate billing at checkout

### UI Adjustments

In the room cards, items already show a "Cleared" badge when `is_cleared === true`. No UI changes needed — the existing display handles both states correctly.

### Summary

| What | Detail |
|------|--------|
| Problem | `is_cleared = false` filter hides all usage for active guests |
| Fix | Query by active rooms + stay dates instead of cleared status |
| File | `src/components/dashboard/MinibarTrackingView.tsx` |
| Scope | ~30 lines changed in `fetchMinibarData` function |

