# Fix checkout-room and no-show classification (Ottofiori)

## What I found in today's live data

Today's Previo sync (08:38) marked exactly these as checkout rooms: 102, 104, 105, 203, 303, 304, 403, 404 — the same list you gave. So the classification of *today's* PMS feed is right. The wrong rooms come from two separate defects:

1. **TRP-204 is stuck as a checkout room.** Its current PMS data says the guest is staying (arrival 05 Aug, departure 08 Aug, status "in house", no departure time). But the room still carries `is_checkout_room = true` from yesterday, when it genuinely was a checkout. The morning auto-assign at 05:18 created a `checkout_cleaning` assignment off that stale flag, and the sync then refuses to clear the flag *because* a checkout cleaning is in progress. That's a self-reinforcing loop: a wrong flag creates an assignment, and the assignment protects the wrong flag forever.

2. **No-show detection fires on text, not on reservation state.** Rooms 101, 301 and 405 are currently flagged `isNoShow = true` even though all three are occupied stay-through guests (Previo status "in house"). The sync flags a no-show whenever the reservation note text contains the words "no show" anywhere — including inside the pasted Booking.com/OTA blob. Meanwhile DB/TW-302 (arrival today, guest not yet checked in, room was empty last night) is not surfaced at all as an unarrived/no-show candidate.

## What will change

### 1. Break the stale-checkout loop
- When today's PMS feed is authoritative and clearly says the room is occupied stay-through (departure date after today, no departure time, in-house status), clear `is_checkout_room` even if a checkout cleaning already exists for that room. Only an explicit manager "mark as checkout" for today keeps it.
- In that case also convert the room's open `checkout_cleaning` assignment to `daily_cleaning` in place, so the housekeeper's card, timer and required steps switch to a daily clean instead of leaving a phantom checkout task.
- Log this as a `pms_change_event` so it is visible in the PMS changes drawer.

### 2. Reset yesterday's buckets before the morning auto-assign
- The new-day reset already clears DND and manual overrides; extend it to clear yesterday's `is_checkout_room`, `checkedOutToday`, `readyToClean` and `departureTime` before any assignment generation for the new day.
- Auto-assignment for a new day will refuse to build checkout tasks from flags that were not stamped with today's date, so a night without a sync can no longer bleed yesterday's checkouts into today.

### 3. Make no-show a reservation state
- Remove the "note text contains no show" heuristic. A no-show is Previo reservation status 8, or a manager's manual mark for today.
- Clear `isNoShow` on any room whose current reservation is in-house or departed, which immediately fixes 101, 301 and 405.
- Add a distinct **Not arrived** signal for rooms like DB/TW-302: a reservation that starts today, is still in "reserved / not checked in" state, and the room was empty last night. These show in the Arrivals bucket with a "not checked in" badge, and only become a no-show when Previo sets status 8 or a manager marks it — no housekeeping task is created for them.

### 4. Repair today's data
- One-off correction for Ottofiori: put TRP-204 back to daily (converting its in-progress checkout task), and clear the false no-show flags on 101, 301, 405. Rooms 102, 104, 105, 203, 303, 304, 403, 404 stay as checkouts.

## Technical notes
- `supabase/functions/previo-pms-sync/index.ts`: drop the note-keyword branch in the `isNoShow` computation; keep status 8; add `NotArrived` to the emitted row.
- `src/lib/pmsRefresh.ts`: rework `preserveExistingCheckout` so the "checkout cleaning in progress" protection no longer applies when the PMS feed positively identifies a stay-through guest; extend the new-day reset block to wipe checkout flags; add the assignment retype step next to the existing assignment-sync code.
- `src/lib/pmsClassification.ts`: expose an explicit `isStayThrough` signal so both the edge function and the client agree on the same rule.
- Team View / room cards: render the "not checked in" badge in the Arrivals bucket; no other UI changes.
