# Revenue Management: navigation, sync throttle, and grid usability

## 1. Top managers stuck in Revenue (confirmed root cause)

`src/pages/Index.tsx` redirects every executive role to `/{org}/revenue` unconditionally. The Housekeeping / Reception / Maintenance / HR tabs navigate to `/{org}?tab=housekeeping`, which lands on Index and bounces straight back to Revenue.

Fix: only redirect when no `?tab=` parameter is present (first landing). Once a tab is requested, render the dashboard normally. Executives keep Revenue as their landing page but can freely move between all legacy tabs.

## 2. Sync runs every time the RM section opens

`RevenueHotelDetail` auto-syncs on mount for any non-revenue-admin user. Changes:

- Skip the auto sync if the last successful revenue sync for that hotel is under 15 minutes old.
- Manual "Sync now" always runs, regardless of age.
- Show a clear line in the header: "Last synced 4 min ago by Petra K." — read from `pms_sync_history` (`sync_type = revenue_sync`), resolving the triggering user's name from the record's stored user info; when unknown, show "automatic".
- Store who triggered the sync in the sync history record going forward.

## 3. Room type names wrapped / cut off in the grid

In `RateStrategyGrid`, the frozen left pane is too narrow and truncates names ("Deluxe Twin R…"). Changes:

- Widen the frozen column on desktop, keep it compact on mobile.
- Show the full translated name over two lines instead of a hard truncation, with the room count badge on its own line.
- Keep the tooltip with the original PMS name so the source is visible.

## 4. Month missing on the grid top row

The sticky month label currently sits only in the frozen corner cell. Add a proper month band above the date row inside the scrolling pane: contiguous date columns grouped under "August 2026", "September 2026" …, sticky while scrolling, so the month is always visible.

## 5. Pickup & occupancy horizon chart improvements

- Default range 60 days (instead of 30), with 14 / 30 / 60 / 90 / 180 / 365 options.
- Month separators drawn on the X axis, with month labels beneath.
- Add an ADR line (right axis) alongside occupancy, toggleable together with pickup and occupancy via chips.
- Richer tooltip: date, day of week, pickup (new − cancelled), occupancy %, ADR, RevPAR.
- A short "what this shows" caption naming the data source and measurement window.

## 6. Writing prices back to Previo

Current state: the app already stores every manual price edit as a draft (`revenue_rate_drafts`) and `revenue-push-drafts` sends them to Previo. It cannot succeed yet because the Previo rate-write endpoint path is a placeholder (`PREVIO_RATE_UPDATE_PATH`), unlike room status which uses a documented Previo method.

Plan:
- Keep the draft → review → push flow as-is.
- Add a clear in-app banner in the push dialog when the endpoint is not yet configured, explaining that writing rates is pending Previo activation, so nobody thinks a push silently worked.

What to request from Previo (I will also surface this text inside the app's Pricing Strategy tab):
1. Enable **rate/price write access** for the Ottofiori hotel account on the same API credentials already used for the room-status write.
2. The exact **method name and endpoint path** for updating a nightly price (equivalent of their pricelist update), plus a sample request/response.
3. Whether prices are set per **rate plan × room type × date × occupancy**, and the ID list for each rate plan and room type.
4. Whether updates support a **date range** in one call or must be per-date.
5. Confirmation of the **currency** expected (EUR) and whether taxes/breakfast are included in the pushed value.
6. Any **rate restrictions** (min stay, closed-to-arrival) that must accompany a price change.

## 7. Stronger, self-explanatory editing tools

- Cell editing: click a price cell to open an editor that supports setting one date, or applying the same price/percentage change across a selected date range and occupancy levels at once.
- Bulk actions bar: select a date range and apply "+10%", "-5%", or a fixed price to a whole room type.
- Every panel in the RM section gets a short one-line explanation plus a "Source" note (Previo pricelist, Previo pickup report, or calculated in Hotel Care), with the formula shown for calculated values (ADR, RevPAR, occupancy, pickup).

## Technical notes

Files touched: `src/pages/Index.tsx`, `src/pages/RevenueHotelDetail.tsx`, `src/components/revenue/RateStrategyGrid.tsx`, `src/components/revenue/PickupHorizonChart.tsx`, `src/components/revenue/RevenuePulsePanel.tsx`, `supabase/functions/previo-revenue-sync/index.ts` (record triggering user). No schema changes required beyond writing the triggering user into the existing `pms_sync_history.data` JSON.
