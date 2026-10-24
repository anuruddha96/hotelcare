# Fix wrong "suspected no-show" (NS?) at Hotel Memories Budapest

## What the data shows today (24 Oct)
- **Room 110**: booking 23 Oct to 30 Oct, Previo status 2 (Reserved, not checked in), flagged `inferred_never_checked_in`.
- **Room 125**: booking 23 Oct to 26 Oct, Previo status **3 (in house)**, occupiedToday = true, yet still flagged `inferred_never_checked_in`.

So there are two separate faults:
1. The guess is too aggressive: one night after arrival with "Reserved" status is treated as a no-show, even though reception often checks guests in late in Previo.
2. The flag is sticky: room 125 is checked in, but an earlier NS? flag survived in the room record (one of the refresh paths keeps the old value rather than recalculating it). The exact path is to be confirmed as the first step.

## New no-show rule (single shared definition)
A room is a no-show for the business day **only if all of these are true**:
1. The booking's arrival date is **before** today (yesterday or earlier).
2. Previo says status 8 (No-show), **or** HotelCare suspects one, which needs all of:
   - status still 1/2 (never checked in), and
   - **no occupancy evidence** at sync time: not occupied, no in-house/checked-out status, no guest count on the room, no occupiedToday, no checked-in record, and
   - no continuing or extension booking on the room.
3. A manager can always confirm or clear it by hand, and that choice wins for that day.

Any check-in signal (status 3/5/6/9, occupied, guests present) **immediately clears** NS and NS?. The room then becomes a Daily room (or Checkout if it departs today).

**Previous no-show, new arrival today:** if the no-show room has a new booking arriving today, it shows as an **Arrival room** with a small "prev. NS" hint, not as a no-show. A no-show is never carried forward as a daily room.

**Suspected (NS?)** is shown only from day 2 after arrival with no occupancy evidence. One unrecorded check-in night alone will not trigger it. Explicit status 8 still shows NS on day 1.

## Steps
1. Trace which writer kept room 125's stale flag (previo-pms-sync core, `pmsRefresh.ts` merge, morning sequence normalisation) and make every writer recalculate `isNoShow`/`noShowSource` from that sync's data, never merging the old value.
2. Move the rule into one shared helper in `_shared/previoNoShowInference.ts`, used by the sync, browser refresh and morning sequence. Update `isNoShowForBusinessDate` so that occupancy evidence overrides any NS flag on the board.
3. Add the "prev. NS, arrival today" case to the arrival classification.
4. Tests using rooms 110 and 125 as fixtures:
   - status 3 + NS flag shows Daily
   - status 2 on day 1 after arrival is not NS?
   - status 2, day 2, no occupancy shows NS?
   - status 8 shows NS
   - previous no-show plus a new arrival today shows Arrival
   - a manager override wins
   - Mika guard unchanged
5. Re-run the Memories sync, then confirm that 110 and 125 move to Daily. No manual data edits, and other hotels' rules are unchanged apart from the shared stickiness fix.

## Question for you
Room 110 is still "Reserved" in Previo. If the guest really is in, reception should check them in there. With the new rule it stays Daily anyway until day 2 without any occupancy sign.
