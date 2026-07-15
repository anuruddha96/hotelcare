I’ll fix this as a PMS sync classification bug, not just a UI issue.

## Findings from the uploaded sheet
For 2026-07-15, the sheet’s rule is clear:

- **Checkout Rooms**: only rooms with a value in `Departure`.
  - CQ-405, Q-201, Q-403, DB/TW-203, DB/TW-303, DB/TW-401, DB/TW-404, TRP-104, TRP-305
- **Daily Rooms**: occupied rooms with no `Departure`, even when `Night / Total` is on the last night.
  - Q-101, Q-301, DB/TW-102, DB/TW-103, DB/TW-202, DB/TW-302, DB/TW-304, DB/TW-402, TRP-105, TRP-204, TRP-205, QRP-406

So **QRP-406 must be Daily today**, with departure-tomorrow metadata/badge where applicable, not Checkout.

## Root cause
The live `previo-pms-sync` is currently logging **0 departures** because the XML reservation lookup for Ottofiori is failing with `401 Invalid login or password`, and REST `/rest/rooms` is only returning the room roster/clean status, not the same reservation/departure data as the Excel export.

Because the sync treats that as a weak PMS snapshot, it preserves old checkout flags instead of clearing them. That is why stale data like QRP-406 can remain in Checkout even though today’s sheet says it is Daily.

## Implementation plan
1. **Make PMS refresh clear stale checkout flags when the live API has no reservation data but the room has stale same-day checkout metadata.**
   - Do not preserve `is_checkout_room=true` just because the API has zero departure signals.
   - Preserve only manager manual checkout overrides (`manual_checkout=true`) and rooms with active checkout-cleaning assignment protection.
   - For QRP-406-like stale PMS flags, reset:
     - `is_checkout_room=false`
     - `scheduledDepartureToday=false`
     - `checkedOutToday=false`
     - `departureTime=null`
     - `checkout_time=null`

2. **Strengthen classification rules to match the uploaded sheet.**
   - `Departure` present = Checkout.
   - `Night / Total` present with no `Departure` = Daily.
   - Last-night rows like `2/2` or `3/3` are still Daily today, and only get `scheduledDepartureTomorrow=true` / C/O+1.
   - No-show remains only a true PMS no-show reservation state, not a missing departure.

3. **Improve the Previo API retrieval path.**
   - Keep REST `/rest/rooms` for room roster/status.
   - Add a safer reservation-data attempt using Previo REST/XML-compatible reservation lookup where available.
   - If Ottofiori credentials cannot access reservation data, expose this clearly in sync diagnostics instead of silently preserving stale checkout buckets.

4. **Add a regression test for the uploaded sheet cases.**
   - Verify QRP-406, DB/TW-102, DB/TW-103, DB/TW-202, TRP-205 are Daily.
   - Verify Q-403, DB/TW-203, TRP-305 are Checkout.
   - Verify `2/2` and `3/3` with blank `Departure` do not become Checkout.

5. **After implementation, deploy the updated edge function and validate against current database state.**
   - Confirm QRP-406 no longer remains checkout after PMS refresh.
   - Confirm checkout count from the uploaded sheet should be 9 and daily count should be 12 for today’s data.