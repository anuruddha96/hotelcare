## Root cause

The `previo-poll-checkouts` edge function has two cron jobs firing every 5 minutes (jobids 8 and 9). Both fire successfully at the HTTP layer — `cron.job_run_details` shows `succeeded` every 5 min — but the function itself returns `400 "hotelId required"` on every cron invocation, so no hotel is ever actually polled. That's why `pms_sync_history` has **zero** `checkouts_poll` rows and 201 sits waiting for a manual refresh.

Why the 400: the pg_cron jobs call the function with only an `apikey` header (anon key), no `Authorization: Bearer <SERVICE_ROLE>` header. In `index.ts`:

```ts
// authHeader = ""  → isServiceCall = false, userId = null
if (!isServiceCall && !userId && !isCronTrigger) { return 401; }  // passes (trigger:cron)
...
if (hotelIdInput) { ... } else {
  if (!isServiceCall) {                                            // ← blocks cron
    return 400 "hotelId required";
  }
  // fan-out across all active Previo configs
}
```

The `isCronTrigger` branch was added to bypass the 401 gate, but the fan-out branch below still hard-requires `isServiceCall`. So cron gets past auth then is immediately rejected before it can enumerate hotels.

Ottofiori is XML-only, so even a manual poll goes through the `credsProtocol === "xml"` path that reads local `rooms` and matches `<statusId>5</statusId>` reservations against them — that path is fine; it just never runs on the schedule.

## Fix

### 1. Allow the cron fan-out path

In `supabase/functions/previo-poll-checkouts/index.ts`, relax the fan-out gate so `trigger: "cron"` calls are accepted the same way service-role calls are:

```ts
} else {
  // Fan-out: service-role OR authenticated cron trigger
  if (!isServiceCall && !isCronTrigger) {
    return 400 "hotelId required";
  }
  ...
}
```

No other logic changes. Per-hotel polling, XML reservation parsing, statusId=5 detection, room matching, `is_checkout_room` flip, `pms_change_events` emission, and stale-clear guards all stay identical.

### 2. Remove the duplicate cron job

Jobs 8 (`previo-poll-checkouts-5min`) and 9 (`previo-poll-checkouts-every-5min`) are exact duplicates on the same `*/5 * * * *` schedule — every tick hits the function twice. Drop job 9 via `cron.unschedule(9)` in the same migration so we don't double-poll Previo once the fix lands.

### 3. Verify 201 gets flipped

After deploy, wait one 5-min tick (or manually invoke the function once with `{"trigger":"cron"}` from the poll button) and confirm:
- `pms_sync_history` gets a fresh `checkouts_poll` row with `hotel_id='ottofiori'` and non-zero `checked`.
- `rooms` row for 201 shows `is_checkout_room=true`, `status='dirty'` (unless a housekeeper is actively cleaning it), and `pms_metadata.checkedOutToday=true`.
- A `pms_change_events` row of type `checkout_confirmed` was written for room 201.

If the reservation is not returned by `searchReservations` for `today→tomorrow` with `statusId=5`, the poll result will include `reservationFetchError` or leave 201 unchanged — in that case we log the XML sample from the response and iterate on the query window separately (not part of this fix).

## Files

- `supabase/functions/previo-poll-checkouts/index.ts` — one-line gate change in the fan-out branch.
- New migration — `SELECT cron.unschedule(9);` (keeps job 8 as the single 5-min trigger).

## Not doing

- No changes to `runCheckouts` in `LiveSyncContext` (client-side polling is still test-hotel-only and doesn't affect Ottofiori).
- No changes to XML reservation parsing, status mapping, or stale-clear rules.
- No new cron jobs.
