# SLNT shared PMS state, occupancy rules, mobile assignment, and Revenue API

All behavior below is gated to the SLNT organization / multi-account portfolio. Ottofiori, RD Hotels, and every other tenant keep their current PMS, housekeeping, and Revenue behavior.

## Verified current state

- The latest SLNT room refresh did update the shared database: **60 of 61 units** have today’s PMS refresh stamp, with the latest room update at 10:49 UTC. The warning is therefore stale/incorrect, not evidence that every user must sync again.
- `LiveSyncContext` checks `pms_sync_history` using one exact hotel string. SLNT is a portfolio with two `pms_accounts`, and the successful room state is not represented by a matching successful history row; only failed legacy `rooms` rows currently exist for `slnt-group`.
- Previo currently reports **Sobi Apartment Budapest, K4 Room 4, and K4 Room 5** with reservation status `2`, arrival today, no departure today, and “not arrived.” They are not currently reported as status `7` (cancelled) or `8` (no-show). The incorrect Daily placement comes from marking a date-overlapping, not-yet-arrived reservation as occupied/stay-through.
- The board already has SLNT venue grouping, venue color edges, chip selection, a sticky housekeeper picker, staged auto-restored moves, and desktop drag. The housekeeper picker currently shows a short nickname/name and workload, but not the venue scope the user needs when assigning.
- The current Previo revenue pull reads one legacy `pms_configurations` row. Calling it once per SLNT account would be unsafe because each run replaces the same portfolio snapshot range; the second account could overwrite the first. Both accounts must be fetched and merged before one aggregate write.

## 1. Make PMS freshness shared and reliable

- Treat PMS freshness as property-wide server state, never per-browser or per-user state.
- For SLNT, resolve both active `pms_accounts` and consider the portfolio current only when every active account has a successful sync for today (or when today’s room metadata proves the corresponding account’s mapped units were refreshed).
- Stamp each account’s `last_sync_at`, `last_sync_success_at`, status, error, and failure count after its attempt; write one aggregate `rooms_refresh` history row for `slnt-group` with per-account results.
- Update `LiveSyncContext`, the header status, Team View prompt, and refresh button to read the same aggregate result. A refresh by one authorized user immediately satisfies all other users.
- Show “Up to date,” “Partially synced (1/2 accounts),” “Failed,” or “Not synced today,” including account labels and latest successful time. Do not show success when only one account completed.

## 2. Correct SLNT occupancy, cancellation, no-show, and RTC

- In the SLNT Previo adapter, distinguish reservation lifecycle from date overlap:
  - status `7` cancelled: vacant, not Daily, not Checkout, no RTC, guest count 0;
  - status `8` no-show: vacant/no-show bucket, not Daily, not Checkout, no RTC, guest count 0;
  - valid arrival that has not checked in: Arrivals / Not checked in, not Daily and not occupied;
  - checked-in stay-through: Daily;
  - departure scheduled today: Checkout but held from cleaning;
  - PMS-confirmed departure today: Checkout + RTC;
  - approved cleaning: clean locally and push clean to the owning Previo account through the existing SLNT account mapping.
- Preserve an explicit manager override for early departure, delayed departure, or manual no-show for the current work day, while the next authoritative Previo change can correct the automated state.
- Use Budapest local date/time. SLNT’s standard checkout time is **10:00** when Previo supplies no explicit time; this is a schedule/hold signal only. Do not mark RTC merely because the clock reaches 10:00—RTC still requires a Previo-confirmed departure or a manager’s manual release.
- Clear stale Daily/Checkout flags and reconcile untouched assignments when a reservation becomes cancelled/no-show/not-arrived, without deleting completed work or today’s manual operational data.
- Re-run sync after deployment and verify Sobi/K4 4/K4 5 against the then-current Previo statuses rather than hard-coding an assumption. With today’s API state, all three should appear under Arrivals / Not checked in, not Daily.

## 3. Simplify SLNT Team View and mobile allocation

