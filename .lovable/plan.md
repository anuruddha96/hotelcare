
## Plan: Fix All Dirty Linen Management Date Issues

### Root Cause Analysis

I found **three critical bugs** in the Dirty Linen Management feature that cause incorrect data display:

#### Bug 1: Timezone Mismatch in Date Filtering (SimplifiedDirtyLinenManagement.tsx)

**Problem:** When the user selects a date in the calendar, the code uses `toISOString()` which converts to UTC:

```typescript
// Line 61-62 in SimplifiedDirtyLinenManagement.tsx
const startDate = dateRange.from.toISOString().split('T')[0];
const endDate = (dateRange.to || dateRange.from).toISOString().split('T')[0];
```

**Impact:** If a user is in Central Europe (UTC+1) and selects "Jan 28" at 12:30 AM local time:
- Local time: Jan 28, 00:30
- UTC conversion: Jan 27, 23:30
- The query uses `2026-01-27` instead of `2026-01-28`

This explains why selecting Jan 28 sometimes shows Jan 27 data, and why data appears inconsistent depending on when the user checks.

#### Bug 2: Same Issue in Date Saving (DirtyLinenDialog.tsx)

**Problem:** When housekeepers save dirty linen data, the same UTC conversion issue occurs:

```typescript
// Line 84, 103, 207, 240 in DirtyLinenDialog.tsx
const today = new Date().toISOString().split('T')[0];
```

This causes records to potentially be saved with the wrong date if a housekeeper works early in the morning.

#### Bug 3: Same Issue in Cart Badge (DirtyLinenCartBadge.tsx)

**Problem:** The cart badge also uses the same incorrect date conversion:

```typescript
// Line 54 in DirtyLinenCartBadge.tsx
const today = new Date().toISOString().split('T')[0];
```

---

### Database Verification

The database shows Natali's data IS correctly stored for Jan 27:

| Work Date | Housekeeper | Total Items |
|-----------|-------------|-------------|
| 2026-01-27 | nam_023 | 59 |
| 2026-01-27 | Natali_050 | 46 |
| 2026-01-27 | Quang | 62 |
| 2026-01-26 | nam_023 | 73 |
| 2026-01-26 | Quang | 46 |

So the data exists - the bug is in how the frontend queries it.

---

### Solution: Use Local Date Formatting

Create a helper function that formats dates in local timezone (not UTC):

```typescript
// Helper function to get local date as YYYY-MM-DD
const getLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
```

---

### Files to Modify

#### 1. `src/components/dashboard/SimplifiedDirtyLinenManagement.tsx`

**Lines 61-62:** Fix date range conversion:

```typescript
// BEFORE (buggy):
const startDate = dateRange.from.toISOString().split('T')[0];
const endDate = (dateRange.to || dateRange.from).toISOString().split('T')[0];

// AFTER (fixed):
const getLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const startDate = getLocalDateString(dateRange.from);
const endDate = getLocalDateString(dateRange.to || dateRange.from);
```

**Lines 177-178:** Fix CSV export date conversion using the same helper.

#### 2. `src/components/dashboard/DirtyLinenDialog.tsx`

**Lines 84, 103, 207, 240:** Fix all occurrences of `new Date().toISOString().split('T')[0]`:

```typescript
// BEFORE (buggy):
const today = new Date().toISOString().split('T')[0];

// AFTER (fixed):
const getLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const today = getLocalDateString(new Date());
```

#### 3. `src/components/dashboard/DirtyLinenCartBadge.tsx`

**Line 54:** Fix date conversion:

```typescript
// BEFORE (buggy):
const today = new Date().toISOString().split('T')[0];

// AFTER (fixed):
const getLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const today = getLocalDateString(new Date());
```

#### 4. `src/components/dashboard/DirtyLinenManagement.tsx`

**Line 241:** Also uses `format(new Date(), 'yyyy-MM-dd')` from date-fns which should be timezone-aware, but we should verify consistency:

```typescript
// Line 241 - already uses date-fns format() which is locale-aware
if (recordToDelete.work_date !== format(new Date(), 'yyyy-MM-dd')) {
```

This is correct because `date-fns format()` uses local time. But we should make the other file consistent by potentially using `date-fns`.

---

### Optional Improvement: Create a Shared Utility

To prevent future bugs, we could create a shared utility in `src/lib/utils.ts`:

```typescript
/**
 * Get a date as YYYY-MM-DD string in local timezone
 * Use this instead of toISOString().split('T')[0] which converts to UTC
 */
export const getLocalDateString = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
```

Then import and use it across all components.

---

### Summary of Changes

| File | Lines | Fix |
|------|-------|-----|
| `SimplifiedDirtyLinenManagement.tsx` | 61-62, 177-178 | Replace `toISOString().split('T')[0]` with local date formatting |
| `DirtyLinenDialog.tsx` | 84, 103, 207, 240 | Replace `toISOString().split('T')[0]` with local date formatting |
| `DirtyLinenCartBadge.tsx` | 54 | Replace `toISOString().split('T')[0]` with local date formatting |
| `src/lib/utils.ts` | (new function) | Add `getLocalDateString()` helper |

---

### Expected Results After Fix

1. Selecting Jan 27 will show all 3 housekeepers (nam_023, Natali_050, Quang) with their correct totals
2. Selecting Jan 28 will show today's data (currently shows 3 housekeepers with 167 total)
3. Data will be consistent regardless of when the manager views it
4. Housekeepers saving linen data early in the morning will have correct work_date
