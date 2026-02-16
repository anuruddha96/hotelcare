

## Plan: Fix Hungarian PMS File Parsing for Hotel Memories Budapest

### Root Cause

The Hungarian PMS file uses **"Elutazas"** as the departure column header, but the column matcher only knows **"tavozas"**. Both are valid Hungarian words for "departure" but "Elutazas" is what Previo PMS uses. Since the Departure column is not detected, the warning toast fires and ALL rooms fall through to the wrong classification branch.

Additionally, the Status column contains values like `objectTidinessStatus.untidy` and `objectTidinessStatus.clean` (Previo's internal status format) rather than plain "Untidy"/"Clean", so the no-show and dirty-status checks also fail.

### Three fixes needed, all in one file

**File: `src/components/dashboard/PMSUpload.tsx`**

#### Fix 1: Add missing Hungarian column aliases (line 68-70)

Add `'elutazas'` and `'elutaz'` to the Departure matchers. The fuzzy matcher strips accents via normalization, but "elutazas" vs "tavozas" are entirely different words -- no amount of fuzzy matching helps here.

Also add `'vendeg'` to the People matchers (the file uses "Vendegek" = Guests).

Also add `'hozzarendelve'` / `'assigned'` patterns are not critical but won't hurt.

```
Departure: [...existing..., 'elutazás', 'elutazas', 'elutaz']
People: [...existing..., 'vendégek', 'vendeg', 'guest']
```

#### Fix 2: Handle Previo status format (lines 575, 580)

The Status column values from Previo are `objectTidinessStatus.untidy` and `objectTidinessStatus.clean`, not plain "Untidy"/"Clean". Update all status checks to use `.includes('untidy')` / `.includes('clean')` instead of exact string comparison.

Change:
```typescript
// Line 575: No-show check
String(statusVal) === 'Untidy' || String(statusVal) === 'untidy'
// Line 580: Dirty check
['Untidy', 'untidy', 'dirty'].includes(String(statusVal))
```
To:
```typescript
// Line 575: No-show check
String(statusVal).toLowerCase().includes('untidy')
// Line 580: Dirty check
const statusLower = String(statusVal).toLowerCase();
statusLower.includes('untidy') || statusLower.includes('dirty')
```

#### Fix 3: Remove the Departure warning toast (line 343-345)

The user explicitly asked to hide this toast. Remove or convert to a `console.warn` only, not a visible toast.

### Expected Results After Fix

From analyzing today's PMS file for Hotel Memories Budapest:

| Category | Count | Rooms |
|----------|-------|-------|
| Checkout (with departure time) | 30 | 306, 308, 008, 032, 040, 042, 112, 204, 206, 208, 210, 034, 036, 044, 130, 214, 131, 137, 139, 143, 103, 123, 125, 201, 203, 205, 121, 006, 212, 217 |
| Early Checkout (last night, no departure) | 21 | 004, 102, 132, 140, 106, 108, 110, 134, 136, 145, 147, 109, 107, 111, 117, 115, 207, 138, 209, 213, 038 |
| Daily Cleaning (occupied, not last night) | 20 | 002, 010, 142, 302, 304, 104, 144, 202, 133, 135, 141, 101, 105, 113, 119, 127, 211, 215, 114, 216 |

Total: 71 rooms processed.

### Safety: Hotel Ottofiori

- Ottofiori PMS files use English headers ("Room", "Departure", "Occupied") which already match
- Ottofiori Status values are plain "Untidy"/"Clean" -- `.includes('untidy')` still matches these correctly
- Adding new Hungarian aliases does not remove any existing English ones
- No structural changes to the processing logic

