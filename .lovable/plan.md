# Make long-range price pushes reliable, queued, and self-healing

## What is actually going wrong (confirmed in the live system)

Tonight's four failed Ottofiori pushes (117, 104, 214, 260 prices) all died with the same database error before a single price left the app:

```text
duplicate key value violates unique constraint "revenue_rate_drafts_one_active_cell_idx"
Key (hotel_id, stay_date, room_type_name, occupancy)=(ottofiori, 2026-11-26, Deluxe Čtyřlůžkový Pokoj, 1)
```

The queue allows only one live intent per price cell. When a new push is submitted, the code writes the new rows **first** and only afterwards retires the older ones — so if even one date/room/occupancy in the range still has an unfinished or previously failed row, the whole submission is rejected. That is exactly why long ranges fail more often: the wider the range, the higher the chance of hitting one leftover cell. The browser then shows the bare "Edge Function returned a non-2xx status code" toast, and nothing at all was queued — not even the 259 prices that were fine.

Two side effects of the same design:

- Red cells ("not applied" / price-order blocked) stay `failed` forever. They keep occupying their cell, so they also keep poisoning every later push over that date, and they only disappear if someone dismisses them by hand.
- A failed cell is re-sent by the reconciler using Hotel Care's old intent, even when a fresh Previo sync has already shown a different, correct live price.

## The fix

### 1. A push submission can no longer fail as a whole

- Retire the older intent for a cell **before** writing the new one, in one transactional step per chunk, so the newest price always wins and no duplicate can occur.
- Include cells that are already claimed by the publisher: the newer intent supersedes them, and anything the publisher had in flight for that cell is discarded on completion instead of overwriting the newer price.
- If individual cells still cannot be queued, queue everything else and return those cells as a short, readable list ("3 of 262 prices could not be queued — reason"). Never a 500.
- The grid replaces the raw non-2xx toast with the real message and a count of what was queued.

### 2. Real queueing across tabs, hotels and users

- Each submission stays one durable job; jobs are drained one at a time in priority order (manual before automation), which is already the design — the queue simply stops losing jobs at the door.
- When a job is submitted while another is publishing, the app says so plainly: "Queued — 2 jobs ahead, prices will go out shortly", instead of leaving the user guessing.
- The publisher's completion check is scoped to the job's own remaining work, so a run is not marked completed while its rows are still waiting.
- Long ranges keep the existing slice-and-continue behaviour; progress counters accumulate across slices, and a job never reserves the Previo lease longer than one slice.

### 3. Previo becomes the truth after a fresh sync (red squares heal)

- After a Previo read covering a date/room type, any `failed` or `blocked` intent for those cells that is older than the read is closed out automatically as "settled from Previo" — the red marker disappears without anyone dismissing it.
- The reconciler only re-sends a failed intent when it is newer than the last Previo read for that cell; otherwise the synced Previo price is accepted as current.
- Price-order blocks are re-evaluated against the freshly synced ladder: if Previo's own prices are already in order, the block is dropped rather than kept forever.
- A capped attempt count on retries, so no cell can loop between "failed" and "re-queued" indefinitely.

### 4. Housekeeping of what is stuck right now

- Close out the leftover `queued` jobs from 21–23 Aug whose prices were long since superseded, and the 5 blocked Ottofiori cells, so the queue starts clean.
- Retire the `previo-test` sandbox job that fails on invalid credentials on every automation round.

## Technical notes

- `supabase/functions/revenue-enqueue-rates/index.ts`: reorder to supersede-then-insert per 500-row chunk (a `supersede_and_queue_rate_drafts` SQL function doing both statements atomically), drop the `claimed_at IS NULL` restriction on superseding, catch per-chunk `23505` and report the affected cells in the response payload instead of throwing.
- `supabase/functions/revenue-push-drafts/index.ts`: skip drafts superseded after claim; scope the "more work" count to `push_run_id`; keep failure states per cell with `push_attempt_count` increments and a max-attempt cutoff.
- `supabase/functions/previo-revenue-sync/index.ts`: after each read window, settle stale `failed`/`blocked` drafts covered by the read (`status = 'settled_from_pms'`), and require `created_at > last_read_at` before re-queueing a retry.
- `src/components/revenue/RateStrategyGrid.tsx` / `src/lib/ratePublishing.ts`: surface the structured enqueue response (queued count, rejected cells, queue position) and drop the generic non-2xx toast.
- One migration for the settle status and a helper index; no schema redesign.

## Validation

- Push a 6-month range for Ottofiori twice in a row without waiting, and from two tabs on two hotels at once — both jobs queue and complete, none returns a non-2xx.
- Push a range that overlaps existing red cells and confirm the whole range is queued and the red cells clear.
- Force a Previo-side price difference, run a sync, and confirm the red marker heals to the Previo value instead of being re-sent.
