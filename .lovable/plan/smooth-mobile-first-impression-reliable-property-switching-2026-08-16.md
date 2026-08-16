# Smooth mobile first impression + reliable property switching

## 1. The KPI strip that "feels stuck"

The occupancy/RevPAR card strip at the top of Revenue currently runs two
competing animations at once: a `requestAnimationFrame` loop that writes
`scrollLeft` on every single frame (about 18px per second), plus a
window-scroll listener that pushes the same strip sideways by 35% of the page
scroll. Two writers fighting over the same scroll position on every frame is
exactly what produces the heavy, laggy feel on a phone — and it also competes
with the browser's own scrolling.

Changes:
- Remove the per-frame `scrollLeft` writing and the scroll-linked sideways
  nudging entirely. The strip becomes a normal, finger-friendly horizontal
  carousel: momentum scrolling, snap points per card, and a small row of dots
  so it is obvious there are more cards.
- Keep an optional gentle auto-advance, but implemented as one discrete
  card-to-card `scrollTo({behavior:"smooth"})` every few seconds instead of a
  continuous frame loop; it stops permanently as soon as the user touches the
  strip, and never runs when the strip is off-screen or reduced-motion is on.
- On phones, show the two most important tiles first so the key number is
  readable without scrolling at all.

## 2. No more blank page while data loads

Today the Revenue page renders its real layout with empty values while the
30-minute-cached data is fetched, so the first impression is a page of blanks.

Changes:
- Add a skeleton state that mirrors the final layout (header strip, calendar
  rows, chart blocks) with soft shimmer placeholders, shown while the hotel
  data hook is loading and no cached data is present yet.
- When cached data from the previous visit is available, show it immediately
  with a subtle "refreshing" shimmer over the affected numbers instead of
  wiping them to blank.
- Same skeleton treatment for the dashboard cards on the mobile landing view,
  so the first screen after login is never empty.

## 3. Property switching

Two separate problems are visible in the screenshots:

- The switcher writes the new property to the account, waits ~0.9s, then does a
  full page reload (`location.replace`). On mobile that reboot re-runs auth,
  the service worker and every query — which is why the "Switching to Hotel
  Mika Downtown" curtain sits there and can end on a white page.
- The overlay has no timeout or failure path: if the reload is slow or the
  session has gone stale in a backgrounded tab (the console shows
  "Session expired while tab was backgrounded"), the curtain never clears and
  the user taps again, producing the "worked after several attempts" behaviour.

Changes:
- Switch in place instead of reloading: after the tab's property choice is
  stored and the account row updated, update the in-memory profile and let the
  data hooks refetch. No `location.replace` on ordinary pages.
- Only change the URL when the current route is bound to the old property
  (`/:org/revenue/:hotelId`), and do it with client-side navigation to the
  equivalent route for the newly selected property — so the slug never keeps
  pointing at the previous hotel.
- Give the curtain a hard ceiling (about 8 seconds). If data has not arrived by
  then, dismiss it and show a clear retry message rather than an endless
  spinner or a white screen.
- Refresh the session before the profile write when the tab has been
  backgrounded, so an expired token surfaces as a normal re-auth instead of a
  silent failure.
- Keep the existing per-tab behaviour intact: each tab remembers its own
  property, and switching in one tab must not drag other open tabs along.

## Technical notes

- `src/components/revenue/MonthPerformanceHeader.tsx`: delete the rAF
  auto-scroll and window-scroll effects, add snap/momentum classes and a dot
  indicator, optional interval-based advance.
- `src/components/layout/HotelSwitcher.tsx`: in-place switch, route-aware
  navigation via `useNavigate`, timeout on `HotelSwitchOverlay`, session
  revalidation before the update.
- `src/hooks/useAuth.tsx`: expose a way to apply the newly selected hotel to the
  in-memory profile without a full reload.
- New shared skeleton components under `src/components/revenue/` reused by
  `RevenueHotelDetail.tsx` and the mobile dashboard.
- Presentation and client-state only: no schema, RLS, or Edge Function changes.
