# Revenue Management: mobile-first rate grid, decision colours, alerts, translations

## 1. Notifications

Toasts currently stay on screen with no way to dismiss them (the morning PMS prompt uses a 30s duration, others use defaults).

- Global Sonner config: auto-dismiss after 5s (8s for warnings/errors), close button on every toast, swipe-to-dismiss on mobile, max 1 visible (existing rule).
- Action toasts (e.g. "Refresh now") keep a longer life but also get the close button.

## 2. Rate & pickup calendar — mobile-first

- Fix the frozen left column: rebuild the grid as a two-part layout (fixed room-type/metric column + horizontally scrolling date pane) instead of relying on `position: sticky` inside the table, which is what is failing today. Room types, Pickup, Occupancy, ADR and RevPAR labels stay put while dates scroll.
- Sticky month indicator: the month label stays pinned at the top-left of the scrolling pane and updates as you scroll, so you always know which month you are in.
- Auto-extend horizon: scrolling near the right edge while on 14d/30d automatically loads the next range (30d → 60d → 90d → 120d) and updates the range chips.
- Mobile ergonomics across the whole RM section: larger tap targets, compact 2-line date headers, horizontal snap scrolling, collapsible room-type groups, and controls that never need hover (all tooltips also open on tap).

## 3. Colour coding and safety net

- Admin-configurable thresholds per hotel (Revenue settings → "Safety net"):
  - Rate floor / suspicious rate (e.g. below €40 → red, below €60 → amber), plus max sensible rate.
  - Occupancy bands (e.g. <40% red, 40–70% amber, >85% green).
  - Pickup bands (negative red, flat neutral, strong positive green).
- The grid paints rate cells, the occupancy row and the pickup row using those bands, kept deliberately simple: three-step colour, no gradient noise.
- Alerting: when a sync (or a manual edit) detects a rate below the safety floor, admins and top managers for that hotel receive a Hotel Care branded email via Resend, plus an in-app warning banner on the affected dates. De-duplicated so the same date/room type does not re-alert within 24h.

## 4. Pickup / occupancy / RevPAR summary panel

A "Today's activity" card above the grid:

- Every stay date that picked up (or lost) bookings today, regardless of horizon — date, net pickup, new vs cancelled, revenue added.
- Today's and tomorrow's occupancy, ADR, RevPAR, plus 7d and 30d rolling occupancy/ADR/RevPAR and pace vs. the same period last year where snapshots exist.
- Empty state when nothing moved today.

## 5. More decision-support (industry-standard RM views)

Added for admins and top managers, built from the data already synced:

- Booking pace curve (on-the-books by lead time) vs. last year.
- Occupancy / ADR / RevPAR trend chart with switchable metric and range.
- Day-of-week and lead-time performance breakdown.
- Room-type mix: share of rooms sold and revenue per room type.
- Pickup heat calendar (month view) and a "needs attention" list (low rate, low occupancy close-in, sudden cancellations).
- Customisation: metric selector, range selector, and show/hide of grid rows, remembered per user.

## 6. Room-type name translation (OpenAI)

Previo returns Czech/Hungarian room-type names ("Luxusní tříl��žkový pokoj").

- New edge function `translate-room-types` using the project's `OPENAI_API_KEY` (direct OpenAI, not the Lovable gateway) that translates room-type names into the app's supported languages and stores them on the room type (`name_translations` JSONB), translating only names it has not seen before.
- Runs after each revenue sync and on demand from Rooms Setup; admins can override any translation manually.
- The whole RM section is wired to the app's translation system so labels, headers and metric names follow the selected language like the rest of the app.

## 7. Editable rates pushed to Previo (research first, then build behind a flag)

- Step 1: confirm against the Previo API whether a single price for one room type / occupancy / date can be written back (the project already has `previo-push-rates` and `previo-pull-rates` — verify the exact call and required rate-plan identifiers before building UI).
- Step 2 (if supported): eligible users can tap a cell, edit the price, and the change is stored locally as a draft with old → new value and author. Drafts auto-save without touching Previo.
- Step 3: an explicit "Review & push" dialog lists every pending change (date, room type, occupancy, old price, new price) and pushes only on confirmation, with a full audit trail and a result summary per change.

## 8. Room 104 not turning clean — root cause investigation

Room 104 was cleaned in Hotel Care but stayed dirty until reception fixed it manually. Before changing anything, trace that room's actual records (room row, assignment, completion, sync history, Previo push queue) to establish whether the local status never flipped, or it flipped and a later PMS refresh overwrote it, or the Previo status push failed. The fix follows the finding, and the same class of path (all rooms whose status is written back to Previo) is covered, not just room 104.

## 9. Navigation for top managers

Both revenue pages already render the app header and main tab bar in the code. Verify in the live app which route top managers actually land on and whether the current build is published; then make sure header (hotel switcher, language switcher, logout) and the legacy tabs are reachable from every revenue screen, including the hotel list and any redirect target.

## Technical notes

- Frontend: `RateStrategyGrid` split into a virtualised two-pane grid component; new `RevenuePulsePanel`, `RevenueInsights` charts (recharts), `SafetyNetSettings` tab; shared `useRevenueThresholds` hook; Sonner defaults in `App.tsx`.
- Database: `hotel_revenue_settings` gains safety-net threshold columns; `room_types.name_translations` JSONB; `revenue_rate_drafts` and `revenue_rate_alerts` tables (with GRANTs + RLS for admin/top management).
- Edge functions: `translate-room-types` (OpenAI), `revenue-rate-alert` (Resend branded email), extend `previo-revenue-sync` to trigger both; `previo-push-rates` extended for per-cell pushes after the API check.

## Sequencing

1. Notification behaviour + top-manager navigation verification (quick).
2. Room 104 root cause.
3. Grid rebuild: frozen column, sticky month, auto-extend, mobile.
4. Colour bands + safety-net settings + email alerts.
5. Today's activity panel + extra analytics.
6. Room-type translations + RM i18n.
7. Previo write-back research, then cell editing with draft/confirm push.
