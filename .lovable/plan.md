

## Plan: Fix QR Downloads, Nav UI, Minibar Item Management, and Notification Count

This plan addresses 4 separate issues reported by the user.

---

### Issue 1: QR Code Download Shows "No rooms found"

**Root Cause**: The `MinibarQRManagement` component filters rooms with `.eq('hotel', profile.assigned_hotel)`. For the current manager, `profile.assigned_hotel = 'memories-budapest'`, but rooms in the database have `hotel = 'Hotel Memories Budapest'`. This mismatch returns zero rooms.

**Fix**: In `MinibarQRManagement.tsx`, resolve the hotel display name from `hotel_configurations` (same pattern used in the dirty linen fix), and filter rooms using both the short ID and the full name.

| File | Change |
|------|--------|
| `src/components/dashboard/MinibarQRManagement.tsx` | In `fetchRooms()`, look up `hotel_name` from `hotel_configurations` using `profile.assigned_hotel`, then filter rooms with `.or('hotel.eq.X,hotel.eq.Y')` using both values |

---

### Issue 2: Navigation Tab UI - "Housekeeping" Text Overflow

**Root Cause**: The manager/admin tab list uses `grid-cols-5` (for Tickets, Rooms, Housekeeping, Attendance, Admin) inside a `max-w-lg` container. "Housekeeping" is a long word that overflows its column.

**Fix**: Widen the container and add text truncation. Also improve visual styling so the active tab is more prominent.

| File | Change |
|------|--------|
| `src/components/dashboard/Dashboard.tsx` | For the manager TabsList (line 396): increase `max-w-lg` to `max-w-2xl`, and add `truncate` class to tab label spans. For managers without admin, use `grid-cols-4`. Add better active-state styling. |

---

### Issue 3: No Option to Create Minibar Items on Tracking Page

**Root Cause**: The `MinimBarManagement` component (which allows creating/editing minibar items) is only accessible from `RoomManagement`, not from `MinibarTrackingView`. Managers on the Minibar Tracking page have no way to add new items.

**Fix**: Add a "Manage Items" button to the `MinibarTrackingView` header (visible to admin/manager roles) that opens the existing `MinimBarManagement` dialog.

| File | Change |
|------|--------|
| `src/components/dashboard/MinibarTrackingView.tsx` | Import and add `MinimBarManagement` dialog. Add a "Manage Items" button next to the existing buttons (visible to admin/manager/housekeeping_manager). |

---

### Issue 4: Pending Approval Red Badge Not Showing for Hotel Memories Budapest

**Root Cause**: In `usePendingApprovals.tsx` line 51, the query filters with `.eq('rooms.hotel', userHotel)`. The manager at Hotel Memories Budapest has `assigned_hotel = 'memories-budapest'` but rooms have `hotel = 'Hotel Memories Budapest'`. Same hotel name mismatch as all other issues.

**Fix**: Resolve the hotel display name from `hotel_configurations` before filtering, then use an OR condition to match both the short ID and full name.

| File | Change |
|------|--------|
| `src/hooks/usePendingApprovals.tsx` | After getting `userHotel`, query `hotel_configurations` to get `hotel_name`. Use `.or()` filter with both values for `rooms.hotel` and `tickets.hotel`. |

---

### Notification Sound Enhancement

The current notification sound is a basic 523Hz sine wave generated programmatically. We will improve it with a richer, more pleasant two-tone chime (C5 + E5) with harmonics for a more modern, recognizable sound.

| File | Change |
|------|--------|
| `src/hooks/useNotifications.tsx` | Update `playNotificationSound` to generate a richer two-tone chime using Web Audio API with harmonics (fundamental + overtones) for a more distinctive, pleasant alert sound. |

---

### Summary of All File Changes

| File | Issues Addressed |
|------|-----------------|
| `src/components/dashboard/MinibarQRManagement.tsx` | QR download fix (hotel name resolution) |
| `src/components/dashboard/Dashboard.tsx` | Navigation tab UI improvements |
| `src/components/dashboard/MinibarTrackingView.tsx` | Add "Manage Items" button |
| `src/hooks/usePendingApprovals.tsx` | Pending approval count fix (hotel name resolution) |
| `src/hooks/useNotifications.tsx` | Improved notification sound |