- Keep venue-grouped rows and color edges, but make each venue a compact collapsible row with a sticky venue label, unit count, and one-tap select-all. Default to a dense mobile-friendly grid of short unit chips.
- Keep tap-to-select as the primary mobile and desktop workflow: select one or many units, then choose a housekeeper from the sticky assignment tray. Retain desktop drag as a secondary shortcut.
- In the housekeeper tray and card name tag, show:
  - full name and `@username`;
  - current assigned-unit count;
  - assigned venue names (or “All SLNT venues”);
  - compact venue-color markers matching the board.
- Filter eligible housekeepers by the selected units’ venue scopes. For a mixed-venue selection, only show staff allowed for every selected venue; explain disabled/ineligible staff without allowing a bad assignment.
- Use existing staged moves and local auto-restore. Applying remains one batch action; refresh/navigation must not discard unapplied selections or staged moves.
- Keep all controls accessible by touch and ensure the sticky tray does not obscure the final venue row.

## 4. Map Revenue Management to both SLNT Previo accounts

- Enable Revenue for SLNT top-management/admin roles without changing other tenants’ module access.
- Extend the existing Previo revenue ingestion with an SLNT portfolio branch that loads both active `pms_accounts` (`782407`, `783103`), uses each account’s own credential secret, and fetches rooms, reservations, rates/pricelists, cancellations, and pickup inputs from both.
- Merge both account payloads in memory first, namespace external IDs by account, deduplicate only within an account, and calculate one combined 61-unit portfolio inventory before a single transactional write under hotel key `slnt-group` / organization `slnt`.
- Never invoke the current single-account replace flow twice. One failed account produces a visible partial result and preserves the previous successful portfolio snapshot rather than publishing a misleading half-portfolio occupancy figure.
- Store per-account ingest diagnostics plus one aggregate run. The Revenue UI shows combined occupancy, ADR, revenue, pickup, cancellations/no-shows, rates, and the status of each source account.
- Keep pricing changes/pushes account-aware: every room type/rate plan retains its owning `pms_account_id`; no rate can be sent to the other Previo profile.

## 5. Technical changes

- Frontend: `src/contexts/LiveSyncContext.tsx`, PMS status/refresh components, `HotelRoomOverview.tsx`, `HousekeepingManagerView.tsx`, `Revenue.tsx`, and the relevant revenue data hooks.
- Shared logic: `src/lib/pmsRefresh.ts`, PMS classification helpers, tenant features, and a small SLNT staff-scope/venue presentation helper.
- Edge functions: `previo-pms-sync` for status 7/8/not-arrived and 10:00 SLNT fallback; `previo-pull-revenue` (or the current canonical revenue ingest function) for atomic two-account portfolio ingestion.
- Database: a focused migration only if required to persist account-scoped revenue source IDs / aggregate sync state. Every new or changed public table access will include grants and RLS restricted by organization and hotel scope.
- No fork and no duplicated SLNT page. Branch only at the tenant adapter/feature boundary.

## 6. Validation before enabling

- Shared sync: user A syncs both accounts; user B reloads and sees the same successful time with no prompt. Simulate one account failure and confirm “1/2 accounts” rather than success.
- Classification fixtures: checked-in stayover, arrival not checked in, scheduled 10:00 departure, confirmed departure, delayed departure, early departure, status 7 cancelled, and status 8 no-show.
- Live SLNT verification: compare Sobi, K4 Room 4, and K4 Room 5 against Previo after refresh; confirm the board bucket exactly matches current API lifecycle state.
- RTC round trip: scheduled departure stays held; confirmed departure becomes RTC; supervisor approval changes clean locally and in the correct Previo account.
- Assignment: phone and desktop, single unit, full venue, mixed venues, scoped supervisor, ineligible housekeeper, reload recovery, Apply/Undo/Discard.
- Revenue: account-level totals reconcile independently, combined inventory equals the mapped active SLNT units, cancellation/no-show rows are excluded from occupied nights, and a one-account failure does not overwrite the last complete combined snapshot.
- Regression: run the existing Ottofiori and RD Hotels PMS, RTC, Team View, and Revenue flows and confirm unchanged queries, labels, account resolution, and write targets.