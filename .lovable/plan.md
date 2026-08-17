# Automation that covers the whole calendar, by lead time

## What I confirmed first

- Ottofiori's rule has `future_booking_window_days = 120`. From today that ends 15 Dec 2026, so **January and February 2027 are outside the automation horizon** — the action log confirms it: the last Jan/Feb decisions were written 15 Aug 17:20 (when the horizon was longer) and nothing since, while Nov/Dec keep getting hourly markdowns.
- The last 3 days of decisions are heavily skewed: ~22,000 markdowns in Nov/Dec, but only a few hundred actions in Aug–Oct — near-arrival dates are barely managed.
- The sold-out guard (`soldOutBlocksIncrease`) only blocks **increases**. Markdowns can still fire on a sold-out date/room type.
- There is no far-out ("beyond the booking window") surcharge on new reservations, and no notification for one; the notification table (`revenue_automation_notifications`) already exists and is used for run summaries.

## What will change

### 1. Cover the full calendar
Raise the evaluation horizon so it matches the grid the manager looks at (6 months / 183 days, and allow up to ~400 days), and process dates in lead-time bands instead of one flat rule. Ottofiori's horizon gets set to the full grid length.

### 2. Lead-time bands (the requested behaviour)

```text
 0–7 days    SELL: if rooms are left, cut the price each run based on occupancy
             (bigger step when occupancy is low, smaller when it is filling).
 8–30 days   REACT TO PICKUP: new bookings raise the price by the tier amount;
             a run with no pickup takes 1 unit off.
31–90 days   HOLD/PROTECT: raise on pickup, small -1 only when clearly weak.
 90+ days    PROTECT & LIFT: any new booking is a strong signal -> add the
             far-out surcharge (default 30-40 EUR, configurable) and never mark
             down more than a token amount.
```

### 3. Sold-out means untouched
Extend the sold-out guard so it blocks **both directions** for that date/room type/occupancy: no markdown, no increase. Applied in the automation engine and kept in the existing publish-time gate.

### 4. Far-out booking surcharge + notification
When a reservation is captured for a stay date beyond the property's booking window (default 90 days), the engine adds a configurable surcharge (default 35, range 0–200) to that date's cells and writes a notification ("Booking received for 5 Jan 2027, 141 days out — price lifted by 35 EUR, review"). It appears in the existing notification centre for the users who already receive automation notifications.

### 5. Rule editor
`PickupAutomationRules.tsx` gets a "Lead-time bands" section showing the four bands with their step/tier values, plus the far-out surcharge and its notification toggle, so the behaviour above is visible and adjustable per property.

## Technical notes

- `supabase/functions/_shared/pricingRules.ts`: add `leadBandFor(daysOut, config)` returning the band and its markdown/increase policy; extend the sold-out guard with `soldOutBlocksAnyChange`; add `farOutSurcharge()`.
- `supabase/functions/revenue-pickup-automation/index.ts`: use the band policy for both the positive-pickup and no-pickup passes, apply the two-way sold-out block before any draft is created, and emit the far-out surcharge + notification on new booking nights past the window.
- Migration: add band and surcharge columns to `revenue_pickup_automation_rules` with neutral defaults matching today's behaviour, then set Ottofiori's horizon to the full grid.
- Existing guards (ADR floor, daily caps, manual hold, cancellation cooldown, whole-number prices) stay exactly as they are.
- Other properties keep their current settings; only Ottofiori's horizon is changed as data.
