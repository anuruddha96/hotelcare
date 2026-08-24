# Instant-open Revenue: server-side sync every 30 minutes, one property at a time

## Goal
When anyone opens a property (or five tabs, one per venue), the app shows the last synchronised data immediately — no sync overlay, no waiting. Freshness is maintained by the server on a 30-minute cadence, strictly one property at a time.

## 1. Server-side scheduler (replaces user-triggered sync)

- New scheduler edge function that runs every 5 minutes via cron and does one thing: pick the single most-overdue property whose data is older than 30 minutes, take a global lock, run its Previo revenue sync, release.
- Global single-flight: only one automatic sync anywhere may run at a time, across all organisations and venues. Others simply wait for their turn in the next tick.
- Fairness: properties are ordered by "oldest successful sync first", so with the current property count every venue is refreshed well inside its 30-minute window.
- Abandoned runs expire (stale lease) so one failure cannot block the queue.
- Each run records success/failure, duration and row counts against the property's sync state, which the UI reads for its "as of" caption.

## 2. Opening a property never triggers a sync

- Remove the on-open / interval automatic sync claim from the Revenue detail page and the live-sync provider. Opening a page reads the database only.
- Remove the blocking sync overlay for automatic refreshes. The page paints the stored data straight away and shows a small "as of 11:20 · refreshing" caption when the server run is in progress.
- Manual **Sync now** stays and stays immediate. Manual runs are allowed to run in parallel with the automatic queue, protected by the existing per-property lock so the same property is never synced twice at once.

## 3. Honest queue messaging

- If a manual sync is requested while that same property is already being synced by someone in the same organisation, show: "Another user is refreshing this property — your refresh will follow." (name only within the same organisation).
- If the wait is caused by a run on a property the user cannot see, show a neutral "Refresh queued, starting shortly" with no organisation, venue or user detail.

## 4. Fast, complete first paint

- Add a lightweight per-property, per-date rollup read so the 12-month occupancy / ADR / RevPAR outlook arrives in one small query on first paint, instead of appearing three months at a time.
- Rate & pickup calendar keeps its progressive loading, but only for cells beyond the visible window; the months shown in the outlook strip are never blank.
- Dates with no synced evidence render a shimmer, never a misleading 0% / €0 (finishes the in-flight `hasData` work in `revenueAnalytics.ts` and `MonthPerformanceHeader`).
- Loading animations are capped: anything still pending after a few seconds becomes an inline "loading later months" note rather than a blocking overlay.

## 5. Mobile and multi-tab behaviour

- Switching property on mobile swaps to the newly selected property's cached data immediately, with a shimmer only on tiles that genuinely have no data yet.
- Each tab stays pinned to its own property (existing per-tab selection is preserved), and no tab triggers a sync, so ten open tabs cost ten cheap reads.
- Ignore late responses from a previously selected property so a slow reply cannot overwrite the current view.

## Technical notes
- New edge function + pg_cron schedule (every 5 minutes); the 30-minute rule and existing `revenue_sync_state` lease stay the source of truth.
- One migration for a global scheduler lock row/function; no data migration, no tenant or role changes.
- Previo call volume is unchanged or lower: today every page open can trigger a pull, after this each property pulls at most twice an hour.

## Validation
- Open five venue tabs cold: all paint stored data in under ~2 seconds, none starts a sync.
- Watch a 30-minute window: exactly one automatic Previo run at a time, every property refreshed within the window.
- Force two manual syncs at once: same-organisation case shows the named queue message, cross-organisation case shows the neutral one; neither corrupts data.
- Confirm the 6-month outlook shows real numbers or shimmer on first paint — never 0%.
