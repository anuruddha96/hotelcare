# Ottofiori: ADR-first automation rules

## What the live data actually says (checked before writing this)

- Forward picture (latest snapshot per date): Sept 60.8% / ADR 152, Oct 41.9% / 157, Nov 30.9% / 123, Dec 18.1% / 146. So October occupancy is **not** high overall — but individual strong dates are underpriced, which is what the note describes.
- Underpriced strong dates confirmed: 1 Sep 85.7% sold at 114, 5 Sep 85.7% at 121, 3 Sep 71.4% at 99, 8 Sep 71.4% at 110. Occupancy is high and the rate never followed.
- **The biggest ADR leak is invisible to the engine.** Comparing the last 10 days of new bookings with the loaded grid price for the same date/room type/occupancy: average sold 163 vs grid 215 — a **24% average discount**, and 83 of 162 room-nights sold more than 20% below grid. Derived/OTA plans (mobile, genius, non-refundable, single-occupancy) sell far under the price the automation thinks it set. A grid price of 130 does not produce an ADR of 130.
- **Cancel-and-rebook arbitrage is real.** Same dates, cancellation followed by a cheaper booking hours later: 5 Sep cancelled at 158 → rebooked at 109 and 110; 24 Aug cancelled at 174/136 → rebooked at 64 and 96; 11 Nov 117 → 95. This is exactly the screenshot (23–30 Oct 2,066 cancelled, 1,983 rebooked). Every markdown on a date that already has bookings invites this.
- Current rule set: min ADR 110, ADR target 130 with only a **7-day** guard window, fill mode on for 60 days with up to 15% drop, markdown allowance 20/day, min movement 3.

## Manager notes (recorded as the operating brief)

1. Pricing in Ottofiori is still improper — prices must be corrected before anything else.
2. October: occupancy high on some dates, price low — those dates must be lifted.
3. September: occupancy low, so last-minute discounting will drag the overall ADR down — fill September **without** collapsing ADR.
4. Memo/campaign action is too early and risky right now.
5. Guests cancel and rebook the same dates when our price falls — stop giving them that opportunity.
6. Everything must move towards the ADR goal by month end, not just towards occupancy.

## The automation logic to build

### 1. Price on **net realised** ADR, not on grid price
Add a per-hotel, rolling **net-rate factor**: realised nightly rate ÷ grid price for the same date/room type/occupancy, computed over the last 30 days of bookings (currently ~0.76 for Ottofiori), clamped to 0.6–1.0 and recomputed daily.

- Every floor the engine enforces (min ADR, ADR guard, fill drop budget, far-out floor) is divided by this factor before being applied to the grid. With the target of 130 and a factor of 0.76, the effective grid floor becomes ~171 — that is what it actually takes to bank an ADR of 130.
- The factor and the resulting effective floor are shown in the rules screen and in every decision reason, so nobody has to guess why the floor moved.

### 2. Month-end ADR pacing instead of a 7-day guard
Replace the 7-day rolling ADR guard with a **month-to-go guard**: for each stay month, take what is already on the books (rooms and revenue), compare against the month's ADR target, and derive the rate the remaining rooms must average to land on target. That required rate becomes the floor for the remaining dates of that month (still capped so one bad month cannot price the hotel out).

- When a month is running above target, markdowns are released for the weak dates in it — that is how September fills without dragging the month down.
- When a month is running below target, markdowns in that month are frozen and only pickup-driven increases pass.
- The 7-day window stays as a second, tighter guard for the immediate arrivals.

### 3. Occupancy-led lifts (the October / strong-date correction)
A new upward branch that does not need pickup in the current run — pace is enough:

```text
occupancy vs days out        action per run
>= 80% and > 7 days out      +8% of price (min +10), regardless of pickup
>= 70% and > 14 days out     +5% of price (min +6)
>= 60% and > 30 days out     +3%
below the above              unchanged, existing pickup ladder applies
```

Capped by the existing daily increase allowance, market ceiling and max price. This alone corrects 1/3/5/8 Sep and the strong October dates.

