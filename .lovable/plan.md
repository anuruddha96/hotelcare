# Fill September and October without giving away ADR

## What the data actually says (checked live, nothing changed)

Hotel Ottofiori, latest snapshot per stay date:

| Period | Occupancy | ADR | Unsold room-nights |
|---|---|---|---|
| September | 61% | EUR 161 | 246 |
| October | 42% | EUR 159 | 377 |
| November (first half) | 29% | EUR 113 | 223 |

Weakest weeks: 7-13 Sep (56% at EUR 189), 28 Sep-4 Oct (50%), and the whole of October (40-44%).

**Why automation is not helping.** The pace targets the engine measures against are far too low for this property:

```text
 8-14 days out  -> expects 65%
15-30 days out  -> expects 50%
31-60 days out  -> expects 35%
61-90 days out  -> expects 20%
```

September sits at 61% while its lead time only "expects" 50%, and October sits at 42% against an expected 35%. So every one of those dates is scored **ahead of pace**, and the engine answers "on_pace - no markdown, no action". The property is quietly being told it is doing fine while 620 room-nights go unsold.

Three further brakes in the sell window:
- a markdown needs a *large* pace gap (-10 / -20 at 8-30 days, -15 / -25 at 31-90 days) that these targets can never produce;
- 31-90 days out also requires the price to sit above the seasonal anchor and enforces 48 hours between decreases, with a maximum of EUR 5 down per day;
- there is no upper pressure at all: nothing pushes a date towards full when arrival gets close.

ADR target on file is EUR 130 and actual ADR is EUR 159-161, so there is genuine headroom to convert price into occupancy without damaging the target.

## The strategy

Sell harder as the arrival date approaches, protect rate far out, and never sell below a defended floor.

### 1. Realistic pace curve (the single biggest fix)

Replace the pace targets with a curve that reflects what a full house looks like:

```text
 0-1 day    95%      15-30 days  72%
 2-3 days   92%      31-60 days  60%
 4-7 days   88%      61-90 days  42%
 8-14 days  80%      91-180 days 22%
```

With this curve September (61%) is roughly 11-19 points behind and October (42%) is ~18 points behind, so the engine finally sees the real problem and is allowed to act.

### 2. A "Fill mode" that gets stronger as arrival approaches

New per-property setting, on for Ottofiori, off for everyone else. Inside the next 60 days the engine drives towards 100% occupancy:

```text
 0-7 days    FILL HARD   behind pace -> step down every run until it sells;
                         each new booking still raises the price back up.
 8-30 days   FILL        behind pace by 5+ points -> step down (was 10+);
                         wait shortened from 24h to 8h; daily down-budget 10.
31-60 days   NUDGE       behind pace by 8+ points -> small step down,
                         anchor requirement relaxed, one decrease per 24h.
61+ days     UNCHANGED   protect rate exactly as today.
```

### 3. ADR protection, so "push sales" never becomes "dump the rate"

- A **sell-window floor**: no date inside 60 days may be marked below its floor, and the rolling ADR guard keeps the running average at or above the EUR 130 target - if the next 14 nights would average below target, further markdowns stop.
- **Total drop budget per date**: a date may lose at most 15% of its starting price across the whole campaign, regardless of how many runs happen.
- **Instant recovery**: any genuine new booking raises the date again with the existing pickup steps, so a date that starts selling stops being discounted immediately.
- **Weak days first**: markdowns are applied to the softest dates (Sun-Thu, and the 40%-occupancy October weeks) before strong dates, so high-demand nights keep their rate.

### 4. Always two months in view

The engine currently walks the full 365-day horizon each run. Fill mode makes the next 60 days the priority slice: those dates are evaluated first every run and always fit inside one run's decision budget, so September and October can never be starved by far-out dates again.

### 5. Visibility for the manager

- The automation panel gets a **"Fill next 60 days"** card: occupancy vs the new pace target for September and October, unsold room-nights, and how many dates moved in the last 24 hours.
- The hourly run notification names the campaign explicitly: "September 61% vs 76% target - 14 dates stepped down, 6 dates raised on new bookings, ADR held at EUR 157".

## Expected effect

Roughly 620 unsold nights across the two months. Converting even a third of them at EUR 130-140 is meaningful revenue, and because increases stay fully active, dates that respond climb straight back up. ADR should settle in the EUR 140-155 band rather than 159 - above the EUR 130 target.

## Technical notes

- Data change: rewrite `revenue_pace_targets` for Ottofiori with the new curve.
- Migration: add fill-mode columns to `revenue_pickup_automation_rules` (`fill_mode_enabled`, `fill_window_days` default 60, per-band gap thresholds and wait hours, `max_total_drop_pct` default 15), defaulted so every other property behaves exactly as it does today.
- `supabase/functions/_shared/engineV2.ts`: fill-mode variants of the `w0_2`, `w3_7`, `w8_30` and `w31_90` window rules (looser gap thresholds, shorter no-pickup waits, larger `max_daily_decrease`, anchor requirement relaxed 31-60 days), plus the cumulative drop-budget guard. Increases and all existing safety rails (whole euros, floors/ceilings, ladder order, date-atomic publishing, manual holds, cancellation cooldown) are untouched.
- `runV2.ts`: order dates inside the fill window first, and feed the rolling ADR guard the target from `adr_target_eur`.
- `PickupAutomationRules.tsx`: a "Fill mode" section exposing the window, thresholds and drop budget.
- `src/lib/__tests__/engineV2.test.ts`: new cases - behind-pace September date steps down, a booking reverses it, drop budget stops at 15%, ADR guard halts markdowns, non-fill properties unchanged.
