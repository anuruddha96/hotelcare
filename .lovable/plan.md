

## Plan: Fix Notification Overlaps, Reception Access, and Room Notes

### 1. Fix Notification Overlaps

**Root cause**: Two systems subscribe to the same realtime events simultaneously:
- `RealtimeNotificationProvider.tsx` subscribes to `room_assignments` UPDATE events and shows hardcoded English messages like "Assignment status changed to in_progress"
- `useNotifications.tsx` hook subscribes to the **same** `room_assignments` events via its own channel
- Both call `showNotification()` which triggers sonner toast + `visual-notification` custom event
- `EnhancedNotificationOverlay` listens to `visual-notification` events (a third display)
- `VisualNotificationOverlay` is rendered in Dashboard (a fourth display)

**Fix in `RealtimeNotificationProvider.tsx`**: Remove the duplicate `room_assignments` UPDATE listener (lines 38-53) since `useNotifications.tsx` already handles the same events with proper translations. Keep only the manager-specific channels (break requests, supervisor approvals, maintenance approvals) that aren't duplicated in `useNotifications`.

**Fix in `useNotifications.tsx`**: Translate the assignment status change messages. Currently `RealtimeNotificationProvider` sends "Assignment status changed to ${status}" in English. The `useNotifications` hook already uses `t()` for new assignments but the status-update listener in `RealtimeNotificationProvider` does not. After removing the duplicate, no change needed here since `useNotifications` doesn't have a status-update handler for the housekeeper's own assignments — we need to **add one** in `useNotifications.tsx` with proper `t()` translations.

**Fix in `EnhancedNotificationOverlay.tsx`**: Remove or stop rendering this component — it creates a parallel notification display that overlaps with sonner toasts. The `visual-notification` custom event dispatch in `useNotifications.tsx` (line 284) should also be removed since sonner handles the in-app display.

**Fix in `Dashboard.tsx`**: Remove `VisualNotificationOverlay` rendering since sonner toasts handle everything.

### 2. Add Translated Notification Messages

**File: `src/hooks/useTranslation.tsx`** — Add new translation keys:
- `notifications.assignmentStarted` — "Your room assignment has started" (en) / "A szoba-hozzárendelése elkezdődött" (hu) / etc.
- `notifications.assignmentCompleted` — "Room assignment completed" (en) / etc.  
- `notifications.assignmentStatusChanged` — "Assignment status changed to {status}" with translated status values
- `notifications.statusInProgress` / `notifications.statusCompleted` / `notifications.statusAssigned`

Add these to all 5 language blocks (en, hu, es, vi, mn).

### 3. Reception Role Access to Room Chip Dialog

**File: `src/components/dashboard/HotelRoomOverview.tsx`**

- Line 142: Create `const canInteractWithRooms = isManagerOrAdmin || isReception;`
- Line 210: Change `if (!isManagerOrAdmin) return;` → `if (!canInteractWithRooms) return;`
- Line 327: Change cursor style to use `canInteractWithRooms`
- Line 337: Change hover style to use `canInteractWithRooms`
- Line 413: Change tooltip text to use `canInteractWithRooms`
- Line 607: Change `onRoomClick` to use `canInteractWithRooms`
- In the dialog: Reception gets **Ready to Clean** and **status toggle** (Mark Dirty/Clean) but NOT room settings (size/category). Gate the Room Settings section behind `isManagerOrAdmin`.

### 4. Add Notes/Special Instructions Text Field to Room Chip Dialog

**File: `src/components/dashboard/HotelRoomOverview.tsx`**

- Add state: `const [roomNotes, setRoomNotes] = useState('')`
- In `handleRoomClick`, set `setRoomNotes(room.notes || '')`
- Add a new section in the dialog between Special Instructions and Quick Actions:
  - Label: "Manager Notes"
  - `<Textarea>` bound to `roomNotes`
  - Save button that updates `rooms.notes` via Supabase
  - Only shown for managers/admins (not reception)
- The `rooms.notes` column already exists in the DB

**File: `src/components/dashboard/AssignedRoomCard.tsx`** — Already displays `assignment.notes`. We need to also fetch and display `rooms.notes` (the room-level notes from managers). Check if the rooms query in the housekeeper view includes `notes`:
- The `AssignedRoomCard` receives `assignment.rooms` which currently doesn't include `notes` — need to add it to the rooms select in the parent component and display it prominently for housekeepers.

**File: `src/components/dashboard/HousekeepingStaffView.tsx`** — Add `notes` to the rooms select query so it's passed to `AssignedRoomCard`.

### Summary of Files Changed

| File | Changes |
|------|---------|
| `RealtimeNotificationProvider.tsx` | Remove duplicate room_assignments UPDATE listener, translate remaining hardcoded strings |
| `useNotifications.tsx` | Add translated assignment status change handler, remove `visual-notification` dispatch |
| `EnhancedNotificationOverlay.tsx` | Delete or empty out |
| `Dashboard.tsx` | Remove VisualNotificationOverlay import and rendering |
| `useTranslation.tsx` | Add notification translation keys for all 5 languages |
| `HotelRoomOverview.tsx` | Grant reception room chip access, add notes textarea, gate settings behind manager role |
| `HousekeepingStaffView.tsx` | Add room `notes` to select query |
| `AssignedRoomCard.tsx` | Display room-level manager notes for housekeepers |

