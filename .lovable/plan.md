# Revenue Management for Top Management + accurate, mobile-first rate grid

## Goal

Top management becomes "manager role + Revenue module": full manager powers in Housekeeping, plus a Revenue Management section scoped to the hotel they are logged into. The Revenue module itself gets accurate occupancy, occupancy-based pricing per room type, a smarter pickup horizon, a cleaner header, and mobile-first charts. Admins keep the advanced tabs and multi-hotel view.

## What will change

### 1. Top management = manager access
Today `HousekeepingTab` treats `top_management` / `top_management_manager` as "executive read-only", which is why dirty linen and other actions do nothing. That flag will be removed for these roles so they get the exact same Housekeeping capabilities a manager has (assignments, dirty linen, minibar, approvals, notes).

### 2. Revenue entry point: one click, auto-sync, straight into the hotel
- The Revenue Management tab for a top manager no longer opens the multi-hotel list with Open / Sync buttons. It routes directly to `/{org}/revenue/{their hotel}`.
- On arrival, a sync runs automatically with an engaging progress UI (staged steps: room types → rates → reservations → analytics, with live status and a friendly failure state + Retry).
- Once the sync finishes, the Rate Grid renders. Rate Grid becomes the default landing page for top management after login.
- Admins keep the existing multi-hotel overview and can still open any hotel.

### 3. Tab visibility
For top management the Revenue section shows only the Rate Grid (plus the header KPIs). Calendar, Strategy Calendar, Events, Analyst, Pricing Strategy and Sync history stay admin-only. Everything a top manager can see is scoped to their own hotel.

### 4. Header cleanup
The top block (reference room / base reference price / explanation paragraph, plus the Week–Month–Quarter–Year and Bulk Edit / Pull / Autopilot / Push cluster) is condensed into a single compact bar: hotel name, date range control, last-sync chip, and one primary action. Advanced actions collapse into an admin-only overflow menu. Explanatory text moves into an info tooltip.

### 5. Occupancy-based pricing per room type (Previo-style grid)
Instead of one "2 guests" filter, the grid mirrors the Previo Pricelist layout: each room type becomes a group with one sub-row per occupancy level it supports (1 guest, 2 guests, 3, 4…), each showing the Previo price for that date and occupancy. Room-type headers stay sticky on scroll. Data already exists per occupancy in the rates table; the sync will be extended to make sure every occupancy level Previo publishes is stored, not just the default.

### 6. Accurate occupancy (incl. today, and same date last year)
Current occupancy is computed from booked room-nights over a static room count, which is why today reads 44% when Previo shows a different figure. The plan:
1. Verify against the live Previo API which call returns the same numbers as the Previo occupancy report (the report page itself is a UI, not an API, so this must be confirmed before wiring).
2. Store that authoritative occupancy per stay date, plus the same date one year earlier, in the daily snapshot table.
3. The grid and charts read the authoritative value where present, and clearly fall back to the derived one otherwise.
This diagnosis is based on how occupancy is currently derived; the exact Previo endpoint to use is confirmed in step 1 before any UI change.

### 7. Pickup: today by default + richer periods
- Pickup defaults to **today** (bookings created today), not yesterday.
- A period selector: Today, Yesterday, This week (Mon–Sun), This month, Custom range.
- The Pickup & occupancy horizon chart follows the same selection.
- Additional decision-support surfaced alongside: pickup vs. same period last year, occupancy vs. last year, ADR / RevPAR trend, on-the-books pace, and strongest stay dates.

### 8. Sync status pill
The "Sync failed" pill only appears when a sync for the hotel the user is currently in has actually failed on the Previo side (housekeeping or revenue). Unconfigured, unsupported, or never-run states show as neutral, not red.

### 9. Mobile-first
Charts, the rate grid and the calendars are reworked for phones: horizontal scroll with frozen date/room-type columns, larger tap targets, responsive chart heights, and no controls that require hover or drag.

### 10. Per-organization feature flags
Admins get a setting, when creating or editing an organization/hotel, to toggle modules (starting with the Revenue module) on or off. Revenue is enabled for Hotel Ottofiori and stays available for future RD Hotels / SLNT properties once an admin flips it on. Revenue-related code paths resolve the hotel and organization generically, so a newly configured hotel with valid Previo credentials works without further code changes.

## Technical notes

- Roles: remove `isExecutiveReadOnly` gating for `top_management` / `top_management_manager` in `HousekeepingTab`; add a shared helper in `src/lib/roleAccess.ts` (`hasManagerPowers`, `canSeeRevenue`, `isRevenueAdmin`) and use it in `MainTabsBar`, `Revenue.tsx`, `RevenueHotelDetail.tsx`.
- Routing: `Revenue.tsx` redirects non-admin revenue users to `/{org}/revenue/{profile.assigned_hotel}`; landing-page resolution for top management points at that route.
- Sync UX: a new `RevenueSyncGate` component wraps the detail page, invokes `previo-revenue-sync`, and renders staged progress; the page mounts when the sync resolves (or is skipped if data is fresh).
- Occupancy: extend `previo-revenue-sync` to pull authoritative occupancy + LY occupancy into `revenue_daily_snapshots` (migration for the added columns), and update `buildDayMetrics` in `src/lib/revenueAnalytics.ts` to prefer it.
- Rates: extend the sync so all occupancy levels are persisted in `revenue_room_type_rates`; `RateStrategyGrid` renders grouped room-type/occupancy rows instead of a guest filter.
- Pickup: parameterise `useRevenueHotelData` with a `{from,to}` booked-on window instead of `pickupWindowDays`; shared period picker feeds the grid, `PickupHorizonChart` and `PickupRangeSummary`.
- Feature flags: store module toggles in `organization_settings` / `hotel_configurations` settings JSON with an admin UI in organization/hotel management; a `useModuleEnabled('revenue')` hook gates the tab.
- Sync pill: `LiveSyncContext` distinguishes "not configured / unsupported / never run" from real failures; `LiveSyncIndicator` only renders the destructive state for real failures on the active hotel.

## Sequencing

1. Roles + routing + tab visibility + feature flag (fast, unblocks top management).
2. Sync gate UI and header cleanup.
3. Previo occupancy verification, then accurate occupancy + LY comparisons.
4. Occupancy-based Previo-style rate grid.
5. Pickup period selector and extended analytics.
6. Mobile polish pass across grid and charts.
