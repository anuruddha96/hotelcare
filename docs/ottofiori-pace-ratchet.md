# Hotel Ottofiori — pace ratchet pricing rules

Owner brief, 18 November 2026: price Ottofiori the way Ricsi prices the sister
hotels by hand — raise on pickup, ease the price down while nothing sells,
remember the price that converted, sell the leftover rooms in the last three
days, and find the clearing price on the arrival day. Keep the existing engine,
publisher and safety guards; change only how a date's move is planned.

## Why the old rules were replaced

The last 45 nights before the change:

| Finding | Number |
| --- | --- |
| Nights that sold out | 39 of 45 |
| ADR, October → 1–17 November | about €144 → €104 |
| Sold one week out, October → November | 77% → 39% |
| November room nights booked in the last 3 days | 48%, at about €81 |
| Tue 10 Nov: listed for two months / sold on the day | about €180–290 / €64 |

The hotel filled every night, so demand was never the problem. Ordinary dates
were listed far above what they were worth, sold nothing for weeks (an "event"
label blocked every cut), and were then dumped in the final days. The fix is
the price *level* early, not more price changes late.

## What the rules do

Every stay date has a **tier** and sits in a **zone**.

| Tier | Meaning | Raise per booking | Day cap up | Ceiling |
| --- | --- | --- | --- | --- |
| Normal | an ordinary night | 7% (€8–25) | 20% | €500 |
| High | arena concert, sister hotels priced ≥1.35× their normal, or bookings well ahead of the curve | 13% (€18–45) | 35% | €500 |
| Peak | stadium-scale or citywide demand, backed by prices or bookings, or confirmed by a manager | 35% (€50–80) | 90% | €900 |

| Zone | Days out | Quiet time before a cut | Cut | Most in a day |
| --- | --- | --- | --- | --- |
| Far out | 31–120 | 12 h | glide to the seasonal band, at most 3% a step | 5% |
| Booking window | 8–30 | 6 h | 2–3% while behind the booking curve | 5% |
| Close in | 4–7 | 4 h | 2–4% while behind the curve | 10% |
| Sell-down | 1–3 | 3 h | 2–7%, sized to rooms left versus pickup still expected | 15% |
| Arrival day | 0 | 1 h | 3% morning, 5% afternoon, 8% evening | 30% |

Rules that hold everywhere:

- **A booking raises, quiet hours ease.** One booking pays for exactly one
  raise. Two or three bookings together earn 1.6× / 2.2×. Bookings far ahead
  earn more (1.3× beyond 30 days, 1.6× beyond 60), the last rooms earn more.
- **No cut right after a booking**, and never while the date is on or ahead of
  its booking curve. The curve is read off the saved pace targets and
  interpolated, so a date does not jump 15 points at midnight.
- **Converting-price memory.** Cuts stay within 5% of the last price that took
  a booking (remembered 7 days far out, 3 days in the booking window, 1 day
  close in).
- **Seasonal base.** Derived four times a day from the published prices of
  Gozsdu Court, Mika Downtown and Memories Budapest, scaled to Ottofiori's own
  ADR level. Before the free-cancellation deadline a date never falls under
  80% of its base. Far-out dates priced more than 15% above base (30% on High
  dates) glide down so they reach the band 35 days out — this is what stops
  January from sitting at €137 with nobody booking.
- **Sell-down.** In the last three days the cut depends on *pressure* = rooms
  left above the tolerance (2) minus the pickup the curve still expects. No
  pressure, no cut. A booking while rooms still have to go **locks** the price
  that just worked instead of chasing it up.
- **Arrival day.** Steps down through the day until a price converts, then
  holds it for two hours. The first step after a hold is the gentle one.
- **The last rooms keep their price.** With 2 or fewer rooms left nothing is cut.
- **Cuts only in selling hours:** 07:00–22:00 (arrival day 08:00–22:00), Budapest time.
- **Peak dates are never cut automatically** before the final sell-down window.

### Guardrails

| Guardrail | Value |
| --- | --- |
| Lowest banked rate | €65 after OTA discounts, before commission |
| Lowest list price | €87 on the cheapest cell of the date (65 ÷ 0.75 measured net rate) |
| Ceiling | €500; €900 on Peak dates; a manager can set a per-date ceiling |
| Largest single move | €80 |
| Free cancellation | 7 days |
| Rooms that may stay unsold | 2 |
| Newly live | every step and cap is halved for 48 hours |

A date with a bookable price under the €87 floor is lifted back to it whatever
the booking story says. Every existing safeguard still applies unchanged: manager locks,
the four-hour hold after a manual price, whole-euro prices, all 13 cells of a
date moving by the same amount, the database markdown budget, the cancellation
cooldown and the publication guard.

### Peak dates and the manager's review

The event feed is written by an automatic search and contains wrong dates and
look-alike titles (on 18 Nov 2026 it held three different weekends for one
Grand Prix, a final played in Frankfurt and a "Mathematical Olympiad"). So:

