## Goal

Eliminate the manual "mark room ready to clean" step. The app should detect — within ~10 minutes — when a guest has actually checked out in Previo, and automatically flip the local room from `clean` → `dirty` + `is_checkout_room: true` so housekeeping sees it in their queue.

Scope: **only the `previo-test` hotel** during this API testing phase. All live hotels (Ottofiori, etc.) stay completely untouched, matching the gating you already approved for the push-to-clean work.

## What's already in place

- Edge function **`previo-poll-checkouts`** already exists and does exactly the right job:
  - Calls Previo `/rest/rooms`, finds rooms whose reservation `departureDate <= today` and status matches `checked.?out|departed|left|finished|done` (the Previo statuses you screenshotted — "checked out", "no-show", "cancelled" can all be added), OR rooms whose Previo `roomCleanStatusId !== 1`.
  - Updates the matching local `rooms` row: `status = 'dirty'`, `is_checkout_room = true`, `checkout_time = now()`.
  - Logs every run to `pms_sync_history` (`sync_type: 'checkouts_poll'`).
  - Hard-gated to `hotel_id = 'previo-test'`.
- `LiveSyncContext` already runs PMS + Revenue tasks in the background for managers/admins.

So the work is mostly **wiring**, not new logic.

## Plan

### 1. Add a 3rd LiveSync task: `checkouts`

In `src/contexts/LiveSyncContext.tsx`:
- Extend `TaskName` to `"pms" | "revenue" | "checkouts"`.
- Add `runCheckouts(force)` that invokes `previo-poll-checkouts` with `{ hotelId }`.
- Throttle: **10 minutes** (separate from the existing 2-min PMS throttle, per your spec).
- Auto-run on login, on tab focus (if >10 min since last), and on a `setInterval(10 * 60 * 1000)` while the tab is open.
- Update `tasks.checkouts` state with `{ status, lastAt, meta: { checked, marked, skipped } }`.

### 2. Surface it in the header LiveSync pill

`src/components/layout/LiveSyncIndicator.tsx` already shows PMS + Revenue. Add a small "Checkouts" row inside its tooltip/popover:
- Green check + "X rooms auto-released" when `marked > 0`
- Muted "No checkouts pending" otherwise
- Amber + tooltip on error

Plus a tiny toast when `marked > 0`: *"2 checkout rooms auto-released — ready to clean."* (Sonner, max 1 visible per project rule.)

### 3. Tighten the Previo status matcher

Your screenshot shows the actual Previo reservation statuses: `confirmed`, `checked in`, `checked out`, `other`, `waiting list`, `cancelled`, `no-show`. The current regex (`checked.?out|departed|left|finished|done`) misses `no-show` and `cancelled`. Update `previo-poll-checkouts/index.ts`:

```ts
const releasedStatuses = /^(checked.?out|no.?show|cancelled|departed|left)$/i;
const departed = res && res.departureDate <= today && releasedStatuses.test(res.status || "");
```

This way, no-shows and cancellations on the departure day also auto-release the room.

### 4. Server-side safety net (pg_cron)

Browser polling only runs while a manager has the tab open. To guarantee the 10-min cadence even overnight or when nobody is logged in, schedule the same edge function via `pg_cron` + `pg_net`:

```sql
select cron.schedule(
  'previo-poll-checkouts-every-10min',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/previo-poll-checkouts',
       headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE>"}'::jsonb,
       body := '{"hotelId":"previo-test"}'::jsonb
     );
  $$
);
```

This needs a small tweak to the edge function: allow service-role calls (no user JWT) to bypass the `Unauthorized` check, but still keep the `previo-test`-only gate. I'll add an `x-cron-secret` header check as the alternative auth path.

### 5. Visibility for managers

In `src/components/admin/PmsSyncStatus.tsx`, add a **"Auto-released checkout rooms"** section:
- Reads last 10 `pms_sync_history` rows where `sync_type = 'checkouts_poll'` for the active hotel.
- Shows `checked / marked / skipped` counts + timestamp + success/error icon.

## Safety guarantees

- The edge function's `ALLOWED_HOTEL_ID = "previo-test"` gate stays — any other hotel returns `{ skipped: true }` and writes nothing.
- LiveSync's `runCheckouts` will only fire when the active hotel has a Previo config (already enforced via `hasPrevio`).
- The cron job is also pinned to `hotelId: "previo-test"`.

## Testing checklist

1. As manager on `previo-test`, leave the tab open. Within 10 min of a Previo guest being marked `checked out` with today's departure, the room should flip to dirty in Hotel Care and appear in housekeeping's queue. Toast should appear.
2. Check `pms_sync_history` for a fresh `checkouts_poll` row with `marked >= 1`.
3. Close the tab for 30 min, mark another guest checked out in Previo, then verify the pg_cron run flipped the room without anyone logged in.
4. Verify no `checkouts_poll` rows are ever written for `ottofiori` or any other live hotel.

## Files touched

- `src/contexts/LiveSyncContext.tsx` — new `checkouts` task + 10-min interval
- `src/components/layout/LiveSyncIndicator.tsx` — display checkouts task state
- `src/components/admin/PmsSyncStatus.tsx` — auto-release history panel
- `supabase/functions/previo-poll-checkouts/index.ts` — broader status regex, optional cron auth
- New migration — `pg_cron` schedule (test hotel only)
