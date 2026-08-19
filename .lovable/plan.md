# Make the Revenue page open fast

## What happens today

Opening a property does a lot of work before anything useful is on screen:

- The page waits on a full first payload of ~190 days of booking nights, snapshots, rates, cancellations and pickup movements — each paged 1000 rows at a time.
- A second metadata load pulls 15 queries over a +/-395 day window (up to 10,000 rows for pickup and occupancy snapshots) before the screen settles.
- An automatic Previo sync starts immediately on open. When another user already holds the sync lease, the page enters a waiting loop and shows the blocking "Another user is refreshing this property…" card for up to 2 minutes.
- The blocking cover is shown whenever there is no room-type data yet, so a cold open (or a slow first query) shows the greeting card instead of the page.

## Changes

1. **Never block on someone else's refresh**
   - Remove the up-to-2-minute waiting loop from the opening path. If another user holds the lease, load whatever is cached, show the thin top progress bar, and quietly re-read data when the other sync finishes.
   - Keep the greeting cover only for a genuinely empty property (nothing cached at all), and give it a short ceiling before falling through to the normal page.

2. **Paint the visible window first**
   - Fetch a short first window (about 60 days, matching what the calendar shows) so the grid appears quickly, then extend to the full horizon in the background without clearing the screen.
   - Keep the existing scroll-driven horizon growth on top of this.

3. **Defer the heavy metadata load**
   - Split the 15-query load into a small "needed to render" group (hotel config, revenue settings, room types, min-stay, alerts) and a deferred group (±395 day pickup/occupancy snapshot history, recommendations, adjustments, events) that runs after first paint or when the tab that needs it is opened.
   - Narrow the default history window and row limits to what the visible view uses; widen only when the user navigates to past months or opens YoY/MoM.

4. **Start the Previo sync after the screen is up**
   - Run the automatic freshness check after the cached data is painted, not before, and keep it fully non-blocking.
   - Manual **Sync now** stays immediate and keeps its progress UI.

## Technical details

- `src/pages/RevenueHotelDetail.tsx`: drop the `already_running` polling loop in `runSync` (replace with a lightweight background re-check), tighten the blocking-cover condition, split `loadForHotel` into `loadEssentials` / `loadDeferred`, and move the auto-sync effect behind first paint.
- `src/hooks/useRevenueHotelData.ts`: support a staged horizon (short first fetch, background extension) reusing the existing request-version guard so a late response can't overwrite newer data.
- No changes to Previo credentials, pricing, automation, tenant isolation, or the database.

## Validation

- Cold open of a property renders the grid shell with cached numbers in a fraction of the current time.
- Opening while another user is syncing shows the page immediately, not the waiting card.
- Scrolling to 6/9/12 months still loads dates automatically.
- Manual Sync now, price pushes, and pickup dots behave as before.
