# Make the Ottofiori pickup story read honestly

## What the data actually says

I checked the live Previo-backed tables for Ottofiori (19 Aug, 06:56 Budapest):

- Reservations created **today**: none. The newest booking was created 18 Aug at 19:19 Budapest.
- Reservations created in the **last 48 hours**: 27 bookings covering 66 room-nights (17 Aug 06:00 through 18 Aug 19:00).
- Cancellations in the same 48 hours: 16 reservations, 41 room-nights.

So both numbers on the page are correct. The header tile is locked to "today" (0 sales), while the calendar's PU row is on the "Last 48 hours (automation)" window and is showing real movement from 17-18 August. Nothing is inflated — the two panels are just measuring different periods, and the page never says so clearly.

## What to change (presentation only)

1. **Make the header tile follow the window selector.** The selector directly above it already says "Booked in: Last 48…", so the first KPI card should honour it: relabel to "Bookings created · last 48 hours" (or whatever window is chosen) and count reservations, room-nights, revenue and cancellations over that same window instead of the Budapest calendar day. When the window is "Today only", the wording stays "created today".

2. **Show today alongside it.** Keep the calendar-day figure as the tile's sub-line ("0 today") so a manager can still see that nothing sold this morning without losing the 48-hour context.

3. **Label the PU row with its window.** Add the active window to the PU row's left-hand label in the grid (e.g. "PU · 48h") and keep the existing per-cell timestamp, so a "+3" on a date with no sales today is self-explanatory.

4. **Explain the gap once, in the tile's info popover.** Replace the current "This tile always shows today" text with a short note: bookings are counted by creation time inside the selected window; a busy 48 hours with a quiet morning is normal.

## Technical notes

- `src/components/revenue/MonthPerformanceHeader.tsx`: `bookedToday` is hardcoded to `budapestDayOf(...) === today`. Reuse `pickupWindowStartMs(pickupWindowDays)` from `src/lib/revenueAnalytics.ts` so the tile shares one window rule with the rest of the page; keep a separate today-only count for the sub-line.
- `src/components/revenue/RateStrategyGrid.tsx`: PU row label only; the cell values and colours stay as they are.
- No backend, engine, or database changes — the sync data is correct.
