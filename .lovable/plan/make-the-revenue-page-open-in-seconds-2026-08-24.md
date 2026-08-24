# Make the Revenue page open in seconds

## What I found

Two separate problems, both confirmed against the live database.

**1. The server-side 30-minute auto-sync was never actually scheduled.**
The `revenue-sync-scheduler` edge function exists and works, but there is no cron job calling it. The scheduled jobs today are: nightly Previo sync, checkout polling, automation, publish queue, morning digest, daily-overview refresh and event search — no revenue scheduler. Every row in `revenue_sync_state` was written by a person (Anu, Ricsi, Fruzsi), never by the scheduler. So properties only get fresh data when someone presses "Sync now".

**2. The page downloads tens of thousands of rows on every open.**
For Hotel Ottofiori, the first-paint window (today + 60 days) pulls:

```text
revenue_daily_snapshots   23,868 rows   (needed: ~120)
pickup_snapshots          23,258 rows   (needed: ~200)
revenue_booking_nights       731 rows
revenue_room_type_rates      793 rows
```

Both big tables store *every historical capture* per stay date, and the browser fetches all of them 1,000 rows at a time — roughly 48 sequential-ish round trips before the calendar can render. Over the full 12-month horizon the snapshot table alone holds 118,734 rows for this property, which is past the client's 20,000-row safety cap, so later months also arrive incomplete. This is the >2 minute wait, and it happens on every tab reload.

The page only needs the newest capture per date (plus one baseline capture for pickup) — not the full capture history.

## The fix

### A. Turn on the scheduler
Add the missing cron job so `revenue-sync-scheduler` runs every 5 minutes. It already refreshes at most one property globally per tick and only when that property is older than 30 minutes, so nothing changes about Previo load — it just starts running.

### B. Collapse the two heavy feeds server-side
Add two read-only database functions that do the reduction in Postgres instead of shipping raw history to the browser:

- `revenue_calendar_snapshots(hotel, from, to, window_start)` — returns the newest capture per stay date, plus the newest capture before the pickup window opened (the baseline the pickup maths needs). ~2 rows per date instead of ~400.
- `revenue_pickup_movements(hotel, from, to, since)` — returns pickup deltas per stay date bucketed by hour, with gains and losses kept separate (the calendar relies on that split). A few hundred rows instead of 23,000.

Both use the indexes that already exist on `(hotel_id, stay_date, captured_at DESC)`.

The hook `useRevenueHotelData` swaps the two paginated `fetchAll` calls for single RPC calls. Row shapes stay identical, so `revenueAnalytics.ts` and every chart/grid consuming them are untouched.

Expected effect: first paint drops from tens of thousands of rows and dozens of round trips to a few hundred rows in two queries — seconds, not minutes. The 12-month extension stops hitting the row cap, so later months fill in completely.

### C. Make freshness visible
In the property header, replace the current text with an explicit freshness line: `Data as of 14:05 · updated automatically every 30 minutes`, and while the very first load is still in flight show the shimmer rather than the misleading "never synced" (seen in the screenshots — it flashes before the sync row arrives, then corrects itself). When the background scheduler refreshes this property, the existing watcher keeps the in-place "refreshing in the background" note.

## Technical notes

- Migration: two `SECURITY INVOKER`, `STABLE` SQL functions + `GRANT EXECUTE ... TO authenticated`; existing RLS on the underlying tables continues to apply.
- Cron: `select cron.schedule('revenue-sync-scheduler-5min', '*/5 * * * *', ...)` posting to the existing function (run via SQL, not a migration, since it embeds project URL and key).
- Files touched: `src/hooks/useRevenueHotelData.ts` (two feeds → RPC), `src/pages/RevenueHotelDetail.tsx` / `src/components/revenue/MonthPerformanceHeader.tsx` (freshness line). No change to pricing, automation or push logic.
- Verification: re-run the row counts against the new functions, then reload the Revenue page and confirm time-to-first-calendar, and check `revenue_sync_state` shows scheduler-driven successes within 30 minutes.
