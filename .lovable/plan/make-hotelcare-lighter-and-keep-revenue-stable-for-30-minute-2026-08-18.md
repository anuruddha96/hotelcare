# Make HotelCare lighter and keep Revenue stable for 30 minutes

## Goal
After the initial load, keep the working screen stable and responsive. A property may refresh automatically once per shared 30-minute freshness window, while manual **Sync now**, realtime notifications, and price-confirmation updates continue to work immediately.

## Changes

1. **Make the 30-minute rule real in the Revenue page**
   - Replace the Revenue page’s five-minute timer with the existing shared `REVENUE_STALE_MS` 30-minute rule.
   - Check the shared property sync timestamp without reloading the calendar when the property is still fresh.
   - Only run the full Previo pull and reload Revenue data when this property is actually stale; the existing database lease remains the cross-user/cross-tab owner lock.
   - Keep manual **Sync now** forced and immediate.
   - Remove the blocking “welcome back” refresh overlay for ordinary tab returns. Returning to a fresh tab should show the existing screen immediately; stale data can refresh without replacing the whole interface.

2. **Remove duplicate data fetches and focus refreshes**
   - Stabilize `useRevenueHotelData.reload` so changes to loaded row counts do not recreate the callback and trigger another full fetch.
   - Coordinate the Revenue page metadata load and calendar-data load so a genuine sync produces one refresh cycle instead of repeated overlapping cycles.
   - Add in-flight request deduplication and ignore stale responses after a property switch.
   - Stop refetching the full profile on every visibility change when the active session and tab-scoped property are unchanged; retain session-expiry protection with a cooldown.
   - Leave lightweight event-driven updates intact, including notifications, audit updates, and active price confirmation checks.

3. **Reduce initial application work**
   - Keep route-level lazy loading so login does not download Revenue, reservations, invoices, training, and assistant screens before they are needed.
   - Mount authenticated polling/subscription providers only after authentication and only on routes/roles that use them.
   - Load only the active language pack at startup instead of evaluating all large translation collections together, with the existing English fallback retained.
   - Avoid starting non-critical training, location, assistant, and notification UI work on the login route.

4. **Make the Rate & Pickup calendar stay fluid**
   - Virtualize the date columns with a small overscan buffer so 90–180-day views keep their full logical range without mounting every off-screen cell.
   - Memoize stable row/cell structures and avoid rebuilding history, marker, event, and safety maps when unrelated page state changes.
   - Replace selection painting’s full-grid `querySelectorAll` scan on every animation frame with indexed visible-cell updates limited to the changed selection rectangle.
   - Keep native horizontal scrolling in control until a long-press selection is confirmed; guarantee gesture cleanup on touch end, cancellation, visibility change, and property/range changes.
   - Stop silently expanding a mobile calendar to six months at the scroll edge; longer ranges remain explicitly selectable and are rendered through the virtualized window.
   - Preserve single-cell editing, sold-out-cell selection, date-range selection, hover history, event bands, zoom, and optimistic price updates.

5. **Keep background services proportional**
   - Prevent dashboard-only auto-assignment polling from running on the Revenue route.
   - Preserve event-driven Supabase Realtime subscriptions rather than replacing them with polling.
   - Keep the faster checkout poll only while unresolved checkout work exists; idle operation remains on the 30-minute cadence and must not reload the Revenue screen.

## Technical details

- Reuse `claimRevenueSync`, `fetchRevenueSyncInfo`, and `REVENUE_STALE_MS`; no new Revenue freshness system is needed.
- Add request/version refs or abort guards around property-bound loads so an older hotel response cannot overwrite the newly selected hotel.
- Calendar virtualization must preserve the complete date/row indexes used by bulk pricing while rendering only the visible slice.
- No tenant, role, Previo credential, pricing, pickup, or hotel-isolation rules change.
- No new database tables are expected.

## Validation

- Open the same property in two tabs/users and confirm only one automatic Previo refresh can run in a 30-minute window.
- Leave Revenue open for over 30 minutes: no five-minute screen refreshes, blocking overlays, or calendar resets occur; one stale refresh runs when due.
- Switch away and back repeatedly: profile/property state remains stable and no duplicate full Revenue loads occur.
- On a 440×807 phone, continuously swipe the calendar left/right, interrupt gestures, long-press-select, cancel, and resume scrolling without lockups.
- Test 30-, 90-, and 180-day ranges on mobile and desktop; verify DOM/render work stays bounded while all dates remain reachable and editable.
- Confirm manual **Sync now**, realtime price history, pending confirmation updates, notifications, and sold-out bulk edits still work.
- Compare startup network/chunk loading before and after: login loads only its required route and active-language resources.