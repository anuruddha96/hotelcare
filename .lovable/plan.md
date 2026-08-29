# Ottofiori Revenue Automation V2 — correction pass

Ottofiori stays in shadow (`mode = 'shadow'`, `auto_publish = false`) for the whole of this work. No shadow price is published manually, and the automatic activation gate is blocked until every new check passes. Other hotels (Memories, Mika, Gozsdu, SLNT) keep `engine_version = 1` and are not touched.

## Confirmed current state (checked against the live database)

- Rule for `ottofiori`: `engine_version = 2`, `mode = shadow`, `auto_publish = false`, `shadow_started_at = 2026-08-29 07:38 UTC`, `maximum_increase = 25`.
- `runV2.ts` line 324: `max: Number(pick("max_price") ?? rule.maximum_increase ?? 100000)` — this is the €25 ceiling bug. `rule.maximum_increase` is a step limit, not a price ceiling.
- `revenue_rate_drafts` has none of `decision_id`, `decision_reason`, `reason_detail`, yet `runV2.ts` writes all three — a live run would fail on schema.
- `room_types` for Ottofiori: real rooms 1 + 4 + 10 + 1 + 5 = 21 (Ekonomický dvoulůžkový pokoj, Deluxe Queen, Deluxe Twin, Luxusní třílůžkový, Deluxe Čtyřlůžkový). Synthetic rows "Room (cap 2) — 15 units", "Room (cap 3) — 5 units", "Room (cap 4) — 1 units" still have `counts_toward_inventory = true` on several duplicates, giving 63. Breakfast, Coffee and Desserts, Látógatóközpont are already excluded.
- `revenue_price_floors` holds one Ottofiori row: reference occupancy 2, min €110, max €500, global safety max.

## 1. Price bounds — one source of truth

- New shared module `_shared/priceBounds.ts`: resolves floor/ceiling per hotel + room type + occupancy from `revenue_price_floors`, then `room_types.min_price_eur / max_price_eur`, then the hotel global safety max (€500). Step limits (`maximum_increase`, daily budgets) are never consulted for absolute bounds.
- Unresolvable bounds → hold the cell with reason `bounds_missing`; never guess a default.
- `max < min` on any cell → reject the whole stay date before queueing.
- Every child cell is priced and validated independently: integer, > 0, ≥ floor, ≤ ceiling.
- Shadow runs generate and persist the full simulated child-cell payload (same shape that would go to Previo) so the gate validates real output.
- Seed per-room-type/occupancy floor rows for the five real Ottofiori room types (reference 2-pax €110, ceiling €500, occupancy supplements as configured).

## 2. Draft schema and status lifecycle

Migration adds to `revenue_rate_drafts`: `decision_id uuid` (FK → `revenue_date_decisions`), `decision_reason text`, `reason_detail text`, plus an index on `decision_id`.

Statuses used strictly: `shadow` (simulated), `queued` (saved for delivery), `sending`, `published` (Previo-confirmed), `failed`. A date is marked published only after Previo confirmation; run totals for queued/published/verified/failed come from publisher results, not from queue creation.

Integration test inserts a full live-style batch (decision → drafts → push items) inside a transaction and rolls back, proving no missing-column failure.

## 3. Inventory correction

Data update (not deletion): all synthetic "Room (cap N)" rows for Ottofiori get `is_sellable = false`, `counts_toward_inventory = false`. Historical rate/decision records are untouched. Non-room products stay excluded.

New activation gate: countable inventory must equal exactly 21. Any other number keeps the engine in shadow or auto-pauses it.

## 4. Lead-time strategy

`_shared/engineV2.ts` window rules replaced with the seven Ottofiori bands exactly as specified: 0–2, 3–7, 8–30, 31–90, 91–180, 181–365 days, each with its own no-pickup wait, occupancy thresholds, pickup-count increments, pace-gap markdown conditions, minimum-rooms-left protection, decrease frequency limits and daily increase/decrease caps. The 31–90 one-off €5 increase on crossing 60% occupancy and the 181–365 anchor recalculation are implemented as stated. The old repeated €50 far-out top-up is removed entirely. All movements are whole EUR; minimum publishable delta €3.

