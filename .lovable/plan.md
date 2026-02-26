

## Plan: Enhanced Room Chip Dialog with Quick Actions

### Current State
The room chip click opens a dialog with: Mark Ready to Clean, Switch Daily/Checkout, Room Size, and Room Category. No way to toggle towel/linen change or change room status (clean↔dirty).

### Changes — Single File: `src/components/dashboard/HotelRoomOverview.tsx`

**1. Add new quick actions to the room edit dialog (lines 634-731):**

- **Toggle Towel Change**: Button that sets `rooms.towel_change_required = true/false`. Shows current state (✅ if active). Updates DB + optimistic local state.
- **Toggle Linen Change**: Same pattern for `rooms.linen_change_required = true/false`.
- **Set Room Status — Clean → Dirty**: If room status is `clean`, show button "Mark as Dirty". Updates `rooms.status = 'dirty'`.
- **Set Room Status — Dirty → In Progress**: If room has an assignment with status `assigned`, show button "Start Cleaning" that updates assignment status to `in_progress`.
- **Set Room Status — Clean Room to Dirty**: Updates `rooms.status = 'dirty'` on the rooms table.

All actions: update DB → optimistic local state update → close dialog → refetch.

**2. Reorganize dialog layout for usability:**

- Group actions into labeled sections: "Room Status", "Special Instructions", "Room Settings"
- Use colored toggle-style buttons for towel/linen (red when active, outline when inactive)
- Keep room size/category in a collapsible or lower section since they're used less frequently

**3. Housekeeper visibility (already works):**

The `towel_change_required` and `linen_change_required` fields are on the `rooms` table and already displayed in:
- `AssignedRoomCard.tsx` — shows badges to housekeepers
- `HotelRoomOverview.tsx` room chips — shows T and RC badges
- Tooltip on room chips — shows text descriptions

No additional changes needed for housekeeper visibility — toggling these fields from the dialog will automatically reflect everywhere.

### Implementation Details

```
Dialog Layout:
┌─────────────────────────────────┐
│ Room 302 (Wing D)               │
├─────────────────────────────────┤
│ Room Status                     │
│ [Mark as Dirty] [Mark as Clean] │
├─────────────────────────────────┤
│ Special Instructions            │
│ [🔄 Towel Change: ON/OFF]      │
│ [🛏️ Linen Change: ON/OFF]      │
├─────────────────────────────────┤
│ Quick Actions                   │
│ [Ready to Clean] [Switch Type]  │
├─────────────────────────────────┤
│ Room Settings                   │
│ Size: [S/M/L/XL]               │
│ Category: [dropdown]            │
│            [Cancel] [Save]      │
└─────────────────────────────────┘
```

All DB updates use existing `supabase.from('rooms').update(...)` and `supabase.from('room_assignments').update(...)` patterns already in the file.

