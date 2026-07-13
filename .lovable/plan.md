# Fix: Checkout rooms missing after PMS sync (same-day turnover)

## Root cause

In `supabase/functions/previo-pms-sync/index.ts`, when Previo's `searchReservations` returns both the outgoing reservation (departs today) and the incoming reservation (arrives today) for the same room, the picker prefers the wrong one.

Current rank in `replaceIfBetter` (lines 225–230):

```
arrival <= today && departure > today   -> 3   (occupied stay-through)
departure === today                      -> 2   (departure today)
departure === tomorrow                   -> 1
otherwise                                -> 0
```

The incoming guest's reservation satisfies `arrival <= today && departure > today` (arrival = today), so it scores 3 and beats the departing reservation (score 2). The row is then emitted with `Departure: null`, `IsCheckoutRoom: false`, and `pmsRefresh.ts` writes `is_checkout_room = false`. Rooms 405/101/301/102/103/202/203/304/204/205/305/406 all match this pattern in today's XLS; only 201 and 302 (departure today, no new arrival) survive as checkout rooms.

## Fix

Re-rank so a departure-today reservation wins over a stay-through / new-arrival reservation for the same room:

```
departure === today                      -> 4   (must-be-cleaned as checkout)
arrival <  today && departure > today    -> 3   (true stay-through)
arrival === today && departure > today   -> 2   (arrival only, no checkout)
departure === tomorrow                   -> 1
otherwise                                -> 0
```

This preserves the "manual XLS upload" behavior — that flow uses one row per physical room with the departing guest's data, which is exactly what our sync should now emit.

## Files to change

- `supabase/functions/previo-pms-sync/index.ts` — update the `rank()` helper inside the reservation-indexing loop; add a log line noting how many rooms had multiple candidate reservations for observability.

No frontend, DB, or `pmsRefresh.ts` changes needed — once the edge function emits the correct `Departure` / `IsCheckoutRoom` fields, the existing write path (already fixed to reset stale flags) will move the rooms into the Checkout section on the next PMS Refresh.

## Verification

1. Deploy edge function, click PMS Refresh in Team View for Hotel Ottofiori.
2. Checkout Rooms section shows: 101, 102, 103, 201, 202, 203, 204, 205, 301, 302, 304, 305, 405, 406 (matching the XLS Departure column).
3. Daily Rooms retains: 403, 303, 401, 402, 404, 104, 105 (stay-throughs with `Night / Total` set).
4. Console log from `previo-pms-sync` reports the corrected departure count.

## Next up (queued for after this fix ships)

Then continue with yesterday's remaining items: 401 fix on PMS Upload path, admin hide-toggle UI for legacy PMS Upload tab, outbound status push on manager approval, spotlight step for PMS Refresh, and translations for all new strings.
