
## Scope

Four connected improvements to the Revenue module on `RevenueHotelDetail.tsx`. UI-first work plus one edge-function wiring. No schema rewrites — only one small additive table for Previo rate-plan mapping.

---

## 1. "Run autopilot now" — fully working flow

Today `AnalystPanel` already invokes `revenue-autopilot-tick` and reloads its own decision/velocity lists, but the parent page's `recs`, `rates`, and `abnormalDates` stay stale.

Changes:
- Promote the autopilot trigger so it also refreshes the parent grid.
  - Add `onAfterRun?: () => void` prop to `AnalystPanel`. After a successful invoke, call `onAfterRun()` so `RevenueHotelDetail` re-runs `load()`.
  - Add a small "Run Autopilot" button in the header bar of `RevenueHotelDetail` (next to "Pull from Previo") that calls the same handler — gives one-click access without switching tabs.
- Show live state during the run:
  - Disabled button + spinner on both the header button and the Analyst panel button.
  - Sonner toast: "Autopilot running…" → success summary `N decisions · M surges · K recs created`.
- Surface results immediately:
  - After invoke, refetch `rate_recommendations`, `pickup_snapshots`, `revenue_alerts`, `autopilot_decisions`, `booking_velocity_events` for this hotel.
  - Newly created pending recs render as orange chips on the calendar without a manual reload.
- Failure handling: show edge-function error message verbatim and keep the prior state.

---

## 2. Strategy Calendar with per-day rate, pickup, occupancy

`CalendarYearView` already exists but only colors cells by rate-delta. Upgrade it into the requested calendar view.

Changes (in `src/components/revenue/CalendarYearView.tsx` plus a new `StrategyCalendar.tsx` wrapper):
- New `StrategyCalendar` component that renders 1, 3, or 12 months in a responsive grid and reuses `rowsByDate` from the page.
- Each day cell shows three stacked micro-rows when the cell is large enough (month/quarter view):
  ```
  €145              ← rate (or suggested in italics)
  ▮▮▮▮▯ 78%       ← occupancy bar (5-segment)
  +3 ↑ / surge     ← pickup chip + autopilot icon if a decision exists
  ```
  In year view (small cells) keep the current heatmap and add a small bottom dot for pickup (green/red) and ring for events.
- Hover tooltip lists: rate, suggested rate (with delta), occupancy %, pickup delta, last autopilot decision reason if any.
- Clicking a cell opens the existing day-detail Sheet (already wired via `selectedDate`).
- New "Strategy" tab in `RevenueHotelDetail` (between Pickup and Analyst) that mounts `StrategyCalendar` with view selector (Month / Quarter / Year). Existing month grid in the Prices tab stays unchanged.

---

## 3. Strategy tab connected to live decay/surge data

The same Strategy tab also acts as the "rules vs recommendations" review surface.

Changes:
- A header strip above the calendar shows live engine config from `hotel_revenue_settings`:
  - Floor price, max daily change, weekday/weekend decay, surge thresholds, autopilot enabled flag.
- A right-rail panel (collapsible) lists the next 90 days of pending `rate_recommendations` joined with `autopilot_decisions`:
  - Date · current → recommended · delta · driver chip (Decay / Surge / Manual / Event) · reason.
  - Approve / Reject buttons per row (reuse existing `approve`/reject mutations).
  - "Approve all decay ≤ €X" and "Approve all surges" bulk actions.
- Driver chip is computed from `decision_type` (autopilot rows) or fallback heuristics on the rec's `reason` text.
- All data already comes from the existing `load()` Promise.all — no extra queries beyond joining `autopilot_decisions` by `(hotel_id, stay_date)` in memory.

---

## 4. Push to Previo / PMS — rate-plan mapping + wiring

Today `previo-push-rates` is a 501 stub. Add the mapping layer so it can be turned on per hotel without further schema work.

Database (one small additive migration):
- New table `previo_rate_plan_mapping`:
  - `hotel_id` (text), `organization_slug` (text)
  - `room_type_id` (uuid → `room_types.id`)
  - `previo_rate_plan_id` (text), `previo_room_type_id` (text)
  - `is_default` (bool), unique on (`hotel_id`, `room_type_id`)
- RLS: admin/top_management of the hotel's org can read/write; restricted by `organization_slug` and `assigned_hotel` (matches existing patterns).

Admin UI:
- New "Previo mapping" sub-section inside `RoomsSetupTab` for admins: list room types, allow entering `previo_rate_plan_id` + `previo_room_type_id`, mark default. Stored via supabase client.

Edge function `previo-push-rates`:
- Inputs: `{ hotel_id, stay_dates?: string[] }` (defaults to all `approved` recs in next 90 days).
- Steps:
  1. Auth via existing `_shared/previoAuth.ts`.
  2. Load mapping rows for `hotel_id`. If none → return 412 with a clear "configure mapping" message (UI shows toast linking to settings).
  3. Load approved recs not yet pushed (use new column `pushed_at timestamptz null` on `rate_recommendations` — added by the same migration).
  4. For each rec × mapping row, call Previo's rate update endpoint (`setPrice` / `updateRate` — exact path read from `PREVIO_RATE_UPDATE_PATH` env var so we can flip without a redeploy when Previo confirms it).
  5. On success: set `pushed_at = now()`, write `rate_history` row with `source = 'previo_push'`. On failure: keep status, log to `pms_sync_history` with `error_message`.
- Return summary `{ pushed, failed, skipped }`.

Frontend wiring:
- The existing "Push to Previo" button in `RevenueHotelDetail` header calls the function; on 412 (no mapping) toast offers a link to the Rooms Setup tab.
- Show last push timestamp pulled from `pms_sync_history` with `sync_type = 'rate_push'` next to the button.

Note: Previo's exact endpoint and payload schema still need confirmation. The mapping table, `pushed_at` column, RLS, and UI are independent of that and ship now. The function reads the endpoint from a secret/env var, so when Previo's docs are confirmed only the URL and request body shape change — no redeploy of UI needed.

---

## Files touched

New
- `src/components/revenue/StrategyCalendar.tsx`
- `src/components/revenue/StrategyRecommendationsPanel.tsx`
- `src/components/revenue/PrevioRatePlanMapping.tsx` (used inside `RoomsSetupTab`)
- `supabase/migrations/<ts>_previo_rate_plan_mapping.sql`

Edited
- `src/pages/RevenueHotelDetail.tsx` — Run Autopilot header button, new Strategy tab, refresh wiring, push-status indicator
- `src/components/revenue/AnalystPanel.tsx` — `onAfterRun` callback
- `src/components/revenue/CalendarYearView.tsx` — richer cell rendering for large views
- `src/components/revenue/settings/RoomsSetupTab.tsx` — mount mapping editor
- `supabase/functions/previo-push-rates/index.ts` — full implementation

## Out of scope
- Changing the autopilot decay/surge algorithm (already shipped).
- New schema beyond the mapping table + `pushed_at` column.
- Migrating other hotels — Previo push stays opt-in per hotel via `is_engine_enabled` + presence of mapping rows.
