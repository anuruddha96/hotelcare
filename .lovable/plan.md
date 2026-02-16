

## Plan: Fix Room Count Mismatch Between PMS Upload and Hotel Room Overview

### Root Cause

The PMS upload processing resets DND flags and towel/linen flags in a batch operation BEFORE processing each room. However, it does NOT batch-reset the `is_checkout_room` flag. This means:

1. If any individual room update fails silently during processing, the old `is_checkout_room` value from a previous upload persists
2. The per-room update (line 644) should correct each room, but without a batch reset as a safety net, stale data can accumulate

**Evidence from the database:**
- PMS Upload Summary says: 30 checkouts, 41 daily
- Rooms table has: 27 with `is_checkout_room=true`, 44 with `is_checkout_room=false`
- Rooms like 008, 032, 040, 042 (which the upload classified as checkouts) still have `is_checkout_room=false`
- Rooms like 107, 109, 111, 113 (which should be daily today) still have `is_checkout_room=true` from a previous upload

### Fix

Add `is_checkout_room: false` to the batch reset that runs before room processing, alongside the existing DND and towel/linen resets. This guarantees a clean slate so that only rooms the current upload classifies as checkouts will have the flag set to true.

### Changes

| File | What Changes |
|------|-------------|
| `src/components/dashboard/PMSUpload.tsx` | Add batch reset of `is_checkout_room` and `checkout_time` before processing rows |

### Technical Detail

In `PMSUpload.tsx`, after the existing DND reset (around line 394) and towel/linen reset (around line 406), add a new batch reset:

```typescript
// Batch reset checkout flags to prevent stale data from previous uploads
const { error: checkoutResetError } = await supabase
  .from('rooms')
  .update({ is_checkout_room: false, checkout_time: null })
  .eq('hotel', hotelNameForFilter);

if (checkoutResetError) {
  console.warn(`Error resetting checkout flags for ${hotelNameForFilter}:`, checkoutResetError);
} else {
  console.log(`Reset checkout flags for all rooms in ${hotelNameForFilter}`);
}
```

This ensures that before any room is processed, ALL rooms in the hotel start with `is_checkout_room=false`. Then, as each row is processed, rooms with departures get `is_checkout_room=true` set correctly. The counts will match the upload summary exactly.

