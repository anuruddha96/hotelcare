

## Plan: Fix Approval List Realtime, Checkout Ready-to-Clean, Minibar Translations, and Footer UI

---

### 1. Instant Approval List Clearing (Realtime Fix)

**Root Cause**: After approving a room, `handleApproval` in `SupervisorApprovalView.tsx` calls `fetchPendingAssignments()` which makes a full database round-trip. The list stays visible until the refetch completes. The `usePendingApprovals` hook badge count also waits for a Realtime event before updating.

**Fix**:
- In `SupervisorApprovalView.tsx`: Immediately remove the approved assignment from `pendingAssignments` state (optimistic update) before the DB call finishes. Same for maintenance tickets.
- In `usePendingApprovals.tsx`: After the Realtime event fires, add a small debounce and also expose a manual `refetch` function so the approval view can force an immediate count update after approving.

| File | Change |
|------|--------|
| `src/components/dashboard/SupervisorApprovalView.tsx` | Add optimistic state removal: `setPendingAssignments(prev => prev.filter(a => a.id !== assignmentId))` immediately when approval starts. Same for maintenance tickets. |
| `src/hooks/usePendingApprovals.tsx` | Export a `refetch` function so consumers can trigger an immediate count update. |

---

### 2. Fix "Mark as Ready to Clean" for Checkout Rooms

**Root Cause**: Two issues found in `HotelRoomOverview.tsx`:

1. **`ready_to_clean` not fetched**: The assignment query (line 158) selects `room_id, assigned_to, status, assignment_type, started_at, supervisor_approved` but does NOT include `ready_to_clean`. So even if the update succeeds, the UI never shows it.

2. **No visual indicator**: There is no color or badge in `renderRoomChip` showing that a checkout room has been marked as "ready to clean". Managers can't tell which rooms are already marked.

3. **Button condition too restrictive**: The "Mark as Ready to Clean" button (line 590) requires `assignment.status !== 'completed'`. If the assignment is already completed (cleaned), the button is hidden. But what about rooms with no assignment at all? They also can't be marked.

**Fix**:
- Add `ready_to_clean` to the assignment select query and the `AssignmentData` interface.
- Add a visual indicator in `renderRoomChip` for checkout rooms that are marked ready (e.g., a green checkmark or "RTC" badge).
- Show the "Mark as Ready to Clean" button for checkout rooms even when there's no assignment, by creating an assignment with `ready_to_clean: true` if none exists.
- After marking ready, show the updated state immediately in the room chip.

| File | Change |
|------|--------|
| `src/components/dashboard/HotelRoomOverview.tsx` | Add `ready_to_clean` to assignment select and interface. Add "RTC" visual badge for ready checkout rooms. Fix button logic to handle rooms without assignments. Update local state optimistically after marking ready. |

---

### 3. Fix Minibar Guest Page Product Translations

**Root Cause**: Product item names (e.g., "Coca-Cola", "Brownie") come directly from the `minibar_items.name` database column, which is a single string -- not translatable. The `gt()` function only translates UI chrome strings, not product data. When guests switch languages, the UI labels translate but product names stay in the original language.

**Fix**: Add a `translations` JSONB column to `minibar_items` to store translated names per language. Example: `{"de": "Schokoladenkuchen", "hu": "Brownie torta"}`. In `GuestMinibar.tsx`, when rendering product names, check `item.translations?.[guestLang]` first, falling back to `item.name`.

| File | Change |
|------|--------|
| New database migration | `ALTER TABLE minibar_items ADD COLUMN translations jsonb DEFAULT '{}'::jsonb;` |
| `src/pages/GuestMinibar.tsx` | Update `renderWoltItem` to use `item.translations?.[guestLang] || item.name` for the product name display. Update `MinibarItem` interface to include `translations`. Update the data fetch to select the `translations` column. |

Note: Admins will need to populate translations for each item via the admin panel. The column defaults to empty `{}` so existing items display their original name until translations are added.

---

### 4. Fix Footer Empty Space and Logo Size

**Root Cause**: In `GuestMinibar.tsx` line 501, the footer logo uses `h-7` (28px) which is too small. There's also unnecessary vertical spacing creating empty gaps.

**Fix**:
- Increase footer logo from `h-7` to `h-12` (48px).
- Reduce excess padding/margin in the footer section.
- Remove the `opacity-40` on the logo to make it more visible.

| File | Change |
|------|--------|
| `src/pages/GuestMinibar.tsx` | Footer section: change logo `h-7` to `h-12`, remove `opacity-40`, adjust spacing. |

---

### Technical Details

**Optimistic approval removal:**
```typescript
const handleApproval = async (assignmentId: string) => {
  // Immediately remove from UI
  setPendingAssignments(prev => prev.filter(a => a.id !== assignmentId));
  
  try {
    // ... existing DB update code ...
    // Still refetch to ensure consistency
    fetchPendingAssignments();
  } catch (error) {
    // Re-add on error
    fetchPendingAssignments();
    toast.error('Failed to update approval status');
  }
};
```

**Ready-to-clean assignment data fix:**
```typescript
// Add to select
.select('room_id, assigned_to, status, assignment_type, started_at, supervisor_approved, ready_to_clean')

// Add to interface
interface AssignmentData {
  // ... existing fields ...
  ready_to_clean: boolean | null;
}

// Visual indicator in renderRoomChip
{isCheckout && assignment?.ready_to_clean && (
  <span className="ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-green-600 text-white">RTC</span>
)}
```

**Product translation in GuestMinibar:**
```typescript
interface MinibarItem {
  // ... existing fields ...
  translations?: Record<string, string> | null;
}

// In renderWoltItem:
const displayName = (item as any).translations?.[guestLang] || item.name;
```

**Footer fix:**
```tsx
{logoUrl && (
  <img src={logoUrl} alt={branding?.hotel_name} className="h-12 w-auto object-contain opacity-60" />
)}
```

---

### Summary of All Changes

| Area | Changes |
|------|---------|
| `src/components/dashboard/SupervisorApprovalView.tsx` | Optimistic removal of approved items from state for instant UI clearing |
| `src/hooks/usePendingApprovals.tsx` | Expose `refetch` function for manual count updates |
| `src/components/dashboard/HotelRoomOverview.tsx` | Add `ready_to_clean` to data fetch and interface, add RTC visual badge, fix Mark Ready button for rooms without assignments |
| New database migration | Add `translations` JSONB column to `minibar_items` table |
| `src/pages/GuestMinibar.tsx` | Use translated product names, fix footer logo size and spacing |

