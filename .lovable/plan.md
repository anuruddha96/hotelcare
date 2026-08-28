# Remember the price a room type sold out at

## What happens today

The "Sold out" badge in the Rate & pickup grid shows the room type's **current** top-occupancy price, read live from the price map. So when a bulk edit, a manual change or the automation moves the price afterwards, the sold-out badge moves with it — the rate the day actually closed at is lost.

Rooms-left is not stored anywhere: it is derived in the browser (`RevenueHotelDetail.tsx`) as room-type capacity minus booked nights. Nothing in the database records a sell-out moment.

## What to build

**Freeze the closing price the first time a room type reaches zero rooms left on a date.**

- The moment a room type/date has no rooms left, HotelCare records the price live at that instant (per guest count) as the "sold at" price, with the timestamp.
- That stored price never changes while the date stays sold out — bulk updates, manual edits and automation runs no longer alter it.
- If a cancellation reopens the date, the frozen record is released; if it sells out again later, a new closing price is captured.

## How it looks in the grid

- Sold-out inventory cell: **"Sold out"** with the frozen price underneath (as today, but now stable), labelled as the closing rate.
- Tooltip on the cell: "Sold out on 5 Sep — closed at €298 for 2 guests (captured 27 Aug 14:10). Current rate €341."
- Price rows for a sold-out date keep showing the current live rate, so the two numbers sit side by side: what it sold for vs. what it is priced at now.
- If no closing price could be captured (date sold out before the feature, or no price on record), the badge shows "Sold out" alone — no fake number.

## Technical notes

- New table `public.revenue_soldout_prices`: `hotel_id`, `organization_slug`, `room_type_name`, `stay_date`, `occupancy`, `price`, `currency`, `captured_at`, `released_at`; unique on (hotel, room type, stay date, occupancy) for active rows. Grants for `authenticated` (read) and `service_role` (write); RLS scoped by `organization_slug` + hotel, matching the other revenue tables.
- Capture runs server-side at the end of a revenue sync, inside the published-payload refresh (`refresh_revenue_published_payload` path): for each sellable room type/date where booked nights ≥ capacity and no active row exists, insert the current `revenue_room_type_rates` price per occupancy. Where rooms become available again, mark the row released.
- The payload gained by `get_revenue_published_payload` carries a `soldOutPrices` array so the grid reads frozen prices from the same dataset it already loads (no extra request); `useRevenueHotelData.ts` passes it through.
- `RateStrategyGrid.tsx` replaces the `closedAt` derivation (currently the live top-occupancy price) with a lookup into the frozen map, falling back to nothing when absent.
- Pricing engines are untouched — this is a record-only feature; sold-out dates continue to be priced by existing rules.
