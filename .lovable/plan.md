# Faster Previo publishing, a stable rate calendar, and pickup automation

## Confirmed findings

- **Bulk publishing is doing too much serial work.** For every date + room type, `revenue-push-drafts` currently reads Previo rates, sends one EQC message, reads Previo again, then updates local rows one at a time. Even 2–3 days can create many sequential external and database calls, which explains the function timeouts and non-2xx errors.
- **The November prices are already in HotelCare’s database.** For 11 November 2026, all five Ottofiori sellable room types have stored rates and their Previo room-type IDs correctly match `room_types`. The grid therefore needs a display/freshness fix rather than another room-name mapping workaround.
- **Refresh currently replaces the calendar with a loader.** `useRevenueHotelData.reload()` sets `loading=true`, and `RateStrategyGrid` hides the entire grid whenever that flag is true. This causes the disappearing/reappearing effect.
- **Pickup timestamps are available.** `revenue_booking_nights.created_at_pms` contains the latest booking time per stay date, including new pickups today, so the pickup row can show an accurate Budapest date/time.
- **The current autopilot is not the requested rule engine.** It detects generic snapshot surges and can create recommendations, but it does not apply configurable booking-window tiers to every room type, nor reliably publish the resulting room-type rates to Previo.
- Ottofiori currently has autopilot and automatic PMS publishing disabled. The new rules will remain opt-in until an eligible user explicitly enables them.

## 1. Replace the slow price-write path

- Build one EQC `AvailRateUpdateRQ` payload per Previo account containing multiple date/room-type changes, while retaining complete, gap-free occupancy ladders required by Previo error 3092.
- Stop reading the same room type separately before and after every edited cell. Use HotelCare’s latest stored occupancy ladder as the unchanged baseline, send it once with the edits, and confirm the accepted batch asynchronously through the normal Previo rate sync.
- Split very large edits into bounded batches by payload size/count and process a small number concurrently. Return per-batch and per-draft results so one rejected room type does not fail every other price.
- Add an idempotency/run identifier and claim drafts before sending, preventing duplicate writes when a user retries after a timeout.
- On EQC success, immediately mark drafts as sent, update HotelCare’s local visible rates from the exact accepted payload, write the audit trail, and queue reconciliation. Only genuine Previo rejections remain failed/reviewable.
- Make the frontend submit manageable chunks with visible progress and retry only failed chunks rather than resending successful prices.

## 2. Keep the rate calendar stable and complete

- Preserve the last successful room types, rates, metrics, and rendered grid during background refresh; show a small in-place “Refreshing” indicator instead of replacing the calendar.
- Deduplicate the fetched rates by cell using the newest `updated_at/captured_at`, without filtering out a valid room type merely because one refresh response is temporarily empty.
- Ensure the November data already stored for Ottofiori remains visible across the selected 6-month range and after a push/reload.
- Add regression coverage for the five Ottofiori room-type IDs and for a date such as 11 November where valid PMS rates must render.

## 3. Manual, recent, and automated price markers

- Keep the existing manual-change marker attached to each price cell, on mobile and desktop.
- Use **blue** for a manual change made within the last 4 hours and **light orange** after 4 hours. Add both meanings to the legend. Four hours is a practical operational handover window and matches the requested threshold.
- Give confirmed automated pickup changes a separate semantic colour, with a tooltip/tap detail showing the rule, pickup time, previous rate, increase, resulting rate, and confirmation state.
- Do not let broad bulk edits erase or recreate the short-range manual markers.

## 4. Pickup visibility and filtering

- Add the latest pickup date/time in Europe/Budapest to each date’s Pickup cell, using `created_at_pms` from the newest booking night for that stay date.
- Add a compact filter: **All dates / Dates with pickup**. It will use the currently selected pickup window and preserve chronological order.
- Highlight pickup cells whose latest booking is recent, without hiding their count or gain/loss value.

## 5. Pickup-only automation rules

- Add an Automation Rules panel inside the Rate & pickup calendar for eligible users.
- Rules are hotel-scoped and configurable: enabled state, booking-window bands, increase amount, same-hour window, second-pickup surcharge, minimum ADR/safety cap, and automatic publishing.
- Seed Ottofiori’s editable example only after the user saves/enables it:
  - first pickup, stay within 1 month: **+€8** to every room type for each stay date in the reservation;
  - first pickup, 2–3 months out: **+€18**;
  - first pickup, farther out: **+€22**;
  - second pickup for the same stay date within 60 minutes: add a further **+€25**, making the near-term cumulative change **+€33**.
- Detect pickups from newly ingested reservation nights, not aggregate snapshot guesses. A multi-night reservation applies the appropriate rule independently to every stay date it covers.
- Deduplicate by hotel + reservation + stay date + rule version so sync retries cannot raise a price twice.
- For each matched pickup, create a transparent automation run/action record, calculate all room-type occupancy ladders, publish immediately to Previo, update HotelCare’s rates, and record confirmed/failed outcomes.
- Users can inspect what happened and manually override any resulting rate. Automation takes no action on dates without pickup.

## 6. UI fixes from the screenshots

- Make **Expand/Close** a visually prominent primary control with clear active/full-screen state.
- Rework the mobile price-edit dialog footer so actions stay visible, do not overlap content, and clearly separate **Save draft** from **Send to Previo**.
- Apply the same active blue navigation treatment to Revenue Management and Purchase Invoices that users already see in Housekeeping, across both navigation implementations.
- Keep mobile cell tap history and long-hold + horizontal slide selection working alongside the new pickup filter and markers.

## Database and backend changes

- Add hotel-scoped pickup automation rule and automation-run/action tables with explicit authenticated/service-role grants, RLS using hotel/organization access helpers, timestamps, rule versions, and unique deduplication keys.
- Add a lightweight reconciliation state to price-push runs/drafts if the existing draft columns cannot represent claimed, sent, confirmed, partially failed, and retryable states cleanly.
- Refactor `_shared/previoRateWrite.ts` to build and send bounded multi-update EQC payloads; keep XML escaping, gap-free occupancy validation, and account separation.
- Refactor `revenue-push-drafts` around batch claims, local confirmation, per-item outcomes, and deferred Previo reconciliation.
- Extend the scheduled pickup automation function to evaluate saved rules and call the same batch publisher, rather than maintaining a second write implementation.

## Verification

1. Automated XML tests: multiple dates, multiple room types, complete occupancy ladders, multiple Previo accounts, payload chunking, and partial rejection parsing.
2. Push tests: 2–3 days, then a large multi-month edit; verify no timeout, no duplicate send on retry, accurate draft statuses, and local prices updated immediately.
3. Re-sync and compare accepted prices against Previo; mismatches become explicit reconciliation failures rather than disappearing drafts.
4. Calendar tests: background refresh never removes the grid; 11 November Ottofiori rates remain visible; pickup-only filter and Budapest timestamps are correct.
5. Automation tests: +8/+18/+22 lead-time bands, second pickup cumulative +33 near-term, multi-night stays, all room types, duplicate event suppression, manual override, disabled rules, and failed Previo publishing.
6. Responsive browser checks for mobile long-hold selection, cell history, edit dialog actions, markers/legend, highlighted Expand/Close, and active navigation.

## Delivery order

1. Batched/idempotent Previo publisher and status reconciliation.
2. Stable calendar refresh and missing-rate display regression.
3. Pickup timestamps/filter, marker ageing, and UI/navigation fixes.
4. Automation schema, rule editor, pickup event processing, auto-publish, and audit display.