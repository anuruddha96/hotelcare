

## Plan: PMS Room Code Parsing, Room Type Mapping, Tooltip Fixes, and Cleaning Cycle Correction

### 1. Enhanced PMS Room Code Parser (`PMSUpload.tsx`)

The current `extractRoomType` function maps codes to generic types like `queen`, `twin`, `single`. This plan upgrades it to also:

- **Extract full room category** and store in `room_category` (e.g., "Deluxe Queen Room with Synagogue View")
- **Detect Shabath (SH) rooms** by checking for `SH` suffix in the PMS room code
- **Store PMS room name** in `room_name` column for reference

**PMS Code Mapping Table:**

| PMS Pattern | room_type | room_category | is_shabath |
|---|---|---|---|
| `SNG` | single | Deluxe Single Room | no |
| `ECDBL` | economy_double | Comfort Double Room with Small Window | no |
| `QUEEN` | queen | Deluxe Queen Room | check SH |
| `SYN.DOUBLE` | syn_double | Deluxe Double or Twin Room with Synagogue View | check SH |
| `SYN.TWIN` | syn_twin | Deluxe Double or Twin Room with Synagogue View | check SH |
| `DOUBLE` | double | Deluxe Double or Twin Room | check SH |
| `TWIN` | twin | Deluxe Double or Twin Room | check SH |
| `TRP` | triple | Deluxe Triple Room | check SH |
| `QDR` | quadruple | Deluxe Quadruple Room | no |
| `EC.QRP` | economy_quadruple | Comfort Quadruple Room | no |

**Shabath detection:** If the room code ends with `SH` (before the room number dash), set `bed_type` to `'shabath'` (repurposing existing column).

**Changes in `extractRoomType`:** Return an object `{ roomType, roomCategory, isShabath }` instead of just a string. Update the `updateData` to also write `room_category` and `bed_type` (for Shabath) and `room_name` (raw PMS room column value).

### 2. Add Shabath column to rooms table (Database)

The `bed_type` column already exists. We'll repurpose it: set to `'shabath'` for SH rooms, `null` otherwise. No schema migration needed.

### 3. Show Room Type Info in Hotel Room Overview (`HotelRoomOverview.tsx`)

- Fetch `room_type`, `bed_type`, `room_name` in addition to existing fields
- On room chips: show a small **SH** badge (blue) for Shabath rooms
- In tooltip: show room category, room type, and "Shabath Room" indicator
- Show guest nights (e.g., "Night 2/3") from `guest_nights_stayed` if available
- Show T/RC indicator in tooltip for towel/linen change rooms

### 4. Fix Hover Tooltips in Auto Room Assignment Preview (`AutoRoomAssignment.tsx`)

Currently the T, RC, wing badges use `title` attribute which only shows after a delay. Replace with proper Radix `Tooltip` components for consistent hover behavior across all abbreviations:

- **T** badge: tooltip "Towel Change"
- **RC** badge: tooltip "Room Cleaning"  
- **Wing letter** badge: tooltip "Wing X"
- **Size** badge (S/M/L/XL): tooltip with full size description
- **CO/D** (checkout/daily count): tooltip "Checkout / Daily rooms"

### 5. Fix Towel Change / Room Cleaning Algorithm (`PMSUpload.tsx`)

**Bug confirmed:** Room 032 shows `guest_nights_stayed: 2` and `towel_change_required: true` in DB -- this is stale data from a previous upload before the algorithm fix was deployed.

**Additional safeguard:** Add a batch reset of `towel_change_required` and `linen_change_required` to `false` for ALL hotel rooms before processing (same pattern as the DND batch reset at line 381-384). This ensures no stale T/RC flags persist from previous uploads.

**Algorithm verification (correct as implemented):**
- Night 1: nothing (correct)
- Night 2: nothing (correct)  
- Night 3: RC -- `(3-3)%6 = 0` (correct)
- Night 4: nothing -- `(4-3)%6 = 1` (correct)
- Night 5: T -- `(5-3)%6 = 2` (correct)
- Night 6: nothing -- `(6-3)%6 = 3` (correct)
- Night 7: T -- `(7-3)%6 = 4` (correct)
- Night 8: nothing -- `(8-3)%6 = 5` (correct)
- Night 9: RC -- `(9-3)%6 = 0` (correct)

The algorithm logic is correct. The issue is purely stale data.

### Files to modify

| File | Changes |
|---|---|
| `src/components/dashboard/PMSUpload.tsx` | Enhanced room code parser with category/shabath detection; batch reset T/RC flags; store room_name |
| `src/components/dashboard/HotelRoomOverview.tsx` | Fetch room_type/bed_type/room_name; show SH badge, T/RC indicators, guest nights in tooltip |
| `src/components/dashboard/AutoRoomAssignment.tsx` | Replace title attributes with Radix Tooltip components for T/RC/Wing/Size badges |

### Technical Details

**Enhanced room code parser:**
```typescript
const extractRoomInfo = (roomName: string): { roomType: string | null; roomCategory: string | null; isShabath: boolean } => {
  if (!roomName) return { roomType: null, roomCategory: null, isShabath: false };
  const upper = roomName.toUpperCase();
  const isShabath = upper.includes('SH') && /SH(?:\d|-|$)/.test(upper.replace(/[^A-Z0-9-]/g, ''));
  
  if (upper.includes('SYN.DOUBLE')) return { roomType: 'syn_double', roomCategory: 'Deluxe Double or Twin Room with Synagogue View', isShabath };
  if (upper.includes('SYN.TWIN')) return { roomType: 'syn_twin', roomCategory: 'Deluxe Double or Twin Room with Synagogue View', isShabath };
  if (upper.includes('EC.QRP')) return { roomType: 'economy_quadruple', roomCategory: 'Comfort Quadruple Room', isShabath };
  if (upper.includes('ECDBL')) return { roomType: 'economy_double', roomCategory: 'Comfort Double Room with Small Window', isShabath };
  if (upper.includes('QUEEN')) return { roomType: 'queen', roomCategory: 'Deluxe Queen Room', isShabath };
  if (upper.includes('DOUBLE')) return { roomType: 'double', roomCategory: 'Deluxe Double or Twin Room', isShabath };
  if (upper.includes('TWIN')) return { roomType: 'twin', roomCategory: 'Deluxe Double or Twin Room', isShabath };
  if (upper.includes('TRP')) return { roomType: 'triple', roomCategory: 'Deluxe Triple Room', isShabath };
  if (upper.includes('QDR')) return { roomType: 'quadruple', roomCategory: 'Deluxe Quadruple Room', isShabath };
  if (upper.includes('SNG')) return { roomType: 'single', roomCategory: 'Deluxe Single Room', isShabath };
  return { roomType: null, roomCategory: null, isShabath };
};
```

**Batch T/RC reset (add alongside DND reset):**
```typescript
await supabase
  .from('rooms')
  .update({ towel_change_required: false, linen_change_required: false })
  .eq('hotel', selectedHotel);
```

**Tooltip wrapper for badges in AutoRoomAssignment preview:**
```typescript
<TooltipProvider delayDuration={100}>
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="text-[9px] px-1 rounded font-bold bg-red-200 text-red-800">T</span>
    </TooltipTrigger>
    <TooltipContent side="top" className="text-xs">Towel Change</TooltipContent>
  </Tooltip>
</TooltipProvider>
```

