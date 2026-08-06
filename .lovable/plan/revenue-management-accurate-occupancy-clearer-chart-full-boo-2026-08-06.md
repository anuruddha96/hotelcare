# Revenue Management: accurate occupancy, clearer chart, full booking feed

## 1. Occupancy discrepancy vs Previo (confirmed root cause)

Comparing your Previo pricelist screenshot with our data for Otto Fiori:

```text
Date     6    7    8    9    10   11   12   13   14   15   16
Previo   100  71   100  81   81   81   81   95   76   67   57
HotelCare100  71   95   81   76   76   76   91   71   67   57
```

On the differing days we are exactly one room-night short. The reservation
importer stores booked nights in a map keyed by `reservation id + stay date`,
so when one Previo reservation holds **more than one room** (multi-room /
group booking), the second, third… room silently overwrite the first and only
one room-night survives. Days with no multi-room booking (6, 7, 9, 15, 16)
match Previo exactly, which confirms it.

Fix: key each night by reservation **plus the individual room item**
(`objId` / room-item index), parse every room block inside a reservation, and
store one row per room per night. The stored table already has a per-room key,
so no data model change is needed beyond writing the room identifier
correctly. After the fix a re-sync will bring occupancy in line with Previo,
and a one-line check will confirm the two now agree day by day.

## 2. Today shows 2 bookings instead of 3 (confirmed root cause)

The third reservation (7 nights, 11–18 Oct, created 06/08 at 00:20) exists in
our database. The Bookings panel filters "created today" using UTC, so a
booking made at 00:20 Budapest lands in the previous UTC day and disappears.

Fix: bucket booking creation by Budapest date everywhere (panel filter, pickup
windows and the chart), so "Today" matches Previo's booking-date filter.

## 3. Booking status / cancellations in the feed

Add a Status column to the Bookings panel: Confirmed, Option, Cancelled,
No-show — with a coloured badge, and a filter to show or hide cancelled ones.
Cancelled bookings are already stored separately; they will be merged into the
feed rather than hidden, so a day that gained two and lost one reads honestly.

## 4. Pickup & occupancy horizon chart

- Legend swatch will match the bars (single decision colour: green for
  positive pickup, red for negative, grey for zero) — no more black swatch.
- Legend becomes clickable: click Pickup / Occupancy / ADR to hide or show
  that series. Choices persist for the session.
- Decluttering when all three overlap: pickup bars sit in their own lower band
  of the plot, lines get lighter grid and thinner strokes, a single combined
  tooltip lists all values for the hovered date, and the redundant top toggle
  buttons are removed now that the legend does the job.

## 5. Pickup detail summary

New "Pickup detail" list beside the chart:

```text
Arrival date | Bookings picked up | Rooms | Room types | Booked on (date + time)
```

- Defaults to today's pickup, with a range switch (today / yesterday / 7 / 14 /
  30 days) and "only days with pickup" so you instantly see which arrival dates
  are gaining bookings and can raise those prices.
- Each row expands to the individual reservations behind it (time, room type,
  nights, guests, value).
- A "Raise price" shortcut jumps to that date in the rate calendar.

## 6. Mobile and desktop polish

- Chart, bookings feed and pickup detail collapse to single-column cards on
  mobile with horizontal scroll only inside tables, never the page.
- Panels are collapsible with counts in the header, so the page opens compact
  and expands on demand instead of showing every table at once.

## Technical notes

- `previo-revenue-sync`: per-room parsing, night key `res_id|obj_id|stay_date`,
  populate `obj_id`, `stay_from`, `stay_to`, `status_id`, `source_name`.
- `revenueAnalytics.ts`: Budapest-day bucketing for `created_at_pms`, shared by
  metrics, pickup windows and panels.
- `PickupHorizonChart.tsx`: controlled legend with `onClick` hide/show, cell
  colours reused for the legend payload, split plot bands.
- `TodaysBookingsPanel.tsx`: Budapest date range, status column, cancelled
  rows merged from `revenue_cancelled_nights`.
- New `PickupDetailPanel.tsx` grouping `revenue_booking_nights` by arrival date
  within the selected creation window.