## 5. Pickup identification

- `revenue_pickup_ledger.first_seen_at` written only on insert (`ON CONFLICT DO NOTHING`), never updated by later syncs; `pms_created_at` kept separately for information.
- Full resyncs of older reservations cannot register as pickup.
- Net demand = new reservation nights − cancellations per stay date; a cancellation can never yield a positive pickup signal.
- Pickup is always evaluated before any markdown branch.
- Stale or failed PMS sync → run stops with no price change and the run is recorded as `failed`/`stale`.

## 6. Events and market

Events: low €0, medium €5 (only with corroborating occupancy/pickup/second source), high €10; one uplift per event per stay date recorded in `revenue_event_applications`; dedup by normalized title + date + venue.

Competitors: ≥ 4 distinct comparable properties, latest observation per competitor per stay date, max age 24 h, invalid values and statistical outliers removed before the median. Cap the supported target at 125 % of the median below 70 % occupancy, 140 % only at ≥ 85 % occupancy with genuine pickup. Failed validation means competitor data is ignored, with the reason stated. Pricing stays target-based, so no uplift is re-added hourly.

## 7. Activation gate and auto-pause

Gate (all must pass, evaluated over the fresh shadow window): 24 h of shadow since redeploy, ≥ 12 clean scheduled evaluations, inventory exactly 21, zero missing/invalid bounds, zero child-cell prices outside bounds, zero fractional prices, zero failed simulated draft validations, zero schema errors, no daily-budget breaches, no excessive repeated decisions, no cross-hotel rows, fresh successful PMS sync, all Previo room/rate-plan mappings valid, and every simulated child payload safe. Passing flips `mode = live` and `auto_publish = true` automatically — no per-price approval.

First 48 live hours run a watchdog that returns Ottofiori to shadow on: bound/integer/inventory violation, publish or confirmation failure, Previo price ≠ intended price, stale PMS data, abnormal affected-cell count, a date exceeding its window limit, oscillation, or three consecutive failed evaluations. The six-hour direction-change cooldown stays, overridable only by genuine new pickup.

## 8. Whole-EUR enforcement

Check constraints requiring whole EUR on `revenue_date_decisions`, `revenue_pickup_automation_actions`, `revenue_rate_drafts`, `revenue_rate_push_items` and Ottofiori floor/ceiling rows. In code: `Math.round` then `Number.isInteger`, batch rejected on any fractional value. UI price inputs use `step={1}` and reject decimals.

## 9. Morning report

Rolling window `created_at >= now() - interval '24 hours'` (no calendar-midnight boundary). Totals come from exact SQL counts, never a `.limit()` sample; pagination only for detail lists. Reports separately: stay dates increased, stay dates decreased, price cells published, pickup nights, reservations, booking revenue, failed/unconfirmed deliveries.

## 10. Tests and simulation

Unit and integration tests for every window and boundary: occupancy thresholds, 1/2/3 pickups, no-pickup waits, cancellation and direction cooldowns, daily limits, sold-out, ≤ 5 rooms left, missing bounds, integer-only prices, event dedup, distinct-competitor and outlier rules, 24 h manual hold, exact 21-room inventory, live-style draft insertion, Previo confirmation status, and a guard that other hotels stay on engine v1. Explicit regression test: one-person cells priced €84–€613 can never collapse to €25 through a missing ceiling.

90-day historical simulation script reporting projected occupancy, ADR and RevPAR impact, counts of increases/decreases/holds, maximum decrease per date per day, any bound violations, any fractional prices, and a comparison against the previous automation.

## Deployment and reporting

Deploy migrations and Edge Functions, reset `shadow_started_at` to the deployment time, and verify against the live database (not just source): mode and `auto_publish`, exact inventory count, deployed function versions, test results, shadow simulation results, projected increase/decrease/hold counts, min and max simulated child-cell prices, confirmation that no simulated price becomes €25, confirmation the live-style draft insertion test passes, earliest possible automatic activation time, and confirmation that all other hotels are unchanged. Live mode is not activated during this session.
