# Fix AI analysis + old-school demand grading

## What's broken (verified)

The AI analysis fails for a concrete reason, not an OpenAI problem. The edge function log for the failing run says:

```text
generate-rm-intelligence failed: Unknown hotel
```

The function looks up the property with `select hotel_id, hotel_name, organization_slug from hotel_configurations`, but that table has **no `organization_slug` column** (it stores `organization_id`). The query errors, the lookup returns nothing, and the function throws "Unknown hotel" — so both Refresh and Deep analysis return a non-2xx and the panel shows "AI analysis is temporarily unavailable".

Demand signals are empty (`hotel_events` has 0 rows) and there is no automatic demand input at all today — events are typed in by hand and nothing recalculates.

## 1. Make the AI analysis work

- Read the property with the columns that actually exist (`hotel_id, hotel_name, organization_id`) and resolve the org slug from the organizations table for the isolation check.
- Keep the same isolation rule: non-admins may only analyse a property in their own organisation.
- Return a readable error to the UI instead of a bare 500 when the property or OpenAI key is missing.
- Verify by calling the function for the real hotel and reading the response, not just deploying it.

## 2. One button only

Remove "Refresh" from the Revenue Intelligence header. A single primary button — **Analyse with AI** — runs the deep analysis. Existing throttle/cache and daily call budget stay, with the header text showing when the last analysis ran.

## 3. Demand: old-school grading, no paid data feeds

Hotels priced by hand for a century using three things: how fast the book is filling versus the same period last year, what day/season it is, and what the manager knows about the town. Reproduce exactly that.

**A. Computed demand index (0-100), from data we already own**

Per arrival date, score and weight:

| Signal | What it means | Weight |
| --- | --- | --- |
| Booking pace vs same weekday baseline | rooms on the books vs the property's own trailing average at the same lead time | 30% |
| Pickup momentum | net new nights in the last 7 days for that date | 25% |
| Remaining supply pressure | unsold rooms left versus days to arrival | 25% |
| Lead-time position | how early/late the date is in the property's own booking curve | 20% |

Grade bands: 85+ Very strong, 70-84 Strong, 50-69 Normal, 30-49 Soft, under 30 Weak. Each date shows the band, the score, and the one-line reason behind it.

**B. Manual override — the manager's book**

- A grade control per date or date range: set demand 0-100 (or pick a band) with an optional note, e.g. "town full, medical congress".
- Overrides win over the computed score, are dated, and expire when the stay date passes.
- Every override is shown in the calendar and listed in the panel so the team sees who set it and why.

**C. Events keep working, with weights**

Events stay, but each impact level maps to a fixed, bounded points adjustment on the computed score (very high +15, high +10, medium +6, low -4, negative -10, capped). Events never set a price on their own.

**D. Final demand fed everywhere**

`final_demand = manual override, else computed index + event points (clamped 0-100)`. This single number drives the demand colour in the rate calendar, the AI analyst prompt, and the recommendation reasoning ("demand 82 — strong: pickup +9 nights in 7 days, 12 rooms left at 21 days out").

**E. Panel rewrite**

"Demand signals & events" becomes **Demand board**: a scrollable list of the next 60 arrival dates with score, band chip, drivers, and an inline "Set grade" control; the event form moves under a collapsible "Add event" section. Mobile-first, same card styling as the rest of Revenue.

## Technical notes

- Fix `supabase/functions/generate-rm-intelligence/index.ts` property lookup; re-deploy and test with a real request.
- New table `demand_overrides` (hotel_id, organization_slug, stay_date, score, note, created_by, created_at, unique on hotel+date) with grants for `authenticated`/`service_role`, RLS matching the existing `hotel_events` revenue-user policies.
- Shared scoring module (`src/lib/demandScore.ts`) used by the UI, mirrored inside the edge function so AI and UI never disagree.
- `RevenueIntelligencePanel.tsx`: drop the Refresh button; `MarketSignalsPanel.tsx` becomes the Demand board.
- No third-party market data, no new subscriptions — all inputs come from Previo bookings already synced into `revenue_booking_nights`.
