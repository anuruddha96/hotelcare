# Ottofiori Revenue Automation V2

Rebuild the existing pricing engine (no second engine) into a date-level, target-based, hourly automation for Hotel Ottofiori only. Other hotels keep today's behaviour via a per-rule `engine_version` flag.

## Confirmed current state (verified now)

- Rule `951ef9b9-…` is enabled with `auto_publish = true`, interval 60 min.
- `last_evaluated_at` = today 07:00 UTC and `last_evaluation_status = "ok"`, but `last_successful_evaluation_at` is stuck at **2026-08-24 21:00** — runs report OK while terminating before completion.
- Last 48 h of Ottofiori actions: **75,056 pushed `no_pickup_markdown`**, 2,283 queued, 414 ladder repairs, 299 strong-demand increases, 14 cancellation holds. Confirms markdown explosion and pickup starvation.
- Settings amplifying it: `no_pickup_lookback_hours = 2`, `no_pickup_decrease = 1`, `sold_out_guard_enabled = false`, `future_booking_window_days = 365`, `max_daily_decrease_per_date = 20`.
- `revenue-pickup-automation/index.ts` (2,827 lines) runs the no-pickup/markdown/repair pass before the positive-pickup pass, and iterates per room-type × occupancy cell rather than per stay date.
- `revenue-morning-digest` counts from a `.limit(400)` query — the "400 decreases" is a capped sample.

**Root cause:** hourly per-cell markdown evaluation with a 2-hour no-pickup trigger, across 365 days × ~8 cells, with no completion gate — the function times out inside the markdown pass, never reaching pickup, and still writes an "ok" status.

## Phase 0 — Contain (before any code change)

- Set Ottofiori `auto_publish = false`, mark rule `paused_reason = 'v2_rebuild'`; other hotels untouched.
- Clear the in-flight lock and supersede only **unclaimed automation** drafts/actions for Ottofiori (`status in ('draft','queued')`, `source = automation`). Manual, pushed, confirmed and historical rows are never touched; claimed push runs finish.
- Produce a read-only "suspicious live prices" report (cells that fell ≥ €10 in 48 h, or sit below €110 / above €500) — review only, no auto-repair.

## Phase 1 — Schema

New/changed tables (Supabase migration, GRANTs + RLS scoped to organization):

- `revenue_date_decisions` — one row per hotel + stay_date + run: days-out, occupancy, rooms sold/remaining, pickup 1h/6h/24h/48h/7d, cancellations, pace target and gap, current/target reference price, whole-EUR movement, direction, reason, event signal, market signal, manual-hold state, cap used, status (shadow/queued/published/verified/held/failed).
- `revenue_pickup_ledger` — immutable `first_seen_at` per (hotel, previo reservation id, stay date) plus `increase_spent_at`. Replaces `captured_at` as pickup proof.
- `revenue_event_applications` — event→stay-date ledger so an event pays once.
- `revenue_pace_targets` — configurable days-out band → target occupancy (seeded with the 9 bands from the brief), extendable by month/weekday/season.
- `revenue_automation_runs` — run id, start/end, duration, status (`in_progress|completed|failed|timed_out`), counters (evaluated/increased/decreased/held/blocked/queued/published/verified), failure reason.
- `revenue_price_floors` — single source of truth per hotel/room-type/occupancy: reference minimum (Ottofiori 2-pax = €110), category min/max, supplement, global safety max (€500 default). Removes the €60/€110/€120 conflict.
- Extend the rules table: `engine_version`, `mode` (`shadow|live`), `shadow_started_at`, `gate_results` jsonb, `auto_pause_reason`, direction-change window, per-window caps jsonb, market-validation settings, manual-hold hours.
- Existing actions table gains `decision_id` so price cells become children of a date decision.
- Ottofiori settings: `sold_out_guard_enabled = true`, `whole_number_prices = true`, far-out €50 top-up disabled, abnormal-pickup threshold 5 → 2.

## Phase 2 — Engine rewrite (same function)

`revenue-pickup-automation` becomes a thin orchestrator over new shared modules:

- `_shared/ottofioriStrategy.ts` — the six arrival-window rule sets (0–2, 3–7, 8–30, 31–90, 91–180, 181–365) with their pickup increases, no-pickup waits, pace gates and daily caps, all integer.
- `_shared/pickupLedger.ts` — genuine pickup detection from the immutable ledger; cancellations deducted; one increase per reservation × date; strong = 2 room nights / 6 h, abnormal = 3+.
- `_shared/priceTarget.ts` — target-based pricing (anchor, occupancy vs pace, pickup velocity, rooms left, event, validated market, floors/ceilings), integer target, no move below €3 delta, no repeated additive surcharges.
- `_shared/eventSignal.ts` — title normalisation, encoding-corruption detection, dedup by city/date/venue, approval + confidence gates, once-per-date uplift (medium €5 conditional, high €10).
- `_shared/marketSignal.ts` — requires ≥ 4 comparable competitors ≤ 24 h old, EUR-normalised, outliers stripped; caps target at 125 % of median (< 70 % occupancy) or 140 % (≥ 85 % with pickup); otherwise the signal is ignored with a stated reason.
- `_shared/wholeEuro.ts` — `assertWholeEuro` applied at target, action, draft, and immediately before the Previo payload.

Run order per hour: advisory lock → run record `in_progress` → refresh + freshness check (stale ⇒ safe stop, no price change) → pickup & cancellations → one decision per stay date → no-pickup/pace markdown only for undecided dates → event/market → integer target → propagate to mapped cells → floors/ceilings/caps/sold-out/manual-hold/ladder → queue only genuinely different cells → publish (live only) → verify against Previo → mark complete → release lock. Near-term dates first; 30 s budget with a continuation worker; incomplete runs stay `failed`/`timed_out` and never advance `last_successful_evaluation_at`.

Direction-change protection: last direction + timestamp per date, no reversal within 6 h absent a real booking/cancellation/occupancy change; one move per date per run; manual edits hold for 24 h; publish only if the draft is still the newest intent.

## Phase 3 — Reporting and UI

- `revenue-morning-digest`: drop `.limit(400)`, compute true rolling-24 h totals in SQL, split date decisions from cell deliveries, split pickup-driven from ladder repairs, list run outcomes, warn on stale `last_successful_evaluation_at`, whole-EUR only.
- Automation settings UI: interval, lead bands, pace targets, pickup thresholds/increases, no-pickup waits, markdown amounts, daily caps, event and market rules, hold duration, room min/max, shadow/live — all money inputs `step=1`, decimals rejected.
- Status panel: mode, last completed/failed run, next evaluation, duration, evaluated/increase/decrease/hold counts, skip reasons, affected cells, Previo verification, stale warnings, auto-pause reason.

## Phase 4 — Tests and simulation

Vitest/Deno tests for every window rule, whole-EUR enforcement at all four boundaries, pickup-before-markdown ordering, once-per-reservation lift, strong/abnormal thresholds, no dual-direction date, idempotent reruns → hold, sold-out hold, 24 h manual hold, event non-repetition, duplicate-event dedup, competitor outlier rejection, < 4 competitors disables market, caps, floors/ceilings, ladder validity, timed-out run not successful, concurrency rejection, stale-retry rejection, digest totals > 400, run within budget.

Historical simulation script over the last 90 days of Ottofiori reservations, cancellations, occupancy, rates, events and actions, comparing old vs V2: counts of increases/decreases, reversals, missed pickup dates, safety violations, event compounding, decision and delivery volumes. ADR/occupancy/RevPAR shown only with the calculation and stated assumptions.

## Phase 5 — Shadow, automatic activation, live guardrails

- Re-enable evaluation in `mode = shadow`: full algorithm hourly, decisions recorded, nothing sent to Previo.
- A gate evaluator runs at the end of each shadow hour and, at the 24 h mark, writes `gate_results`. If all gates in the brief pass, it sets `mode = live` and `auto_publish = true` automatically — no button, no per-price approval. Any failure keeps shadow mode, records the exact gate, notifies managers, and keeps testing.
- First 48 live hours use the tighter caps and a watchdog that auto-pauses back to shadow (history preserved, managers notified, other hotels unaffected) on any critical condition: decimal price, floor/ceiling breach, stale-data decision, overlapping run, repeated timeout, event compounding, stale intent overwrite, repeated Previo rejection, dual-direction date, mapping/safety error. After 48 clean hours it moves to normal V2 limits.

## Scope guard

Everything V2 is behind `engine_version = 2` on the Ottofiori rule only. Memories, Mika, Gozsdu and SLNT keep the current code path unchanged, and the final report will include a before/after diff proving it.
