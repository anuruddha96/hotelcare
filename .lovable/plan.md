

## Plan: Fix 5 Issues - No-Show vs Early Checkout, Notifications, ACT Tooltip, PMS Toast

### Issue 1: Remove PMS Column Mapping Notification Toast

The info toast showing "Columns detected: Room->Room, Occupied->Occupied, Departure->Departure..." is unnecessary for users and clutters the UI.

**File: `src/components/dashboard/PMSUpload.tsx` (~line 350)**
- Remove the `toast.info(Columns detected: ...)` call entirely
- Keep only the warning toast when a critical column (Room) is missing

---

### Issue 2: Separate Early Checkout from No Show

**Problem:** Rooms 105 (Night 3/3) and 406 (Night 3/3) are on their last night, meaning they check out TODAY. But since they have no Departure time value in the PMS file, the code classifies them as "daily cleaning" instead. Additionally, the current "No Show / Early Checkout" label conflates two distinct concepts.

**Definitions:**
- **No Show**: Guest never arrived -- Occupied=No, Status=Untidy, has Arrival date
- **Early Checkout**: Guest's last night (Night/Total = x/x where x equals total) -- they leave today but PMS hasn't set a departure time yet

**Changes in `src/components/dashboard/PMSUpload.tsx`:**
1. Add a new `isEarlyCheckout` flag (separate from `isNoShow`)
2. In the Night/Total parsing section (~line 499), detect when `guestNightsStayed === totalNights` and set `isEarlyCheckout = true`
3. After the departure check, add a new condition: if `isEarlyCheckout && departureParsed === null`, classify the room as a checkout room (dirty, needs cleaning, `is_checkout_room = true`)
4. Add early checkout rooms to `checkoutRoomsList` with status `'early_checkout'`
5. Update room notes to say "Early Checkout" (not "No Show")
6. Fix the existing No Show detection: remove the `depHour < 8` logic (that incorrectly mixed up early checkouts with no-shows). True No Shows are only: Occupied=No + Status=Untidy + has Arrival

**Changes in `src/components/dashboard/CheckoutRoomsView.tsx`:**
- Update the `CheckoutRoom` interface to include `'early_checkout'` and `'no_show'` statuses
- Show Early Checkout rooms in a distinct section or with a distinct badge

**Changes in `src/components/dashboard/HotelRoomOverview.tsx`:**
1. Separate `isNoShow` from `isEarlyCheckout` detection (check notes for each)
2. Show separate counts: "X No-Show" and "X Early Checkout" badges
3. Update tooltip text: show "No Show" or "Early Checkout" distinctly (not combined)
4. Add "Early Checkout" to the legend with a distinct color (e.g., orange ring)

---

### Issue 3: ACT Tooltip - Show Full Meaning

**File: `src/components/dashboard/HotelRoomOverview.tsx` (~line 394)**
- Wrap the ACT badge in a `Tooltip` component that shows "Average Cleaning Time" on hover
- Same pattern already used for room chips in this file

---

### Issue 4: Fix Notification Stacking and Duration

**Problem:** Notifications stack on top of each other, stay too long, and block UI elements.

**File: `src/components/dashboard/EnhancedNotificationOverlay.tsx`:**
- Change max notifications from 3 to 1 (show only the latest notification, replacing the previous one)
- Auto-remove timeout is already 5 seconds -- keep it
- Add a queue system: new notification replaces the current one instead of stacking

**File: `src/hooks/useNotifications.tsx`:**
- Reduce toast duration from 5000ms to 4000ms
- Remove `requireInteraction: true` from browser notifications (they should auto-dismiss)
- Auto-close browser notifications after 5 seconds (already done but `requireInteraction` overrides it)
- Remove the `flash` animation on `document.body` from `VisualNotificationOverlay` (distracting)

**File: `src/components/dashboard/VisualNotificationOverlay.tsx`:**
- Reduce auto-remove from 8 seconds to 5 seconds
- Remove the `document.body.style.animation = 'flash 0.5s'` flash effect

**File: `src/components/dashboard/RealtimeNotificationProvider.tsx`:**
- No structural changes needed -- the notification providers are fine, only the display layer needs fixing

---

### Issue 5: Browser Notifications and Sound Improvements

**File: `src/hooks/useNotifications.tsx`:**
- **Sound**: Replace the harsh 1000Hz beep with a calmer, friendlier chime:
  - Use a lower frequency (523Hz - C5 note) with a gentle fade-out envelope
  - Shorter duration (0.2s) with smooth decay
  - Different tones for different notification types: success (higher, pleasant), warning (two-tone alert), info (single soft chime)
- **Browser notifications**: Remove `requireInteraction: true` so notifications auto-dismiss and don't pile up in the notification tray
- **Service Worker**: The current service worker registration and notification flow looks correct. Ensure `tag: 'hotel-notification'` is used so new notifications replace old ones instead of stacking

---

### Summary of Files to Change

| File | Changes |
|------|---------|
| `src/components/dashboard/PMSUpload.tsx` | Remove column mapping toast; add early checkout detection via Night/Total; separate No Show logic |
| `src/components/dashboard/HotelRoomOverview.tsx` | Separate No-Show/Early Checkout display; ACT tooltip; update legend |
| `src/components/dashboard/CheckoutRoomsView.tsx` | Add early_checkout status support |
| `src/components/dashboard/EnhancedNotificationOverlay.tsx` | Max 1 notification, no stacking |
| `src/components/dashboard/VisualNotificationOverlay.tsx` | Reduce to 5s, remove flash |
| `src/hooks/useNotifications.tsx` | Calmer sound, remove requireInteraction, shorter durations |

