# Make the PU row and the automation dots tell the same story

## What is actually happening

The calendar and the automation count pickup two different ways, so they legitimately disagree:

- The PU row counts **reservations, net of cancellations, per Budapest calendar day**, over the window in the "Pickup: Today" selector (default: today only).
- The automation counts **new booking nights over a rolling 48-hour window** (`pickup_lookback_hours`), gross, with no cancellation netting and no day boundary.

Consequences you are seeing:

1. A booking taken yesterday at 21:00 is inside the automation's 48h window but outside "Today", so the price rises with an empty PU cell.
2. One booking plus one cancellation on the same date nets the PU cell to `.` (or negative) while the automation still raised, because it only looks at arrivals.
3. A purple dot with no pickup is often the **markdown** pass ("no new booking arrived…"), which is a price change caused by the *absence* of pickup — correct, but it reads as unexplained.
4. Date-header dots only reflect changes made **today**, so a date whose last automation move was last night shows nothing while its cells still carry markers.

## What will change

### 1. A pickup window that matches the engine
Add a "Last 48 hours (automation window)" option to the pickup selector and make it the default for the Rate & pickup calendar. It counts the same rolling 48h of new booking nights the engine uses, so a raise always has a visible number behind it. The existing calendar-day options stay available for reporting comparisons against Previo.

### 2. Show gross and net, not just net
When cancellations offset arrivals on a date, the PU cell shows the net value as today plus a small "+2 / −2" breakdown in the hover card, so a raise on a net-zero date is explainable at a glance.

### 3. Honest dot semantics
- Cell dots keep meaning "who last moved this price".
- Date-header dots switch from "changed today" to "changed within the pickup window currently selected", so the header and the cells can no longer disagree.
- Markdown-driven automation changes get a distinct, muted purple treatment in the hover card wording ("lowered because nothing picked up") so a purple dot on a zero-pickup date reads as intended behaviour, not a bug.

### 4. Trigger evidence in the hover card
Every automation change already stores the booking id and pickup timestamp that triggered it. The unified hover card will surface one line — "triggered by booking #… picked up 17 Aug 21:04 (within 48h)" — so any dot can be traced to a real booking even when the PU cell is empty.

## Technical notes

- `src/lib/revenueAnalytics.ts`: add an hours-based pickup mode alongside the existing day-window mode; return `{ net, gained, lost }` per date instead of a single number.
- `src/components/revenue/RateStrategyGrid.tsx`: new window option and default, PU cell breakdown, header dot window derived from the selected pickup window, hover-card trigger line.
- `src/lib/rateMarkers.ts`: `dayMarkers` takes a window in milliseconds instead of the hard-coded Budapest day start.
- No changes to the automation engine's pricing decisions and no database or Edge Function changes — this aligns what the screen reports with what the engine already does.

## Out of scope

Tuning when the automation raises or lowers prices. If, after the numbers line up, a specific raise still looks wrong, that becomes a separate rules change.
