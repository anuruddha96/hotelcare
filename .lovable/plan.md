# Housekeeping access, room-chip names, and a calmer revenue engine

## 1. Missing housekeeper on room chips (Hotel Ottofiori)

Confirmed cause: Svetlana's profile name is stored as `" Svetlana Sobolieva"` with a leading space. The chip label does `name.split(' ')[0]`, which returns an empty string, so no name is drawn. Her card below still works because it renders the full name.

Fix:
- Trim and collapse whitespace before deriving the chip label (a shared helper used by all three places in `HotelRoomOverview.tsx` that build short names).
- Show the **full first name** instead of truncating at 7 characters, so "Nykipanchuk" no longer reads "Nykipan.". Chips wrap/ellipsis by CSS only if the name is extremely long.
- Also clean the stored name (data update) so the leading space stops leaking into other screens.

## 2. Top-management access in Housekeeping

Give `top_management` / `top_management_manager` the same visibility managers already have for:
- Dirty Linen management (and make its data reload with the current tab's hotel, like Team View does).
- Performance analytics.
- Staff management.

These are gated by role lists in the housekeeping tab/section components; the executive roles get added and the data queries are scoped to the tab-selected hotel so nothing from another property leaks in.

## 3. Reception module loads slowly for top management

Reception waits on the hotel/room lookups before painting anything. Fix by resolving the hotel keys from the already-known tab selection, rendering the shell with skeletons immediately, and fetching rooms once (no double fetch on profile settle).

## 4. Revenue module entry experience

When arriving from another module, the page currently paints blank cards.
- Show a full-module loading state: brand animation, "last synced …" line, and staged progress ("Pulling rates…", "Reading pickup…", "Building calendar…").
- Only reveal KPIs and the calendar once the data set is complete — no half-empty cards.

**Returning after a long absence:** if the tab has been idle/hidden and the property data is older than the freshness window, automatically refresh on return and show a friendly full-screen overlay: "Welcome back, {first name} — refreshing your numbers", with a rotating motivational quote each time, until data is ready.

**Sync attribution:** manual syncs record the signed-in user's name; only true cron runs read "automatic sync". The header shows "last synced 12 min ago by Anuruddha" vs "by automatic sync".

## 5. Hourly, disk-safe pickup automation

Today the pickup automation runs every 30 min and the engine hourly; the global engine is paused with reason "Paused to relieve database disk I/O", and automation is off.

New arrangement:
- One **hourly** pickup scan per enabled hotel (replacing the 30-min job), reading a bounded window instead of full history.
- Per-hotel enable so Ottofiori and Hotel Memories Budapest can be switched on while others stay off; the global switch stays as the master kill switch.
- Each run writes one summary row: pickup found, rules matched, prices moved, skipped and why. That summary drives a compact "last automation run" panel so you can see it worked without opening logs.
- Keep the existing guard: never raise on negative net pickup; respect daily cap and the configured run times.
- Reduce IO further: purge/aggregate audit rows on the existing nightly purge and drop the per-cell count queries in favour of one windowed fetch per grid load.

## 6. Rewriting the change dots

Problems today: a purple automation dot survives a later manual change, and dots accumulate across days.

New rule set:
- **One dot per cell, one dot per date column**, coloured by the **most recent** change only: blue = your team, purple = automation, amber = Previo, red = did not land.
- **Daily reset:** dots only reflect changes made *today* (property-local day). At midnight the board is visually clean again; nothing is deleted.
- Clicking a date or hovering a cell opens the history with the **last 5 changes** (old → new price, who/what, exact time), regardless of the daily reset.
- A manual edit immediately replaces the cell's dot colour, before the Previo confirmation returns.

## 7. Instant local updates, background publishing

Hotel Care becomes the source of truth for what you see:
- On save the grid updates the price and dot **instantly** (optimistic), with no draft step.
- The publish job is queued in the background and split into batches automatically, so a 1-day or a 2-month range both work; large ranges no longer fail silently.
- A persistent **publishing status panel** (dockable pill that expands) shows: total price cells, sent, confirmed, pending, failed, elapsed time, and a retry for failures. It never blocks the calendar or changes displayed prices.
- Failures mark only their own cells red with the reason; everything else stays as shown.
- Verification runs in the background — no "Check now" button.

## Technical notes

- Chip naming: shared `shortStaffName()` helper (trim → collapse spaces → first token, untruncated) in `HotelRoomOverview.tsx`; data fix via an update to the affected profile row.
- Role gates: extend executive roles in the housekeeping tab config and in `DirtyLinenManagement`, `PerformanceLeaderboard`, `HousekeepingStaffManagement`; scope their queries through `resolveHotelKeys(profile.assigned_hotel)` (tab-aware).
- Revenue loading: gate `RevenueHotelDetail` render on a combined `ready` flag; add `RevenueLoadingCurtain` and `WelcomeBackOverlay` (visibility + `lastSyncAt` driven).
- Sync attribution: pass the actor name to `complete_revenue_sync` from every manual path (`LiveSyncContext`, `Revenue.tsx`, `RevenueHotelDetail`); cron paths pass null.
- Automation: change the pg_cron entry for `revenue-pickup-automation` to hourly; add a per-hotel enable flag plus a run-summary row read by the new panel.
- Dots: rewrite `src/lib/rateOrigin.ts` to "latest event within the current local day wins", returning a single origin per cell/date plus the last 5 events for the history card; `RateStrategyGrid` and `RateCellHistory` consume that.
- Publishing: `revenue-enqueue-rates` keeps queueing, worker batches by occupancy-ladder collapse; client tracks `revenue_rate_push_runs/items` for the status panel and applies optimistic cell state immediately.

## Out of scope

No changes to SLNT-specific scheduling, and no changes to RD Hotels/Ottofiori tenant isolation rules.
