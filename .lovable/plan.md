

## Plan: Fix DND Persistence on PMS Upload + Improve Sign-In Prompt

### Problem 1: DND Not Clearing on PMS Upload

**Root Cause Found:** In `src/components/dashboard/PMSUpload.tsx` (line 460), the room update (which includes `is_dnd: false`) only runs when status or checkout type changes:

```
if (currentStatus !== newStatus || room.is_checkout_room !== isCheckout) {
    // update runs here — DND gets cleared
}
```

If a room stays "dirty" and stays non-checkout between days, the update is skipped entirely and DND persists from the previous day. Rooms 402 and 405 at Hotel Ottofiori are in this exact state (both marked DND on Feb 11, still showing today).

**Fix:** Always run the DND-clearing update for every room processed, regardless of whether status/checkout changed.

- Move the DND fields out of the conditional update, OR
- Add a separate unconditional update for DND fields when the main update is skipped
- Specifically: after the existing `if` block, add an `else` block that clears DND fields if the room currently has `is_dnd: true`

**Immediate Data Fix:** Run a direct database update to clear DND on rooms 402 and 405 for Hotel Ottofiori right now via a SQL migration.

### Problem 2: Sign-In Prompt for Housekeepers

**Current State:** `AssignedRoomCard.tsx` already blocks room starts for unsigned-in users (line 310-334) and shows a toast with a "Go to Check In" button. However, the redirect uses `document.querySelector('[data-value="attendance"]')` which may not reliably find the tab.

**Improvement:** Make the redirect more reliable and the message clearer:
- Use `[value="attendance"]` selector (Radix TabsTrigger uses `value` attribute) as a fallback
- Improve the toast message to be friendlier and more informative, explaining why they can't start
- Keep the existing redirect button but make the selector more robust

### Files Changed

| File | Change |
|------|--------|
| `src/components/dashboard/PMSUpload.tsx` | Always clear DND fields on every processed room, even when status hasn't changed |
| `src/components/dashboard/AssignedRoomCard.tsx` | Improve sign-in prompt message and make tab redirect more robust |
| New SQL migration | Clear DND on rooms 402 and 405 at Hotel Ottofiori immediately |

### Technical Details

**PMSUpload.tsx change (around line 460):**

Current logic:
```text
if (currentStatus !== newStatus || room.is_checkout_room !== isCheckout) {
    update ALL fields including is_dnd: false
}
// else: nothing happens, DND persists
```

New logic:
```text
if (currentStatus !== newStatus || room.is_checkout_room !== isCheckout) {
    update ALL fields including is_dnd: false
} else {
    // Status unchanged, but still clear DND if it was set
    if (room.is_dnd) {
        update only: is_dnd: false, dnd_marked_at: null, dnd_marked_by: null
    }
}
```

**AssignedRoomCard.tsx change (around line 321-327):**
- Try multiple selectors: `[data-value="attendance"]`, `button[value="attendance"]`, or dispatching a custom event
- Update message to: "Please sign in first to start cleaning. Tap below to go to the attendance page."

**SQL migration:**
```sql
UPDATE rooms SET is_dnd = false, dnd_marked_at = NULL, dnd_marked_by = NULL
WHERE hotel = 'Hotel Ottofiori' AND room_number IN ('402', '405') AND is_dnd = true;
```

This is a safe, non-disruptive change -- it does not affect any ongoing room assignments, performance data, or allocated rooms. It only resets the DND flag so housekeepers can re-mark rooms if needed.
