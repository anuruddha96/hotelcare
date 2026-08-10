# Previo-accurate revenue data and a director-ready workflow

## Goal
Make Hotel Care agree with Previo, eliminate stale draft indicators after accepted price writes, simplify the Revenue page for top management, and replace the crowded movement feed with a reservation-led table.

## Confirmed current-state findings
- For Ottofiori on 10 Aug, the database contains **7 distinct Previo reservations, 10 reserved room groups, and 35 room-nights**. The current “Bookings created” KPI groups by `reservation + room`, so the four-room reservation is counted four times and produces 10 instead of Previo’s 7.
- There are currently **32 Ottofiori rows still marked `draft` whose new price already exactly matches a fresh `source = previo` price**. Revenue sync refreshes live prices but does not reconcile matching draft statuses.
- The push path can leave duplicate/stale local rate rows because its cache update and its fallback upsert use different identity rules; the grid then receives multiple prices for one cell without a deterministic newest-row choice.
- Top management currently shares `isRevenueAdmin` with admins, so technical actions and tabs are exposed unless each area is separately gated.

## Implementation

### 1. Match Previo’s reservation numbers
- Change Today’s Sales to count unique Previo `res_id` values as **Bookings created**.
- Preserve multi-room economics: continue counting every reserved room-night for room nights, revenue, ADR, occupancy, and chart totals.
- Show the room-group count only as secondary context when a reservation contains multiple rooms, so the 7 reservations / 10 rooms distinction is clear rather than misleading.
- Keep all creation timestamps and period boundaries in `Europe/Budapest`.

### 2. Make pushed/draft state self-healing
- In `revenue-push-drafts`, update the canonical local live-rate row using the same hotel/date/Previo room/rate-plan/occupancy identity used by the database conflict key, preventing stale parallel rows.
- Make rate loading deterministic and deduplicate each grid cell by the newest `captured_at`/`updated_at` row.
- After every successful Previo revenue/rate pull, reconcile outstanding `draft` or `failed` rows: when Previo’s current price equals the requested `new_price`, mark the draft `pushed`, set `pushed_at`, and clear the error. Never auto-clear a non-matching draft.
- Return reconciliation counts in sync history for support visibility, then refresh both rates and pending drafts in the UI after push/sync.
- Keep failed or genuinely unconfirmed changes visible and retryable.

### 3. Add bulk remove to “Send price changes to Previo”
- Add row selection, select-all for the current list, and **Remove selected** with a confirmation step.
- Retain the existing single-row delete control.
- Remove only selected unsent/failed drafts; pushed history remains intact.

### 4. Director-ready top-management view
- Keep full Revenue access and contextual price editing for eligible top-management roles, but reserve technical configuration for `admin` only.
- Hide from top management: reference-room/base-price banner, Pull rates, Autopilot, legacy Push, Calendar, Strategy Calendar, Events, Analyst, Pricing Strategy, and Sync history.
- Keep the clean operational path: hotel title, freshness/sync action, performance overview, Today’s Sales, Rate & pickup calendar, pickup/occupancy horizon, reservation movements, and contextual repricing with confirmation.
- Keep admin visibility unchanged so admins can decide/configure the hidden tools later.
- Give “How [month] is performing” restrained semantic colour: occupancy pressure, ADR/RevPAR performance, revenue, availability, and pickup use distinct success/warning/attention accents without turning the section into decoration.

### 5. Replace “What moved” with a Previo-style reservation list
- Build one row per Previo reservation rather than repeating it under every stay date.
- Columns: created date/time (Budapest), stay dates, nights, rooms, guests, room type(s), booking value, status, and a compact price action.
- Provide creation-window presets, gained/cancelled status filter, search, sortable columns, and a fixed-height scroll/pagination pattern suitable for many records.
- Multi-room bookings remain one expandable reservation row, with room-level details inside.
- “Adjust prices” opens the identified reservation stay range and relevant room type(s), shows the affected nightly prices, supports increase/decrease presets or custom value, and requires confirmation before sending to Previo.
- Keep gained/lost/net summary totals above the list, but derive rows from actual reservation/cancellation records instead of presenting a dense stay-date expansion.

## Technical scope
- Frontend: `TodaysSalesAdrGoal`, `PickupMovementBoard`, `RateStrategyGrid`, `MonthPerformanceHeader`, `RevenueHotelDetail`, and revenue data-loading helpers.
- Edge functions: `revenue-push-drafts` and `previo-revenue-sync` reconciliation.
- Database: no new table is expected; use the existing draft/live-rate columns and policies. If a missing uniqueness rule is confirmed during implementation, add only a safe deduplication/index migration after preserving the newest row.

## Verification
- Compare Ottofiori Today against the supplied Previo list: **7 bookings**, **35 room-nights**, and the same booking value/ADR, while retaining the four-room reservation’s full revenue and inventory impact.
- Push a multi-date, multi-occupancy change; verify Previo accepts it, Hotel Care displays the accepted prices, matching drafts disappear immediately, and a subsequent sync does not recreate the draft state.
- Seed one matching and one non-matching draft; verify sync clears only the matching one.
- Bulk-select and remove draft rows, then verify only selected rows disappear.
- Verify admin and both top-management roles separately on desktop and mobile, including reservation-level repricing and the hidden technical controls.