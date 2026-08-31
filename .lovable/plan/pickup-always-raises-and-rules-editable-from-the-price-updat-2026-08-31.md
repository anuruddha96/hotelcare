# Pickup always raises, and rules editable from the price-update card

## What I checked in the live data (Ottofiori, last 24h)

- The property runs Engine V2 with `engine_version = 2`, `fill_mode_enabled = true`, and **no custom `window_rules`** — it falls back to the hard-coded ladder in `engineV2.ts`. The `booking_window_tiers` you can already edit in the rules screen (+8 / +19 / +55 by lead time) are **V1 fields that Engine V2 never reads**. That is the core of "the far-out surcharge is gone".
- Decision reasons in the last 24h: 36 increases (`genuine_pickup`, `genuine_pickup+event`) against 4,000+ holds. `single_pickup_hold · 14` — dates that had a real new booking and were refused a raise because occupancy was under 75–80%. Other pickup-bearing dates were swallowed by `direction_cooldown · 15` and `daily_budget_spent · 48`.
- So two things are wrong: a single booking can be ignored, and the size of the raise is not tied to how far out the date is.

## 1. Any genuine pickup raises the price

- Delete the `single_pickup_hold` branch in the 0–2 and 3–7 day windows. One genuine new reservation always produces an increase; occupancy only changes **how much**, never whether.
- A pickup-driven increase is never blocked by the direction cooldown or by a markdown decided earlier in the same run (pickup wins the date for that run).
- The daily increase allowance stays, but is raised for the far-out windows so a large long-lead surcharge is not clipped to a few euros. Floors, ceilings, market cap, ADR guard and whole-euro rounding are untouched.

## 2. Surcharge scales with lead time

A new configurable ladder, `pickup_increase_ladder`, replaces the hard-coded per-window numbers. Proposed defaults (per stay date, per run):

```text
days out    1 booking   2 bookings   3+ bookings   max/day
0–2            4            6            8            12
3–7            6            9           12            18
8–30           8           12           16            24
31–90         12           18           24            36
91–180        18           27           36            50
181+          25           38           50            60
```

Plus a demand kicker: +50% on the step when the date is already at or above the "strong occupancy" threshold (default 85%), and the existing one-off event uplift stays as it is.

Every number above is editable per property — nothing is hard-coded to Ottofiori any more. Existing hotels keep today's behaviour until their ladder is saved.

## 3. Edit the rule straight from the price-update card

Each row in the price-update notification already carries a machine reason (`fill_markdown`, `single_pickup_hold`, `bounds_headroom`, `decrease_frequency`, `below_min_movement`, `on_pace`, `far_out_no_markdown`, `occupancy_protected`, `manual_hold`, `daily_budget_spent`, `awaiting_no_pickup_window`, `cancellation_cooldown`, …). A reason-to-setting map turns that into a direct edit:

- Every reason chip and every decision row gets an **Adjust this rule** control.
- It opens a small panel showing: the reason in plain words, the exact setting(s) behind it, the current value for that lead-time band, and an input to change it — with a one-line preview ("this date would have moved −6 EUR instead of holding").
- Saving writes through the same validated path as the rules screen: allowlisted fields, range checks, `version` bump, `updated_by`, audit entry. No free-form writes from the notification.
- After saving, the card offers **Re-run pricing now** so the effect is visible immediately, and the changed setting is highlighted next time the rules screen is opened.
- Reasons that are not a setting (`sold_out`, `stale_data`, `no_price`, `manual_lock`) show an explanation instead of an editor.

## Technical notes

- `supabase/functions/_shared/engineV2.ts`: remove `single_pickup_hold`; add `PickupLadder` (bands × booking-count steps × daily cap × strong-occupancy multiplier) resolved from settings with the table above as fallback; pickup intent evaluated before markdown and exempt from `direction_cooldown`.
- `supabase/functions/revenue-pickup-automation/runV2.ts`: read `pickup_increase_ladder` and `raise_on_any_pickup` from the rule row into `DecisionSettings`; keep uniform per-date EUR movement across room types.
- Migration: add `pickup_increase_ladder jsonb` and `raise_on_any_pickup boolean default true` to `revenue_pickup_automation_rules`.
- `src/components/revenue/PickupAutomationRules.tsx`: new "Pickup increases" section editing the ladder as a table, marked as the setting Engine V2 actually uses (the legacy `booking_window_tiers` block is retired for V2 properties).
- New `src/lib/revenue/reasonSettings.ts`: single source of truth mapping `decision_reason` → editable field(s), label, help text, range — used by both the notification editor and the rules screen so they can never drift.
- `src/components/revenue/RevenueAutomationNotifications.tsx`: reason chips and rows become actionable; the editor reuses the existing rule save path plus the existing "run now" call.
- Tests in `src/lib/__tests__/engineV2.test.ts`: single booking raises in every window, ladder scales with lead time, strong-occupancy kicker, daily cap respected, floors/ceilings still hold, markdown never overrides a pickup increase on the same date.
