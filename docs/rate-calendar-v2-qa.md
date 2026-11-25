# Rate Calendar V2 QA

Validate these scenarios before merging.

## Desktop
- 1366×768 and 1440×900: Rate & Pickup card uses the available viewport cleanly and keeps sticky month/date/signals aligned.
- Horizontal mouse/trackpad scrolling remains smooth.
- Price cell click, whole-day edit, bulk edit, long range selection, activity drawer, min stay editing and Expand mode still work.
- Pickup / occupancy / left-to-sell / minimum-stay / demand / events remain visible and aligned.

## Mobile portrait
- Horizontal swipes move dates.
- A normal first vertical swipe may move through room rows.
- At the top/bottom of the calendar, a vertical swipe moves the page immediately.
- A second quick vertical swipe (within 700 ms) moves the page even if the calendar is mid-scroll.
- Long-press date selection and long-press cell-range selection still take priority over page handoff.
- No frozen or dead scrolling after cancelling a touch gesture.

## Mobile landscape / rotated
- Explanatory legend text is hidden to reclaim height; rate intelligence rows remain present.
- The calendar remains vertically usable and horizontal dates remain scrollable.
- Page escape gesture works as in portrait.

## Regression safety
- No rate publishing, Previo API, Supabase, pickup calculation, occupancy calculation or automation logic changed.
- Test both iOS Safari and Android Chrome where possible.
