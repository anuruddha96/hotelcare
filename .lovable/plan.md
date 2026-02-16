

## Plan: Fix PMS Checkout Detection for Hotel Memories Budapest, Add Room Types, Remove General Tasks

### Issue 1: 3 Missing Checkouts - No-Show Misclassification

**Root cause:** At line 531 in `PMSUpload.tsx`, inside the `departureParsed !== null` block, a room is flagged as "No Show" if `Occupied=No + Status=Untidy + Arrival exists`. But for Hotel Memories Budapest, **every checkout room** has these properties:
- `Occupied = No` (guest left)
- `Status = Untidy` (room needs cleaning)
- `Arrival = 14:30` (original arrival time)

This means many normal checkouts get incorrectly tagged as "No Show". A **true No Show** should only be identified when there is NO departure time (guest never arrived, never left).

**Fix:** Remove the no-show detection from inside the `departureParsed !== null` block entirely. A room WITH a departure time, by definition, had a guest who departed -- it cannot be a no-show. The existing no-show detection at line 580 (outside the departure block, for rooms without departure time) already handles true no-shows correctly.

**File:** `src/components/dashboard/PMSUpload.tsx` (lines 530-534)
- Remove the `isNoShow` check inside the departure block
- All 30 rooms with departure times will now correctly be classified as regular checkouts or early checkouts

---

### Issue 2: Room Types for Hotel Memories Budapest

**Current state:** All 71 rooms have `room_type = 'deluxe'` in the database.

**PMS file analysis reveals these room types** (extracted from the Room column format):

| PMS Pattern | Room Type | Example | Room Numbers |
|------------|-----------|---------|-------------|
| `SNG` | Single | 70SNG-306 | 306 |
| `ECDBL` | Economy Double | 71ECDBL-308 | 308 |
| `QUEEN` / `QUEEN-xxxSH` | Queen / Queen Shower | 1QUEEN-002, 4QUEEN-008SH | 002,004,008,010,032,040,042,102,112,132,140,142,204,206,208,210,302,304 |
| `TWIN` / `TWIN-xxxSH` | Twin / Twin Shower | 7TWIN-034SH, 8TWIN-036 | 034,036,044,106,108,110,130,131,136,137,144,202,214 |
| `DOUBLE` | Double | 16DOUBLE-104 | 104,134,135,139,141,143,145 |
| `SYN.TWIN` / `SYN.TWIN-xxxSH` | Superior Twin / Superior Twin Shower | 13SYN.TWIN-101 | 101,109,115,119,123,125,127,201,203,205,207,215 |
| `SYN.DOUBLE` / `SYN.DOUBLE-xxxSH` | Superior Double | 15SYN.DOUBLE-103 | 103,107,111,113,117 |
| `TRP` / `TRP-xxxSH` | Triple / Triple Shower | 3TRP-006, 59TRP-209SH | 006,121,138,209,211,212,213,217 |
| `EC.QRP` | Economy Quadruple | 66EC.QRP216 | 216 |
| `QDR` | Quadruple | 9QDR-038 | 038,114 |

**Fix:** Add an `extractRoomType` function that parses the room type from the PMS Room column. During PMS upload, update each room's `room_type` field in the database. This only affects rooms being processed -- Hotel Ottofiori uses different Room column formats (e.g., "CQ-405") and already has correct room types.

**File:** `src/components/dashboard/PMSUpload.tsx`
- Add `extractRoomType(roomName: string): string` function
- In the room update block (~line 601), include `room_type: extractedType` in the update data

---

### Issue 3: Remove General Tasks Tab

The "Public Area" section in Team Management now covers general task functionality, making the General Tasks tab redundant.

**File:** `src/components/dashboard/HousekeepingTab.tsx`
- Remove `import { GeneralTasksManagement }` (line 23)
- Remove `'general-tasks'` from `TAB_CONFIGS` (line 48)
- Remove `'general-tasks'` from `getTabOrder()` default array (line 156)
- Remove the `TabsContent value="general-tasks"` block (lines 296-298)

**File:** `src/components/dashboard/TabOrderManagement.tsx`
- Remove `'general-tasks'` entry from the default tabs list (line 27)

No files are deleted -- `GeneralTasksManagement.tsx` stays in the codebase but is simply no longer rendered or imported.

---

### Summary of Changes

| File | Changes |
|------|---------|
| `src/components/dashboard/PMSUpload.tsx` | Remove incorrect no-show detection inside departure block; add `extractRoomType` function; update room_type during PMS upload |
| `src/components/dashboard/HousekeepingTab.tsx` | Remove General Tasks tab, import, and content |
| `src/components/dashboard/TabOrderManagement.tsx` | Remove general-tasks from default tab order |

### Safety: Hotel Ottofiori

- Hotel Ottofiori uses `CQ-xxx`, `Q-xxx`, `DB/TW-xxx` patterns which don't match any of the new Hotel Memories patterns
- The `extractRoomType` function only updates `room_type` based on what's in the PMS file -- Ottofiori files will produce their own correct types
- The no-show fix is universal but correct: a room with a departure time is never a no-show, regardless of hotel
- General Tasks removal applies to all hotels as requested

