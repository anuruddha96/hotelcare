# SLNT: compact unit overview, real Previo clean/RTC status, working Revenue sync

All changes are gated to the SLNT organization. Ottofiori, RD Hotels and every other tenant keep their current layout, sync rules and revenue ingestion.

## Verified current state

- The SLNT board renders one bordered block per venue, stacked vertically (`HotelRoomOverview.tsx`, `renderTodayVenueRows`). With ~20 venues and 61 units this is a very tall page, and the drag source (a venue header near the top) is far from the housekeeper cards, which is why dragging a whole venue is effectively impossible.
- Clean status from Previo *is* fetched (`previo-pms-sync` maps `roomCleanStatusId` 2/3 to `Clean`), but `pmsRefresh.ts` overrides it: `pmsNeedsCleaning` (any checkout or daily unit today) forces `dirty` unless the unit was cleaned in HotelCare today. So WR Pension 101/102, marked Clean in Previo, stay dirty in HotelCare.
- Revenue sync failure cause is in the logs: `previo-pull-revenue` inserts `bookings_last_year: null` and `delta: null`, but both columns are `NOT NULL DEFAULT 0` on `pickup_snapshots`, so every pickup insert is rejected (`null value in column "bookings_last_year" ... violates not-null constraint`). The `hotel/pricelist: 404` line is a separate, non-fatal probe.

## 1. One-screen unit overview (SLNT only)

- Replace the stacked per-venue blocks with a dense flow: venue name becomes an inline colored pill directly followed by its unit chips on the same wrapping line, so short venues no longer each consume a full row.
- Lay the venue groups out in 2 columns on tablet and 3 on desktop (single column on phone) so the whole portfolio fits in roughly one screen.
- Shorten chip labels by stripping the repeated venue prefix (e.g. "St King 11 – Room 3" shows as "3" inside the "St King 11" group); full name stays in the tooltip and in the selection tray.
- Add a density/expand toggle so a manager can switch back to the roomier view; remember the choice locally.

## 2. Make venue-to-housekeeper assignment actually possible

- Keep tap-to-select as the primary flow: tapping a venue pill selects all its units, and the sticky assignment tray stays pinned so the housekeeper choice is always one tap away regardless of scroll position.
- Add a persistent drop dock: when a drag starts, a sticky bar of housekeeper drop targets (name, @username, venue scope, current load) appears at the bottom of the viewport, so a venue can be dropped without dragging across the whole page.
- Keep the existing auto-scroll and staged-assignment/auto-restore behaviour; Apply stays one batch action.

## 3. Reflect Previo clean/dirty and RTC on every sync

- For SLNT, treat Previo's room clean status as authoritative when it is newer than local state: if Previo reports Clean and no checkout has been confirmed after the last clean, the unit becomes clean in HotelCare (clearing RTC and any untouched cleaning assignment) instead of being forced back to dirty.
- Keep the existing protection in the other direction: a unit cleaned and approved in HotelCare today is never re-dirtied by a sync, and a Previo-confirmed departure after the clean does re-open a checkout clean.
- RTC continues to require a confirmed departure (or manager release); a Previo "Clean" flag on a departed unit closes the RTC task rather than keeping it open.
- Supervisor approval keeps pushing clean back to the owning Previo account (unchanged round trip).

## 4. Fix the Revenue Management sync

- Stop writing `null` into the not-null `bookings_last_year` / `delta` columns — write 0 (or omit the fields and let the defaults apply) and derive last-year values where a prior-year snapshot exists.
- Surface insert failures in the function response instead of only logging them, so a partial failure shows as a clear message rather than a generic non-2xx.
- Re-run the SLNT two-account pull after the fix and confirm both Previo profiles merge into one portfolio snapshot; keep the last complete snapshot if one account fails.

## 5. Technical changes

- `src/components/dashboard/HotelRoomOverview.tsx` (venue flow layout, chip label shortening, density toggle), `src/components/dashboard/HousekeepingManagerView.tsx` and the assignment tray (sticky drop dock).
- `src/lib/pmsRefresh.ts` clean-status resolution, gated by the SLNT tenant feature flag.
- `supabase/functions/previo-pull-revenue/index.ts` pickup snapshot insert + error reporting.
- No database migration expected; if last-year pickup needs persisting, it reuses existing `pickup_snapshots` columns.

## 6. Validation

- Board: SLNT portfolio visible with at most minimal scrolling on desktop; venue tap selects all units; drag a venue onto a docked housekeeper on both phone and desktop.
- Clean status: WR Pension 101 and 102 show clean in HotelCare right after a sync; a unit cleaned in HotelCare stays clean; a new confirmed departure re-opens the checkout clean and RTC.
- Revenue: SLNT sync returns 2xx, pickup rows are inserted, both accounts appear in the combined figures.
- Regression: Ottofiori and RD Hotels board layout, clean-status behaviour and revenue sync unchanged.