1. A **candidate** is an approved, high-impact event that is stadium-scale or
   citywide (Puskás Aréna, Champions League / UEFA, Formula 1, Sziget, New
   Year's Eve, world championships, Olympic Games), or a date the sister
   hotels price at 1.9× their normal or more.
2. Every candidate is **flagged once**: a "dates to review" notice in the
   revenue bell and an e-mail to the hotel's top-management users.
3. A candidate is treated as **Peak** only when the sister hotels' prices or
   the hotel's own bookings back it up. Otherwise it is treated as **High**
   until a manager confirms it.
4. A hand-entered event replaces same-titled automatic copies on other dates.

The rules never make a large jump on their own when an event appears. Setting
the opening price for an event night is the manager's decision; the rules then
ratchet hard on every booking.

## Changing the rules by typing

**Revenue → Automation** has a chat box at the top. Type the instruction; Mira
answers with a before/after card and nothing changes until **Apply**.

| You type | What is proposed |
| --- | --- |
| "Lowest rate 70" | `policy.floor_net_eur` 65 → 70 |
| "Sell the last three days faster" | `policy.decay_pct_selldown` and its day cap |
| "Tag 31 December as Peak" | `tier.2026-12-31` → peak |
| "Champions League night can go to 1200" | `tier.<date>` → peak, `ceiling.<date>` → 1200 |
| "Dismiss 28 May" | `tier.2027-05-28` → dismissed |
| "Why is next Tuesday not moving?" | reads the rules' decision for that date |

Every number has a safe range in `PACE_POLICY_FIELDS`
(`supabase/functions/_shared/engineV2PaceRatchet.ts`); a value outside it is
refused, and a change that would drag a tied setting along has to name that
setting too. Each applied policy change first saves the whole rule to
`revenue_rule_backups` and is written to `assistant_audit_log`. The mode
(off / shadow / live) cannot be changed from chat.

## Modes, go-live and rollback

```sql
-- Record the rules next to the live prices; publish nothing.
select public.revenue_pace_policy_set_mode('ottofiori', 'shadow', 'note');
-- The rules set the prices.
select public.revenue_pace_policy_set_mode('ottofiori', 'live', 'note');
-- Back to the previous rules, immediately.
select public.revenue_pace_policy_set_mode('ottofiori', 'off', 'note');
```

Going live does four things in one transaction and leaving live undoes all of
them: it backs up the rule, starts the 48-hour half-step period, widens the
daily euro caps the database trigger enforces (the percentage caps above do the
fine control) and pauses the four-hourly AI price writer so only one thing
writes prices. Rollback needs no deployment.

### How the shadow day is judged

`revenue_pace_policy_log` holds one row per stay date per run: what the rules
would do, next to what was published. Go-live needs all of:

- no run errors and no per-date errors (`skip_reasons.pace_policy` on the run);
- every planned move a whole number of euros, at most €80, never taking the
  cheapest cell under €87 or the dearest over its ceiling;
- no planned cut on a date with a fresh booking, 2 or fewer rooms left, a
  manager lock, or outside selling hours;
- raises only where a booking arrived (or a date sat under the floor);
- the volume of moves within what the publisher already handles.

## Where things live

| Piece | Place |
| --- | --- |
| The rules (pure functions) | `supabase/functions/_shared/engineV2PaceRatchet.ts` |
| Tests | `engineV2PaceRatchet.test.mjs` (Node), `engineV2PaceRatchet_test.ts` (Deno, with the 13-cell publisher) |
| Wiring into the engine | `supabase/functions/revenue-pickup-automation/runV2.ts` |
| Chat allowlist and writer | `_shared/assistantAutomationFields.ts`, `assistant-apply-automation-change` |
| Tables, switch, scheduled jobs | `supabase/migrations/20261118200000_ottofiori_pace_ratchet.sql` |

Tables: `revenue_date_tiers` (tags and review queue), `revenue_seasonal_base`,
`revenue_converting_prices`, `revenue_pace_policy_log` (14 days kept).

## Research behind the choices

- Gallego & van Ryzin (1994), *Optimal dynamic pricing of inventories with
  stochastic demand over finite horizons* — the optimal price steps up after a
  sale and drifts down between sales; a well-chosen fixed price is already
  close to optimal, so getting the level right matters more than moving often.
- Weatherford & Kimes (2003), *A comparison of forecasting methods for hotel
  revenue management* — simple pickup and smoothing forecasts are the robust
  ones; hence the booking curve rather than a learned model.
- Su (2007), *Intertemporal pricing with strategic customer behavior* and the
  markdown literature — predictable late discounts teach guests to wait;
  hence small, bounded cuts and the converting-price guard.
- Work on cancellation and rebooking under free cancellation — a cut inside
  the free-cancellation period invites cancel-and-rebook; hence the base floor
  before the deadline and the hold after a cancellation.
- Ferreira, Simchi-Levi & Wang (2018), *Online network revenue management
  using Thompson sampling* — the natural next step for the arrival-day
  discovery once there is enough of this hotel's own data. Not in this version.

## Known limits

- **Pinned dates.** Every price of a date moves together, and no price may go
  under the floor. When the cheaper room types are sold out and their prices
  sit at the floor, the dearer rooms still on sale cannot be lowered either
  (reason "held by a sold-out room type at the floor"). Only a person can
  change the gap between room types: raise the sold-out type's price for that
  date in the rate calendar and the date is free again. A sold-out type under
  the floor never lifts a date.
- The seasonal base follows what the sister hotels are listed at. If they are
  mispriced for a date, so is the base; the 80% floor is the only effect.
- The €87 list floor assumes guests pay about 75% of the list price after OTA
  discounts (measured median 74.5% on Booking.com). `policy.net_rate_factor`
  changes it.
- Shadow rows are independent samples of what the rules would do at that
  moment, not a simulation of the path prices would have taken.
- Only hotels in date-column lockstep can go live; elsewhere "live" is
  treated as shadow.
- While the rules are live the AI supervisor's four-hourly run is paused. A
  manual AI review still works; its price is then left alone for four hours.
- A wave of cuts is spread out: at most 40 dates are lowered per run, nearest
  dates first, the rest in the following runs.
