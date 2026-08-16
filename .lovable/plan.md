# Direct, informative Revenue loading and reliable pickup

## 1. Send top management straight to the working Revenue page

The current login path is a confirmed double hop:

```text
/ → /:organization → /:organization/revenue → /:organization/revenue/:hotelId
```

The middle `/revenue` route is the portfolio/admin screen shown in the annotated screenshot. It waits for an asynchronous hotel lookup before forwarding top-management users, while `RootRedirect` and `TenantRouter` currently return nothing during authentication, creating visible blank intervals.

- Resolve the selected/assigned hotel once in the authenticated landing decision and navigate top management directly to `/:organization/revenue/:hotelId`.
- Keep `/:organization/revenue` as the portfolio screen for technical admins only; top management will never render it first.
- Preserve the current tenant and per-tab property rules, including strict organization/hotel checks.

## 2. One engaging loading experience, never empty metrics

- Reuse and extend the existing welcome overlay as the single first-load experience for authentication, route resolution, property alignment, cached-data lookup, and Previo refresh.
- Show real staged status messages such as “Opening Hotel Ottofiori”, “Loading saved prices and occupancy”, “Checking for newer Previo data”, and “Preparing the rate calendar”.
- Keep the detailed Revenue UI hidden until the minimum complete payload is ready: property identity, room inventory, rates/reservations, and calculated metrics. Errors or partial data will get an honest retry/status state instead of KPI cards filled with dashes.
- Use the current skeleton only beneath the full-screen waiting state; cached complete data may appear immediately while a non-blocking refresh continues.
- Make the quote deterministic for the Budapest calendar day so it changes daily rather than randomly on every mount. Request and cache one short AI-generated hospitality/revenue quote per day, with the existing curated quotes as an instant fallback so AI never delays login.
- Fix the current sync failure handler where `.catch()` is called on Supabase’s non-Promise query builder; failed refreshes must release the lease and transition the waiting UI to a retry state.

## 3. Make the KPI strip smooth on mobile

The continuous frame loop is gone, but the strip still performs programmatic smooth scrolling every 4.5 seconds while it is in view. That motion can overlap a vertical gesture and still feel stuck.

- Remove automatic/programmatic scrolling entirely on mobile.
- Keep native momentum horizontal scrolling, snap points, dots, and a visible portion of the next card; vertical page scrolling will have no JavaScript writer competing with it.
- Update the active dot with a low-cost scroll-end/settled calculation only.
- Verify vertical swipes beginning over the KPI strip scroll the page naturally, while deliberate horizontal swipes remain responsive.

## 4. Restore trustworthy positive and negative pickup from Previo

The live data confirms the missing-negative root cause for Ottofiori:

- The latest sync completed, but `revenue_cancelled_nights` has no August cancellation rows.
- The saved Previo cancellation probe records both cancelled/no-show filters as unsupported (`null`).
- The calculator switches to `created bookings − explicit cancellations` whenever creation timestamps exist. Because creation timestamps are present but cancellation rows are absent, this path cannot produce negative pickup.
- The older `pickup_snapshots` feed is stale, and the current Aug 15→16 daily snapshots show no negative source for the affected dates. The UI therefore has no negative number available to display.

Changes:
- Make each successful Previo sync persist a timestamped, report-equivalent net movement per stay date by comparing the current reservation set/count with the immediately previous successful sync before replacement. Do not depend on unsupported cancellation-status filters.
- Keep stable identity at reservation + stay date, while retaining quantities for multi-room reservations, so room-key changes cannot create false losses.
- Use this durable sync-to-sync movement as the authoritative pickup source for both gains and losses; booking creation/cancellation details remain explanatory metadata, not a gate that suppresses snapshot losses.
- Write the result to the existing pickup history pipeline and have the Rate & Pickup calendar, month KPI, movement board, and horizon chart consume the same source/window semantics.
- Preserve every intraday capture needed for “Today” instead of replacing the only comparison point, and aggregate all captures since Budapest midnight.
- Add reconciliation diagnostics to the sync result: current reservations, gained, lost, net, unsupported cancellation API status, and last successful capture. Surface a compact freshness/source label in the waiting state and pickup UI.
- Correct the existing tooltip DOM nesting warning in the horizon chart while touching that display.

## 5. Verification

- Test fresh login and restored-session login as top management: one direct destination, no portfolio flash, no white frame, and accurate staged progress.
- Test first load, cached load, slow sync, sync failure, expired session, and property switching on a 440px mobile viewport.
- Compare Ottofiori’s same-period positive/negative per-date totals against the Previo pickup report and retain a regression fixture covering cancellation loss, same-day gain plus loss, room-key change, and multi-room bookings.
- Confirm all four Revenue pickup surfaces show identical values for the same selected window.
- Verify mobile KPI behavior with vertical and horizontal gestures and confirm no console/runtime/DOM-nesting errors remain.

## Technical scope

Likely files: `src/App.tsx`, `src/pages/Index.tsx`, `src/pages/Revenue.tsx`, `src/pages/RevenueHotelDetail.tsx`, `src/components/revenue/WelcomeBackOverlay.tsx`, `src/components/revenue/RevenueSkeleton.tsx`, `src/components/revenue/MonthPerformanceHeader.tsx`, `src/components/revenue/PickupHorizonChart.tsx`, `src/hooks/useRevenueHotelData.ts`, `src/lib/revenueAnalytics.ts`, and `supabase/functions/previo-revenue-sync/index.ts` plus focused tests. A database migration will only be added if the existing pickup history table cannot safely retain the required intraday sync captures after its constraints are inspected.