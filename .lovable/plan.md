
## Plan: Fix Checkout Room Detection in PMS Upload

### Root Cause Analysis

After examining the database records, I found:
- The latest upload (06:56 today) processed 21 rooms but detected 0 checkouts and 0 status updates
- A previous upload DID detect 7 checkout rooms (405, 202, 203, 303, 304, 204, 305) successfully
- All 21 rooms are currently marked as daily cleaning only

The issue has **three contributing causes**:

**1. Excel time values parsed as numbers**: When `xlsx` reads time cells (like "11:00"), it can return them as decimal numbers (e.g., `0.458333`) instead of formatted strings. The current check `departureVal && String(departureVal).trim() !== ''` would work for most numbers, but `0` (midnight) would fail because `0` is falsy in JavaScript.

**2. No re-detection on re-upload**: On line 558, the code skips the update if `currentStatus === newStatus AND is_checkout_room === isCheckout`. After the first upload sets rooms to `dirty` with `is_checkout_room: false`, a second upload with the same (or corrected) data finds no changes and skips ALL updates. This means even if departure data exists, rooms won't be reclassified on subsequent uploads.

**3. Occupied value comparison too strict**: The check `String(occupiedVal) === 'Yes'` is case-sensitive. Hungarian PMS might use "Igen", Czech might use "Ano", or it could just be lowercase "yes" or boolean `true`.

### Changes

**File: `src/components/dashboard/PMSUpload.tsx`**

**A. Fix Excel time value handling:**
- Convert Excel serial time numbers to readable time strings (e.g., `0.458333` becomes `"11:00"`)
- Add a helper function `normalizeTimeValue(val)` that handles both string times and numeric serial values
- Use `!== undefined && !== null` instead of truthiness check for departure values

**B. Always update room data on PMS upload (remove skip condition):**
- Remove the `if (currentStatus !== newStatus || room.is_checkout_room !== isCheckout)` guard on line 558
- Always apply the update so that re-uploads correctly reclassify rooms (checkout vs daily)
- This ensures a second upload with correct data fixes any previous misclassification

**C. Make Occupied check case-insensitive:**
- Replace `String(occupiedVal) === 'Yes'` with a normalized comparison that handles: 'yes', 'Yes', 'YES', 'Igen', 'Ano', 'true', boolean true
- Replace `String(occupiedVal) === 'No'` with similar normalization

**D. Save hotel_filter in upload summary:**
- Add `hotel_filter: selectedHotel` to the summary insert (line 604-611) so the history shows which hotel was uploaded

**E. Add diagnostic toast for column mapping:**
- After building the column map, show a brief info toast listing which columns were detected (especially Departure)
- If Departure column is not found, show a warning toast so the user knows checkout detection won't work

### Technical Details

```text
// Helper: convert Excel serial time to HH:MM string
function excelTimeToString(val: any): string | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') {
    // Excel serial time: 0.458333 = 11:00
    const totalMinutes = Math.round(val * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
  const str = String(val).trim();
  return str === '' ? null : str;
}

// Helper: normalize yes/no values
function isOccupiedYes(val: any): boolean {
  if (val === true) return true;
  const s = String(val).trim().toLowerCase();
  return ['yes', 'igen', 'ano', 'si', 'ja', 'true', '1'].includes(s);
}

function isOccupiedNo(val: any): boolean {
  if (val === false) return true;
  const s = String(val).trim().toLowerCase();
  return ['no', 'nem', 'ne', 'nein', 'false', '0'].includes(s);
}
```

**Line 466 change:**
```text
// OLD:
if (departureVal && String(departureVal).trim() !== '') {

// NEW:
const departureParsed = excelTimeToString(departureVal);
if (departureParsed !== null) {
```

**Line 493 change:**
```text
// OLD:
} else if (String(occupiedVal) === 'Yes' && !departureVal) {

// NEW:
} else if (isOccupiedYes(occupiedVal) && departureParsed === null) {
```

**Line 558 change:**
```text
// OLD: skip if no change
if (currentStatus !== newStatus || room.is_checkout_room !== isCheckout) {
  // update...
} else if (room.is_dnd) { ... }

// NEW: always update on PMS upload
const { error: updateError } = await supabase
  .from('rooms')
  .update(updateData)
  .eq('id', room.id);
if (!updateError) {
  processed.updated++;
}
```

### Summary

| Change | Purpose |
|--------|---------|
| `excelTimeToString()` helper | Handle Excel numeric time values (0.458 to "11:00") |
| `isOccupiedYes/No()` helpers | Case-insensitive, multi-language occupied status matching |
| Remove update skip condition | Ensure re-uploads always reclassify rooms correctly |
| Save `hotel_filter` in summary | Track which hotel each upload was for |
| Diagnostic column mapping toast | Alert users when critical columns (Departure) aren't detected |
