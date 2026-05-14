
# Comprehensive Revenue Management — Auto Pilot + Better UI

Scope: `previo-test` only for the live PMS pieces. Other hotels keep XLSX uploads. Eligible roles: `admin`, `top_management`.

---

## Part 1 — Fix the empty "Open" view (auto-fill from Previo)

**Root cause:** `RevenueHotelDetail.tsx` reads `room_types`, `daily_rates`, `dow/monthly/lead/occupancy` from local tables that are empty for previo-test. Nothing populates `room_types` or `daily_rates` from Previo.

**Fix — extend `previo-pull-revenue` to also seed Setup data:**

1. **Rooms Setup** — from `/rest/rooms` + `/rest/roomKinds`, upsert one `room_types` row per Previo room kind:
   - `name`, `pms_room_id` = roomKindId, `room_count` = count of rooms in that kind
   - `is_reference` = the kind with the largest count (only set if no row already flagged)
   - `base_price_eur` = leave existing if present; otherwise compute from current Previo rate (see #2). Never overwrite a manager-edited value.
2. **Daily Rates** — call Previo `/rest/prices` (or `pricelist/getPrices` XML) per roomKind for `[today, today+365]` → upsert `daily_rates(stay_date, rate_eur)` for the **reference** room kind. Tag `source='previo'`.
3. **Pricing defaults seed (only if tables empty)** — insert sensible defaults so the calendar isn't blank on day 1:
   - `dow_adjustments` 0% Mon–Thu, +10% Fri, +15% Sat, +5% Sun
   - `monthly_adjustments` 0% (manager tunes later)
   - `lead_time_adjustments` reflecting the top-down strategy (see Part 2)
   - `occupancy_targets` 75% all months, `occupancy_strategy.aggressiveness='medium'`
   - `hotel_revenue_settings`: `floor_price_eur`, `max_daily_change_eur=30`, `weekday_decrease_eur=3`, `weekend_decrease_eur=2`, `abnormal_pickup_threshold=2`, `pickup_increase_tiers=[{min:1,max:2,increase:10},{min:3,max:5,increase:20},{min:6,max:99,increase:30}]`
4. Return counts (`roomTypes`, `dailyRates`) in the response so the LiveSync banner can show "Synced 24 room types · 365 daily rates".

---

## Part 2 — Top-down auto-pricing engine

A new edge function **`revenue-autopilot-tick`** (cron: every hour, also runnable on demand). Per eligible hotel:

### A. Daily decay (top-down)
For each `stay_date` in the next 90 days where:
- there has been **no pickup** in the last 24h (`pickup_snapshots.delta` for the latest capture is 0), AND
- current rate > `floor_price_eur` and > `room_types.min_price_eur`

→ decrement the rate by `weekday_decrease_eur` (Mon–Thu/Sun) or `weekend_decrease_eur` (Fri/Sat), clamped by the max-daily-change and floor. Persist as a **pending `rate_recommendation`** with `reason="Top-down decay (no pickup 24h)"`. Auto-approve if `auto_apply` flag is on (new column on `hotel_revenue_settings`, default off so manager keeps control).

### B. Pickup-velocity surge detector
New table **`booking_velocity_events`** (see Tech). On each tick:
- For each `stay_date` in next 90 days, look at arrivals captured in `pickup_snapshots` in the **last 60 minutes**.
- If `arrivals_60min ≥ 2` (configurable: `surge_threshold`), insert a `revenue_alerts` row (`alert_type='pickup_surge'`) AND a pending recommendation increasing the rate by `pickup_increase_tiers` (clamped to +€30/day).
- If `arrivals_60min ≥ 3` *or* the day is < 14 days out, raise to the +€20–30 tier and mark `priority='urgent'`.

This is in addition to the existing per-snapshot pickup tier engine; the new path reacts within an hour rather than per snapshot.

### C. Occupancy + lead-time multipliers
Already present in `revenuePricing.ts` — keep as-is, but the autopilot now feeds it real `currentRate` (from Part 1 daily_rates) and real `occupancyPct` (from `occupancy_snapshots`).

### D. Push to Previo (opt-in, gated)
`previo-push-rates` already exists as a 501 stub. Wire it for `previo-test` only:
- For each approved recommendation with `auto_pushed=false`, call Previo `pricelist/setPrices` XML with `(roomKindId, dateFrom=dateTo=stay_date, price)`.
- Flip `rate_history.pushed_at` and `rate_recommendations.auto_pushed=true`.
- Behind a per-hotel feature flag `auto_push_to_pms` (default off).

---

## Part 3 — Better calendar UI (price + pickup + occupancy per cell)

Replace the current sparse month grid in `RevenueHotelDetail.tsx` with a unified **"Strategy Calendar"** that shows all three signals at once, instead of needing 4 separate tabs (Prices / Occupancy / Pickup / Min Stay). Keep the tabs as filtered focus modes but make the default the combined view.

**Each day cell (month view):**

```text
┌─────────────────────────┐
│ 14 Sa            [event]│  ← day, optional event dot, weekend tint
│ €189   ▲ +€8            │  ← current rate · suggested delta chip
│ ████████░░  72%         │  ← occupancy bar + %
│ ⚡ +3 last 24h          │  ← pickup delta with surge icon if hot
└─────────────────────────┘
```

- **Color band on the left edge** encodes pricing pressure (red = surge / increase recommended, amber = stable, green = decay applied today).
- **Surge** (`booking_velocity_events`) shows a pulsing red dot.
- **Abnormal pickup** keeps the existing alert ring.
- Hover/click → existing day-detail Sheet, but with new sections:
  - "Why this price" — driver chips (already built via `PricingDriverChips`) reused
  - "Last 7 captures" — sparkline of pickup + price changes
  - "Surge events today" — list of velocity events with timestamps
  - One-click "Approve recommendation" / "Hold" / "Override price"

**Density modes:** Week (large cells with chart), Month (combined cells above), Quarter/Year (heatmap of one signal — toggle which signal via segmented control).

**Top KPI strip** (replaces the current single-row info):
- 90-day RevPAR forecast (rate × occupancy)
- Pickup pace vs last week
- Pending recommendations / surge alerts (clickable → filter calendar)
- Auto-pilot status pill: "Auto-pilot ON · last tick 12 min ago" with a toggle.

---

## Part 4 — Analyst panel (more control & insight)

New collapsible panel "Analyst" on the detail page:

1. **Decision log** — every autopilot action (decay, surge, push) with reason + before/after rate. Lets the manager audit the bot.
2. **Pickup velocity timeline** — last 7 days of `booking_velocity_events` charted by hour-of-day → spot booking patterns.
3. **What-if simulator** — sliders for `weekday_decrease_eur`, `surge_threshold`, `auto_apply` toggle. Shows projected next-30-day price curve before saving.
4. **Force re-base prices** — button to reset the next 90 days to `base_price × multipliers` (top-down restart).

---

## Part 5 — Where the autopilot runs

- `revenue-autopilot-tick` invoked from `LiveSyncContext` after every successful `previo-pull-revenue` (so eligible users keep it warm just by being logged in).
- A pg_cron entry hits it hourly for off-hours coverage.
- All actions are idempotent per `(hotel_id, stay_date, captured_at hour bucket)`.

---

## Out of scope (call out, not built)

- Multi-room-kind differential pricing (we set one reference rate; derived rooms follow Previo's existing derivation rules).
- Competitor/rate-shopping data (no provider configured).
- Push to PMS for non-Previo hotels.

---

## Technical details

**New table `booking_velocity_events`**
```sql
create table public.booking_velocity_events (
  id uuid primary key default gen_random_uuid(),
  hotel_id text not null,
  organization_slug text not null,
  stay_date date not null,
  detected_at timestamptz not null default now(),
  arrivals_in_window int not null,
  window_minutes int not null default 60,
  recommended_increase_eur int not null,
  acted boolean not null default false,
  created_at timestamptz not null default now()
);
-- RLS: select for admin/top_management of the org; service role inserts.
create index on public.booking_velocity_events (hotel_id, stay_date, detected_at desc);
```

**`hotel_revenue_settings` additions**
- `auto_apply boolean default false`
- `auto_push_to_pms boolean default false`
- `surge_threshold int default 2`
- `surge_window_minutes int default 60`
- `decay_window_days int default 90`

**`rate_recommendations` additions**
- `priority text default 'normal'` ('normal' | 'urgent')
- `auto_generated boolean default false`
- `auto_pushed boolean default false`

**Files**

New
- `supabase/functions/revenue-autopilot-tick/index.ts`
- `src/components/revenue/StrategyCalendar.tsx`
- `src/components/revenue/AnalystPanel.tsx`
- `src/components/revenue/AutopilotStatusPill.tsx`
- migration: `booking_velocity_events` + settings/rec columns

Edited
- `supabase/functions/previo-pull-revenue/index.ts` — also seed `room_types`, `daily_rates`, defaults; fetch `/rest/prices`.
- `supabase/functions/previo-push-rates/index.ts` — implement for `previo-test`.
- `src/pages/RevenueHotelDetail.tsx` — new combined calendar as default, KPI strip, analyst panel.
- `src/lib/revenuePricing.ts` — expose pure `decayStep()` + `surgeIncrement()` helpers reused by edge function.
- `src/contexts/LiveSyncContext.tsx` — chain autopilot tick after pull.
- `src/components/revenue/CalendarYearView.tsx` — heatmap signal toggle.
- `supabase/config.toml` — register `revenue-autopilot-tick`.

