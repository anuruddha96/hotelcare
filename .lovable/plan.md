# Fix no-show detection for room 303 (Hotel Ottofiori)

## What actually happened

Today's live data for Ottofiori room 303 (DB/TW-303) shows:

- Reservation status in Previo: **2 (reserved / never checked in)**
- Arrival 25 Aug, departure 27 Aug — so `arrival < today < departure`
- Room metadata: `occupiedToday: true`, `stayThroughToday: true`, `notArrived: false`, `isNoShow: false`
- The reception note even says "Requested free cancelation / I called many times but no reply"
- A human had to force it: `manual_checkout: true` at 09:09 by Nykipanchuk Kseniia

Every other Ottofiori room synced today carries status **3 (in house)** — 20 rooms at status 3, only 303 at status 2. So the hotel *does* maintain check-in status in Previo, and 303 stands out as the guest who never arrived.

## Root cause

The sync has exactly two ways to conclude "nobody is in this room":

1. `IsNoShow` — only true when Previo reservation status is literally **8**. Reception never set status 8 on this booking, so it never fired.
2. `NotArrived` — only evaluated when `arrivalDate === today`. Room 303's arrival was **yesterday**, so this branch was skipped too.

With both signals off, the generic rule `arrival <= today && departure > today` marked the room occupied, and it landed in Daily cleaning. A guest who no-shows and whose reservation simply rolls past midnight is invisible to the current logic — the exact case the user described.

## The fix

Add one new signal to the Previo housekeeping sync: **stale un-arrived reservation**.

A reservation is treated as a suspected no-show when all of these hold:

- Arrival date is **before today** and departure is after today (it would otherwise be a stay-through)
- Reservation status is still a pre-arrival status (1/2 — reserved/confirmed), never 3/5 (in house), 6 (checked out), 7, or 8
- The hotel demonstrably uses check-in statuses — i.e. this sync run saw at least one other reservation at status 3/5/6. This guard is essential: some Previo properties never check guests in, and without it every room at such a property would be wrongly emptied.

When that fires, the row is emitted with `IsNoShow: true` (plus a reason marking it as inferred rather than Previo status 8), `Occupied: "No"`, no departure/daily flags — the same shape a status-8 no-show already produces, so no downstream code needs new behaviour.

Rooms whose arrival is today and who have not checked in keep today's existing `NotArrived` handling — unchanged.

## Safety

- No change to checkout classification, daily classification, departure-tomorrow, assignment creation, DND, or any other housekeeping behaviour.
- The new branch can only turn a room *out of* Daily; it cannot create checkout rooms or new assignments.
- The "hotel uses check-in statuses" guard means properties that don't maintain Previo check-in are completely unaffected.
- Manual overrides (`manual_daily`, `manual_checkout`) continue to win over the inferred flag, so a manager can always correct it.

## Technical notes

- `supabase/functions/previo-pms-sync/index.ts`: track whether any indexed reservation carries an in-house/checked-out status; add `isStaleNotArrived` next to the existing `isNotArrived` computation; feed it into `isNoShow` for the emitted row and expose a `NoShowSource: "previo_status_8" | "inferred_never_checked_in"` field for auditability.
- `src/lib/pmsClassification.ts`: no rule change needed — it already treats `IsNoShow === true` as an inactive reservation (vacant, not daily, not checkout). Add a unit test covering arrival-yesterday + status 2 + hotel-uses-check-in.
- `src/lib/pmsRefresh.ts`: unchanged logic; the existing `no_show_detected` PMS change event will now also fire for inferred no-shows so it is visible in the PMS changes drawer.
- One-off: room 303 is already corrected manually; the next sync will simply agree with it.
