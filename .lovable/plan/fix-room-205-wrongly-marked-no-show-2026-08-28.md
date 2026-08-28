# Fix: Room 205 wrongly marked No-Show

## What is happening

Room 205 at Hotel Ottofiori has a live, occupied reservation (night 2 of 5, Previo Cleaning list shows Occupied), yet the Housekeeping Board shows it under "No Show Rooms".

Confirmed from the stored room record: `pms_metadata` for Ottofiori room 205 (Previo `TRP-205`) holds `isNoShow: true` while `reservationStatusId: 2`, `currentNight: 2`, `totalNights: 5`. Previo never marked this reservation as a no-show (that would be status 8).

## Root cause

The Previo sync contains an *inference* rule that invents no-shows:

- If the property is detected as one that "uses check-in statuses" (any single reservation anywhere in the property sits at in-house or checked-out status), then
- any reservation whose arrival date is in the past, departure in the future, and whose status is still pre-arrival (1 or 2) is flagged `isNoShow` with source `inferred_never_checked_in`.

Ottofiori only *partially* maintains check-in statuses: reception checks some guests in and leaves others at status 2. Room 205's guest is physically in-house but the reservation was never advanced past status 2, so the inference fired. The sync then also forces `Occupied: "No"` and `People: 0` for that row, which is why the board shows a no-show with no occupancy — the occupancy was erased by the same wrong flag, not read from the PMS.

This makes the rule structurally unsafe: a reservation that spans today *is* occupancy, so it can never be a no-show.

## The fix

1. **Remove the inferred no-show path** in `supabase/functions/previo-pms-sync/index.ts`. A room is a no-show only when Previo says so (`statusId === 8`) or a manager marks it manually on the board. Drop `isStaleNotArrived`, `hotelUsesCheckInStatuses`, and `isPreArrivalStatus`; keep `NoShowSource` emitting `previo_status_8` / `null`.
2. **Add an occupancy guard** so this class of bug cannot recur: a row is never emitted as no-show when the reservation covers today (`arrivalDate <= today < departureDate`). Same guard client-side in `src/lib/pmsClassification.ts` — `isNoShow` requires no active stay for today, so occupancy present ⇒ never no-show.
3. **Self-heal existing rooms** in `src/lib/pmsRefresh.ts`: when the incoming PMS row is not a no-show and has occupancy, clear a previously stored `isNoShow` (including a stale manual mark from a prior day) instead of preserving it, and log a `no_show_cleared_auto` event.
4. **Repair today's data** by re-running the Previo sync for Ottofiori so room 205 returns to Daily Rooms with its correct occupancy and 2/5 nights.

Guests who genuinely never arrive still appear: Previo status 8, plus the existing manual "Mark no-show" action for reception.

## Scope

Only no-show detection changes. Checkout/daily/arrival classification, assignments, and other hotels' behaviour are untouched (removing the inference can only reduce false no-shows).
