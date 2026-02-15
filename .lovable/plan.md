

## Plan: Fix PMS Checkout Detection - Root Cause Found

### Root Cause

The bug is on **line 317** of `PMSUpload.tsx`:

```typescript
const jsonData: PMSData[] = XLSX.utils.sheet_to_json(worksheet);
```

With default options (`raw: true`), SheetJS **skips empty cells** -- they are simply not included as keys in the row objects. The column map is built from `Object.keys(firstRow)` (line 326), but if the **first data row** has an empty cell in a column (like "Departure"), that column key is completely missing from the first row object.

In today's file, the first row is **CQ-405** which has **no departure time**. So `Object.keys(firstRow)` returns: `["Room", "Occupied", "Guests", "Night / Total", "Status"]` -- missing "Departure", "Arrival", "Note", "Nationality", "Defect", and "Assigned".

Since "Departure" is never in the column map, `getField(row, columnMap, 'Departure')` returns `undefined` for ALL rows, and `departureParsed` is always `null`. Every room falls into the `daily_cleaning` branch.

Previous uploads that worked had a first row WITH a departure value, so the key was present.

### Fix

**File: `src/components/dashboard/PMSUpload.tsx`** -- one-line change on line 317:

```
// BEFORE:
const jsonData: PMSData[] = XLSX.utils.sheet_to_json(worksheet);

// AFTER:
const jsonData: PMSData[] = XLSX.utils.sheet_to_json(worksheet, { defval: null });
```

The `defval: null` option tells SheetJS to include ALL columns in every row object, using `null` as the value for empty cells. This ensures `Object.keys(firstRow)` always contains every column header (Room, Occupied, Departure, Arrival, etc.), regardless of whether the first row has data in those cells.

`excelTimeToString(null)` already returns `null` correctly, so empty departure cells continue to work as expected.

### After Fix

The app must be **Published** for this to take effect on the live site. Then re-upload the PMS file -- the 11 checkout rooms should be correctly identified.

