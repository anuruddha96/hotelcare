
## Goal

Make the Revenue Management feature actually decision-ready: after uploading the Previo pickup XLSX, the revenue manager should immediately see, **per hotel and per date**, how pickup is moving and which dates are candidates to raise/lower prices — with an **AI assistant** that explains the "why" and proposes batch actions. Then finish the loose ends from the previous turn (Header link, Breakfast tooling, translations).

---

## Part 1 — Per-date pickup view (Hotel detail page rebuild)

Rebuild `RevenueHotelDetail.tsx` from a single recommendations table into a **120-day data grid** that fuses pickup snapshots + recommendations + history into one row per date.

For each `stay_date`:
- Latest `bookings_current`, prior snapshot value, and **Δ since last snapshot** (true "pickup in window")
- Δ vs same date last year (`bookings_last_year`)
- Latest `rate_history.new_rate_eur` as the live PMS rate
- Pending recommendation (if any) with Approve / Override / Dismiss
- Coloured row tint: red border when Δ ≥ abnormal threshold, green when Δ ≥ 3 (price-up candidate), amber when 0 pickup for ≥ 24h (price-down candidate)
- Day-of-week chip, "days out" chip, weekend marker

Top of page adds three views via Tabs:
1. **List** (the grid above, default)
2. **Calendar heatmap** — 120-day grid, cell colour by pickup Δ, click → opens that date's row
3. **Trend** — small line chart (recharts, already in repo) of total bookings per date over time

Add a hotel-level KPI strip: total pickup last 24h / 7d / 30d, # abnormal alerts, # pending recs, sell-out dates count.

## Part 2 — AI Revenue Analyst

New edge function `revenue-ai-analyze` that:
- Accepts `{ hotel_id, horizon_days?: 120 }`
- Pulls last 30 days of `pickup_snapshots`, current `rate_history`, `hotel_revenue_settings`, and pending `rate_recommendations` for that hotel
- Calls the **Lovable AI Gateway** (`google/gemini-2.5-flash`) with a structured-output schema returning:
  ```
  { summary, top_increase_dates[{date,reason,suggested_delta_eur,confidence}],
    top_decrease_dates[{...}], anomalies[{date,note}], strategy_notes }
  ```
- Persists the result into a new table `revenue_ai_insights (hotel_id, generated_at, payload jsonb, generated_by)` so the user can re-open without re-spending tokens

UI: new **"AI Analysis"** card at the top of the hotel detail page with:
- "Generate analysis" button (shows last generated timestamp)
- Summary paragraph
- Two side-by-side lists: **Increase candidates** / **Decrease candidates**, each row has "Apply suggestion" → creates a `pending` `rate_recommendation`
- **Anomalies** list linking each date to its row in the grid

Also surface a single "Ask AI about this date" button on each grid row → opens a small dialog that calls the same function with a `focus_date` and renders the answer (reuse for ad-hoc questions).

## Part 3 — Dashboard for the Revenue page

Upgrade `Revenue.tsx` hotel cards:
- Add sparkline of last 14 days pickup
- Add "Top 3 movement dates" preview (next 120d, biggest abs Δ)
- Add "AI insight" badge if a fresh insight exists (< 12h old)

## Part 4 — Finish previously deferred items

1. **Header link**: add a "Revenue" entry (icon `TrendingUp`) in `Header.tsx`, gated to `admin` / `top_management`, navigating to `/{org}/revenue`
2. **Breakfast roster upload tile** (`BreakfastRosterUpload.tsx`) on the reception/manager dashboard — wraps `breakfast-roster-upload` edge function, shows last upload time + row count
3. **Breakfast code admin tab** (`BreakfastCodeManagement.tsx`) inside `AdminTabs` — list/create/rotate `hotel_breakfast_codes`
4. **Translations**: add Revenue + Breakfast strings (Prices, Pickup, Recommended, Approve, Override, Increase candidates, etc.) to `comprehensive-translations.ts` for `en/hu/es/vi/mn`
5. **Memory file** `mem://features/revenue` summarising tables, engine cadence, AI function name

## Technical notes

- **New DB**: one table `revenue_ai_insights` (RLS: only `admin` + `top_management` of that org). No other schema changes needed.
- **AI Gateway**: use `LOVABLE_API_KEY` already available; model `google/gemini-2.5-flash` with `tool_choice` for structured JSON. Handle 429/402 with toast.
- **No Previo push yet** (still gated until rate-plan IDs provided — already documented in UI)
- **Performance**: the per-date grid joins client-side from at most ~240 snapshot rows + 120 rec rows + 120 history rows — fine in one query each, no pagination needed

```text
Hotel detail layout
┌────────────────────────────────────────────────┐
│ KPI strip: pickup 24h | 7d | 30d | alerts | …  │
├────────────────────────────────────────────────┤
│ AI Analysis card  [Generate]  [Last: 09:25]    │
│  ▸ summary                                     │
│  ▸ Increase ⇡   |   Decrease ⇣                 │
├────────────────────────────────────────────────┤
│ Tabs:  [ List ] [ Calendar ] [ Trend ]          │
│  Date │ DOW │ Days out │ Pickup Δ │ vs LY │…   │
└────────────────────────────────────────────────┘
```

## Out of scope (ask later if needed)

- Live Previo Rate API push (waiting on credentials)
- Multi-rate-plan / per-room-type pricing (current scope is reference room only)
- Auto-approval of AI suggestions (always staged as `pending`)
