# Clear hotel context on mobile + charts that make sense

## 1. Show which hotel you are in (mobile)

Today the header squeezes the property name into a truncated `Hotel Memories…` under the logo, so on a phone you cannot tell which property you are looking at.

- Add a full-width hotel context bar directly under the header on mobile: property name (not truncated), plus a small "switch" affordance that opens the existing hotel switcher.
- Keep the desktop header as it is.
- The bar reads from the same resolved hotel name the header already loads, so it always matches the selected property (including after a switch).

## 2. Fix the "Pickup & occupancy horizon" chart

Problems found in the current chart:
- ADR is drawn on its own hidden auto-scaled axis, so the green dashed ADR line has no readable scale and spikes to the top of the plot on days where ADR data is thin or missing — that is why it looks like nonsense.
- Days with no ADR are connected across gaps, inventing a line where there is no data.
- Three series (pickup bars, occupancy line, ADR line) on one 60-day mobile plot is unreadable.

Changes:
- Give ADR a real, visible right-hand axis with a sensible domain, and make occupancy and ADR mutually exclusive on mobile: one right-hand metric at a time (the existing Occupancy / ADR buttons become a proper toggle instead of two independent on/off switches). On desktop both can stay.
- Do not connect ADR across days with no data; render those as gaps.
- Default the mobile view to a 30-day range so bars are wide enough to read.
- Rewrite the caption to plainly say what the bars and the line mean and where the numbers come from.

## 3. Fix "Today's sales performance"

Problems found:
- "Room nights" is plotted on the ADR (euro) axis, so a count of rooms is being measured in euros — meaningless, and it drags the ADR axis.
- Five overlapping series (window bars, running value area, compare line, ADR, room nights) on a phone-width chart.
- Left axis labels are clipped (`22000` shows as `2000`) because the axis width is too small for the values.

Changes:
- Remove "Room nights" from the euro axis; keep room nights as a number in the summary strip instead.
- On mobile show at most three series: booked-in-window bars, running booking value, and ADR against its target line. The compare/pace line moves behind a toggle.
- Widen and compact the value axis (e.g. `12k`, `22k`) so labels are never cut.
- Keep the ADR target reference line but position its label so it does not overlap the plotted lines.

## 4. Data sanity pass

Before finalising the visuals, verify against the live snapshots for the selected hotel that ADR and RevPAR per day are computed from the same room-night base (the screenshot shows a RevPAR of €1,053 in one month column, which suggests a divide-by-available-rooms issue on at least one property). Any mismatch found is fixed in the metric calculation, not hidden by the chart.

## Technical notes

- Files: `src/components/layout/Header.tsx` (or a new small `MobileHotelContextBar`), `src/components/revenue/PickupHorizonChart.tsx`, `src/components/revenue/TodaysSalesAdrGoal.tsx`, and `src/lib/revenueAnalytics.ts` if the RevPAR check confirms a calculation bug.
- Presentation only apart from item 4; no schema or Edge Function changes.
- Uses the existing `useIsMobile` hook for the mobile-specific chart simplifications.
