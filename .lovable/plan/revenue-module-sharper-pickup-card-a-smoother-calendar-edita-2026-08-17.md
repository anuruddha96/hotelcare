# Revenue module: sharper pickup card, a smoother calendar, editable availability and min stay, and trustworthy events

## 1. "Pickup in window" card tells the whole story

Today the card shows one net number. It will show the movement behind it, using the same data the "reservations moved" board already uses:

- Headline stays the net room-nights (e.g. `-1`).
- Below it: `3 reservations in · 4 out · net -1`, plus the number of distinct reservations created in the selected window (today by default).
- The tooltip explains the three figures in plain language.

No new data source: bookings created and rooms lost are already derived per stay date; the card aggregates the same values for the month.

## 2. Calendar horizontal movement

The Rate & pickup calendar becomes noticeably smoother:

- Momentum-friendly scrolling with CSS scroll-snap on the day columns, so the grid settles on a date instead of drifting.
- The left/right arrows animate the scroll instead of jumping, and a soft edge fade plus a subtle chevron pulse shows there is more to the left/right; both disappear at the ends.
- Wheel/trackpad handling reworked so horizontal intent scrolls the grid and vertical intent scrolls the page (no fighting on mobile).
- Drag-to-pan keeps working; on touch it uses native scrolling only, which is what makes phones feel fast.

## 3. New "Min stay" row under "Left to sell"

A house-level row showing the minimum number of nights required per date, editable inline (tap/click the cell, type a number, or use the bulk editor for a date range).

- Values stored per hotel + date, and pushed to Previo through the same EQC channel already used for prices (`AvailRateUpdate` carries length-of-stay restrictions alongside rate and inventory).
- Same confirmation behaviour as prices: the cell shows pending → confirmed, with the change recorded in the cell history.
- If Previo rejects the restriction call for a property, the row stays read-only for that property with a clear reason instead of failing silently.

## 4. Rooms to sell becomes editable per room type

On each room-type row, the "left" figure becomes an editable inventory control:

- Plus/minus stepper (and direct entry) to raise or lower rooms available for sale on that date/room type.
- The value is sent to Previo as an inventory update on the same EQC endpoint, then read back to confirm, exactly like a price push.
- Guard rails: cannot go below rooms already sold, whole numbers only, and multi-date ranges supported via the bulk editor.
- Every change is logged in the audit trail with who changed it.

## 5. Events & demand calendar that is actually correct

The current search asks the model from memory, which is why Sziget and the Wine Festival dates were wrong and why two searches for the same month disagreed.

Changes:

- **Web-grounded search.** The event search moves to a web-search-enabled call, so each event's dates come from a source page rather than recall. Every candidate carries its source link, and candidates without a usable source are dropped rather than shown.
- **Wider net.** The prompt asks for the full range — arena and club concerts, festivals, sport, congresses and trade fairs, public holidays, school breaks, and smaller published local events — for the exact city and month selected.
- **Deterministic results.** Fixed low-variance settings so the same month searched twice returns the same list.
- **No duplicates.** A uniqueness rule on hotel + date + title (case/accent-insensitive, with overlapping date ranges treated as the same event) blocks re-adding an event that already exists; the review list marks such rows as "already saved" instead of offering them again.
- **Review before save stays.** Nothing reaches pricing until approved; each row shows its source so a wrong date can be spotted and corrected before saving.
- **Manual correction.** Existing events become editable (dates, impact, recurrence) instead of delete-and-retype.

## Technical notes

- `MonthPerformanceHeader.tsx`: pickup tile gains gained/lost/reservation counts from the existing `DayMetrics` aggregation (`roomsGained`, `roomsLost`, distinct reservation ids in window).
- `RateStrategyGrid.tsx`: scroll container gets `scroll-snap-type: x proximity`, `scrollBy({behavior:"smooth"})` for arrows, reworked wheel handler, edge-fade overlays; new `MinStayRow` and inventory stepper inside the group rows.
- New table `rate_restrictions` (hotel_id, stay_date, room_type nullable, min_stay, rooms_for_sale, updated_by, sync state) with grants for `authenticated`/`service_role` and org-scoped RLS, plus reuse of `rate_change_audit` for history.
- `_shared/previoRateWrite.ts`: add `buildInventoryUpdateXml()` and `buildRestrictionUpdateXml()` (EQC `AvailRateUpdateRQ` with `<Inventory>` and `<RestrictionStatus>/<LengthOfStay>`), reusing the existing auth, retry and read-back verification path.
- New edge function `previo-push-restrictions` (min stay + inventory), queued through the existing publisher so long ranges batch like price pushes.
- `demand-events-search`: switch to the web-search tool with source URLs required, temperature 0, month+city scoped; server-side dedupe against `demand_events` before returning candidates; add a unique index on (hotel_id, event_date, normalized title).

## Suggested order

1. Pickup card content (small, immediate value).
2. Calendar scrolling and mobile feel.
3. Events accuracy + dedupe.
4. Min stay row with Previo write.
5. Editable rooms-to-sell per room type with Previo write.
