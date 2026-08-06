# Revenue Management: pickup visibility, clarity, and a live booking feed

## 1. Previo write access (rate push)

Status today: the app already has the full push pipeline (`revenue-push-drafts` edge function, draft review bar in the grid). The only missing piece is the exact Previo XML method name/schema for writing a nightly price, which is held in a placeholder secret.

Planned action: probe the Previo API with the existing authenticated client to list the available methods for the hotel's login and report back exactly which pricing write method (if any) is exposed. If a write method is confirmed, wire it into the push function and enable the "Push to Previo" flow. If it is not exposed, the app will show a clear note in the grid saying pushes are read-only until Previo enables the pricing scope, and provide the exact request text to send Previo.

## 2. Pickup bars invisible in "Pickup & occupancy horizon"

Cause: pickup bars share the left axis with ADR. ADR runs 110–220, pickup runs 0–3, so the bars are flattened to nothing at the bottom.

Fix: give pickup its own dedicated axis, move ADR to the right axis alongside occupancy (scaled independently), and render pickup with a minimum visible bar height and clearer colour. Zero days show a faint placeholder tick so the reader can tell "no pickup" from "no data".

## 3. Yesterday's pickup + customisation

Add to both the horizon chart and the rate calendar the same measurement-window options:
- Today, Yesterday only, Last 2 / 3 / 7 / 14 / 30 days, and a custom "N days back" input.
- The two panels stay in sync so the calendar and chart always describe the same window.
- A caption states in plain words what the window means, e.g. "counting bookings created yesterday".

## 4. Explain the "26 to check" warning

That badge counts calendar cells whose price is below the hotel's critical safety-net threshold — typically a human typo (2 EUR, 8 EUR) or a rate that was never loaded. It is a review prompt, not an error.

Changes:
- Rename to "26 prices to review".
- Clicking it filters the grid to only those dates/room types.
- Tooltip explains: "Prices below your critical threshold (set in Revenue settings). Usually a typing mistake or a missing rate — review before they sell."

## 5. Colour the ADR and RevPAR rows

Give the ADR and RevPAR rows a distinct tinted background and a left accent so they read as summary rows, clearly separated from the editable rate cells. Pickup and Occupancy rows keep their current heat colours; the summary rows use a neutral tint with only the value text colour-graded.

## 6. Today's reservation flow panel

New "Bookings created today" panel under the grid, modelled on the Previo booking list in the attachment. Columns:

```text
Created  |  Stay dates  |  Nights  |  Room  |  Guests (pax)  |  Price  |  Source/OTA
```

- Data comes from reservations already synced from Previo (creation timestamp, stay range, room type, guest count, nightly/total price).
- Customisable: date filter (today / yesterday / custom day or range), sort by any column, and a totals line (bookings, room-nights, revenue, average length of stay, average rate).
- Source/OTA is included only if Previo returns it on the reservation record; the sync will be extended to capture it. If it is not present in the API response, that column is omitted rather than guessed, and I will say so.

## Technical notes

- `PickupHorizonChart.tsx`: three-axis layout (pickup left, occupancy right 0–100, ADR right secondary), shared window state lifted to `RevenueHotelDetail`.
- `RateStrategyGrid.tsx`: shared `PICKUP_WINDOWS` list incl. yesterday/custom, review-filter state, summary-row styling tokens.
- New `TodaysBookingsPanel.tsx` reading `revenue_booking_nights` grouped by `res_id` (`created_at_pms`, `guests`, `nightly_price_eur`, `room_type_name` already stored).
- `previo-revenue-sync`: capture reservation source/partner/channel field if present in the XML, and persist total price plus stay range per reservation.