### 4. Anti-arbitrage: never mark down a date that is already selling
Markdowns become conditional on the date having no fresh commitment to protect:

- **Booked-date brake** — if the date has bookings created in the last 72 hours, no markdown; the demand is proving itself.
- **Rebook window** — no markdown on a date where a cancellation arrived in the last 24 hours (today's 60 minutes is far too short; the 5 Sep and 24 Aug cases all happened inside a day).
- **One-way day** — once a date moves up in a day it cannot move down the same day, and a date may take at most **one** markdown per 24 hours.
- **Markdown depth cap** — a date can lose at most 10% of its 14-day peak price in any rolling 7 days, on top of the existing fill drop budget.
- Cancellations no longer trigger a markdown at all; they only restore inventory. The reason chip explains "cancellation — inventory returned, price held".

### 5. Fill September the safe way
Inside the fill window, when a date is behind pace the engine tries these in order and stops at the first one it is allowed to do:

1. Relax restrictions instead of price — drop min-stay to 1 and lift closed-to-arrival if either is blocking the date.
2. Cut the **lowest occupancy tier only** (1-person rate towards the 2-person rate) rather than the whole ladder, so headline ADR is protected.
3. Only then a price step, and never below the month-end required rate from §2.

Total drop budget per date stays at 15% of the campaign start price; the effective floor is the net-adjusted one from §1.

### 6. Hard ADR stop
An absolute rule that overrides fill mode, final-window and immediate-sell logic: **no cell is ever published below `minimum_adr ÷ net-rate factor`** (110 ÷ 0.76 ≈ 145 grid). Any cell already below it is lifted towards it at the daily allowance rather than being left there. This is what removes the 99–121 grid prices that produced the 89 EUR booking in the screenshot.

## What the manager sees

- A **Month ADR pacing** strip above the grid: per month, on-the-books ADR, target, rooms left, and the rate the rest of the month has to average. Green when a month can afford discounting, red when it cannot.
- The **net-rate factor** with its effective floor in the rules screen and in the price-update card, plus new reason chips: `net_adr_floor`, `month_pace_floor`, `occupancy_lift`, `booked_date_brake`, `rebook_window`, `markdown_depth_cap`.
- All new numbers are editable per property through the existing rule editor and the inline "Adjust this rule" panel; other hotels keep today's behaviour until they switch the new options on.

## Technical notes

- `supabase/functions/_shared/netRateFactor.ts` (new): compute the realised-to-grid factor from `revenue_booking_nights` × `revenue_room_type_rates`, clamped and cached per run.
- `supabase/functions/_shared/adrGuard.ts`: add `computeMonthPaceGuard()` alongside the existing window guard; both feed the floor.
- `supabase/functions/_shared/engineV2.ts`: add `occupancyLiftIntent()`; add the booked-date, rebook-window, one-markdown-per-day and depth-cap blockers before any markdown intent; apply the net-adjusted floor in `priceBounds`.
- `supabase/functions/revenue-pickup-automation/runV2.ts`: load recent bookings/cancellations per date, the month pacing aggregate and the net factor; keep the uniform per-date EUR movement across room types.
- Migration on `revenue_pickup_automation_rules`: `net_rate_factor_enabled`, `net_rate_factor_override`, `month_pace_guard_enabled`, `monthly_adr_targets jsonb`, `occupancy_lift_ladder jsonb`, `booked_date_brake_hours` (72), `rebook_window_hours` (24), `max_markdowns_per_day` (1), `markdown_depth_pct` (10) — defaults neutral for every hotel except Ottofiori, which is switched on.
- `src/components/revenue/PickupAutomationRules.tsx` + `src/lib/revenue/reasonSettings.ts`: editors and reason mappings for every new field.
- Tests in `src/lib/__tests__/engineV2.test.ts`: net floor never breached, occupancy lift fires without pickup, markdown blocked after a cancellation and after a fresh booking, one markdown per day, month-behind freezes markdowns, month-ahead releases them.
