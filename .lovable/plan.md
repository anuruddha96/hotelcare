

## Plan: Fix Checkout Count - Only Departure Time = Checkout

### Root Cause

The code at lines 546-560 in `PMSUpload.tsx` has a dedicated branch that classifies rooms where `Night = Total` (e.g., 3/3) AND no departure time as "Early Checkout" and adds them to the checkout list. But these 21 rooms still have `Occupied = Igen` (Yes) -- the guest hasn't left yet. Only when the PMS records a departure time has the guest actually checked out.

**Current behavior:** 30 (departure time) + 21 (early checkout) = 51 checkouts, 20 daily
**Expected behavior:** 30 checkouts, 41 daily cleaning (20 regular + 21 last-night guests)

### Fix (single file)

**File: `src/components/dashboard/PMSUpload.tsx`**

**Remove lines 546-560** (the `isEarlyCheckout && departureParsed === null` block that adds rooms to `checkoutRoomsList`). Let these rooms fall through to the next condition at line 561: `isOccupiedYes(occupiedVal) && departureParsed === null` which correctly classifies them as daily cleaning.

The early checkout info is still preserved:
- The `isEarlyCheckout` flag is still set at line 501-502
- The room notes at line 593 still include "Early Checkout" text
- The daily cleaning list entry will show the note

**After the fix, the logic becomes:**
1. Has departure time? --> Checkout (30 rooms)
2. Occupied = Yes, no departure? --> Daily cleaning (41 rooms, some noted as "last night")
3. Occupied = No, Status = Untidy, has Arrival? --> No Show
4. Status = Untidy/Dirty? --> Dirty room

### Safety: Hotel Ottofiori

- No column mapping changes
- No status matching changes
- Only removing the early checkout --> checkout classification branch
- Ottofiori rooms with departure times still work as checkouts

