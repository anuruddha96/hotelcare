
## Plan: Fix Towel Change Logic, Add Hotel Ottofiori Room Categories

### What's Wrong

**Issue 1: Towel change showing on ALL daily rooms instead of only night 3+**
The cleaning cycle code IS correct in the file (day 3 = Towel Change, day 5 = Towel Change, day 7 = Room Cleaning). However, the database currently contains stale data from a previous upload that ran with the OLD code (before the fix). Evidence:
- Room 101 (night 3): towel_change = false, but should be true
- Room 102 (night 2): towel_change = true, but should be false
- This is the exact pattern the OLD (inverted) code would produce

The RLS fix IS working (DND reset cleared successfully). The cleaning cycle code is correct. A re-upload with the current code will produce the right results.

However, to make this bulletproof, we will add explicit debug logging and a **post-upload verification check** that compares the expected towel/linen flags against what's actually in the database.

**Issue 2: Room categories not hotel-specific**
The `extractRoomInfo` function only handles Hotel Memories Budapest patterns (QUEEN, DOUBLE, TWIN, SNG, etc.). Hotel Ottofiori uses different PMS room prefixes:
- CQ = Comfort Queen (not handled)
- Q = Queen (partially handled -- wrongly matches nothing since "Q-101" doesn't contain "QUEEN")
- DB/TW = Double/Twin (partially handled -- matches "TWIN" or "DOUBLE" incorrectly)
- TRP = Triple (works -- matches existing TRP pattern)
- QRP = Quadruple (not handled separately for Ottofiori category)

**Issue 3: ROOM_CATEGORIES dropdown is hardcoded for Budapest only**
The category selector in HotelRoomOverview shows only Budapest room types. Hotel Ottofiori needs its own categories:
- Economy Double Room
- Deluxe Double or Twin Room
- Deluxe Queen Room
- Deluxe Triple Room
- Deluxe Quadruple Room

### Changes

**File 1: `src/components/dashboard/PMSUpload.tsx`**

1. Make `extractRoomInfo` hotel-aware by accepting the hotel name and having separate pattern blocks per hotel:

```
Hotel Ottofiori patterns:
  CQ-xxx -> queen, "Deluxe Queen Room"
  Q-xxx -> queen, "Deluxe Queen Room"
  DB/TW-xxx -> double_twin, "Deluxe Double or Twin Room"
  TRP-xxx -> triple, "Deluxe Triple Room"
  QRP-xxx -> quadruple, "Deluxe Quadruple Room"

Hotel Memories Budapest patterns (existing):
  SYN.DOUBLE, SYN.TWIN -> "Deluxe Double or Twin Room with Synagogue View"
  EC.QRP -> "Comfort Quadruple Room"
  ECDBL -> "Comfort Double Room with Small Window"
  QUEEN -> "Deluxe Queen Room"
  DOUBLE/TWIN -> "Deluxe Double or Twin Room"
  TRP -> "Deluxe Triple Room"
  QDR -> "Deluxe Quadruple Room"
  SNG -> "Deluxe Single Room"
```

2. Add a post-upload verification step that logs mismatches between expected and actual towel/linen flags, making future debugging trivial.

**File 2: `src/components/dashboard/HotelRoomOverview.tsx`**

1. Make ROOM_CATEGORIES hotel-aware with a mapping object:

```
HOTEL_ROOM_CATEGORIES = {
  'Hotel Ottofiori': [
    'Economy Double Room',
    'Deluxe Double or Twin Room',
    'Deluxe Queen Room',
    'Deluxe Triple Room',
    'Deluxe Quadruple Room',
  ],
  default: [
    'Deluxe Double or Twin Room with Synagogue View',
    'Deluxe Double or Twin Room',
    'Deluxe Queen Room',
    'Deluxe Triple Room',
    'Deluxe Quadruple Room',
    'Comfort Quadruple Room',
    'Comfort Double Room with Small Window',
    'Deluxe Single Room',
  ]
}
```

2. Use the `hotelName` prop to select the correct category list in the dropdown.

### What This Fixes

After implementation and a PMS re-upload:
- Only rooms on night 3+ will show Towel Change (T) badge
- Rooms on night 1-2 will have NO T/RC badge
- Room 101 (night 3/4) and Room 404 (night 3/3) will correctly show T badge
- All other daily rooms (night 2) will show NO T badge
- Room categories will be correctly assigned per hotel
- The category dropdown will show hotel-specific options
