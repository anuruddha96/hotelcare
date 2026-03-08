

## Status: Most "Pending" Features Are Already Implemented

After auditing the codebase, the 4 main pipeline items are **complete**:

1. **Towel Change Toggle** -- Implemented in `AutoRoomAssignment.tsx` (collapsible pre-assignment section, lines 761-818)
2. **Custom Bed Configuration** -- DB column exists, displayed in room chips and AssignedRoomCard banners
3. **Room Priority/Sorting** -- Unified bucket sorting in HousekeepingStaffView, MobileHousekeepingView, and PendingRoomsDialog
4. **Special Instructions Visibility** -- Prominent color-coded banners (yellow/purple/blue/amber) in AssignedRoomCard

The only remaining enhancement is **Supervisor Approval Card Improvements**:

### What to Improve: Supervisor Approval Cards

Currently, the supervisor approval card (`SupervisorApprovalView.tsx` `renderAssignmentCard`) shows room info, timing, notes, and a `CompletionDataView` component that fetches and displays detailed data. However:

- **Photo thumbnails** are hidden inside CompletionDataView -- supervisors must expand to see them
- **Dirty linen summary** is also nested inside CompletionDataView
- **DND indicator** is not shown on the approval card
- **Bed configuration** is not fetched or shown

### Plan

**File: `src/components/dashboard/SupervisorApprovalView.tsx`**

1. **Add `bed_configuration`, `is_dnd`, `dnd_marked_at`** to the rooms query (line 363-371)
2. **Add DND badge** on the approval card header when `rooms.is_dnd` is true
3. **Add bed configuration badge** in the special requirements section (alongside towel/linen)
4. **Add inline photo thumbnail strip** -- fetch `completion_photos` from the assignment data (already in the query via `*`) and render 3-4 small thumbnail previews directly on the card, above the CompletionDataView expand
5. **Add inline dirty linen summary line** -- fetch dirty linen counts for the room/date and show a one-line summary (e.g., "Towels: 4, Sheets: 2, Pillowcases: 3") directly on the card

**Queries to add:**
- Dirty linen counts: join `dirty_linen_counts` with `dirty_linen_items` for each assignment's room_id + work_date
- Completion photos: already available via `*` select on room_assignments

**UI changes to the card:**
- After the 4-column grid (Cleaned by / Started / Completed / Duration), add:
  - A photo thumbnail row (small 48x48 rounded images, max 4, with "+N more" badge)
  - A dirty linen summary row (compact badges showing item counts)
  - DND badge in header if applicable
  - Bed configuration in the special requirements section

### Files Changed

| File | Changes |
|------|---------|
| `SupervisorApprovalView.tsx` | Add fields to query, add DND/bed config badges, inline photo thumbnails, dirty linen summary |

This is a single-file change with no database migrations needed.

