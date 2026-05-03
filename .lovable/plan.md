## Scope

Four parallel work items on the new RPG-style Revenue module:
1. Fix RLS gaps in Phase-1 tables.
2. Build Phase-2 settings tabs (Rooms, DOW, Monthly, Lead Time).
3. Add Quarter (3-month) and Year (12-mini-month) calendar zoom views.
4. Show rule-engine multipliers + driver chips in the day-detail side panel.

---

## 1. RLS verification & fixes

Findings from `20260502202638_..._.sql`:

- **SELECT policy** (`rev_admin_read_*`) currently includes `manager` and `housekeeping_manager` — that's WRONG for revenue (housekeeping managers should not see pricing strategy/PMS rate-plan mappings/surge events). Tighten to `admin`, `top_management`, and a new `manager_can_view_revenue` flag-driven role: `manager` only.
- **WRITE policy** is admin/top_management only — correct, but `manager` role is left unable to even read. We will allow `manager` SELECT (read-only on calendar settings, identical to existing `is_revenue_user` pattern) but keep WRITE locked to admin/top_management.
- **`hotel_id` scoping missing**: policies only check `organization_slug`. A manager assigned to Hotel A could read settings for Hotel B in the same org. Add `AND (public.get_user_role(auth.uid()) IN ('admin','top_management') OR public.get_user_assigned_hotel(auth.uid()) = hotel_id OR public.get_user_assigned_hotel(auth.uid()) = public.get_hotel_name_from_id(hotel_id))`.
- **`revenue_ingest_runs` and `surge_events`** need INSERT permission for the service role only — frontend should never insert these. Add an explicit `FOR INSERT ... USING (false)` for non-service callers (service-role bypasses RLS, so edge functions still work).
- **`hotel_revenue_settings`** already uses `is_revenue_user` (admin + top_management) — leave as-is, but add hotel-scoping clause.

Plan: one new migration that DROPs the generic policies created in the last migration and re-creates them with hotel-scoping + role-tightening, plus a hotel-scope addition to `hotel_revenue_settings`, `pickup_snapshots`, `rate_recommendations`.

---

## 2. Phase-2 settings UI (Rooms, DOW, Monthly, Lead Time)

New folder `src/components/revenue/settings/` with one file per tab, each ~150 lines, autosave on blur:

- `RoomsSetupTab.tsx` — table over `room_types` with columns Name, PMS Room, PMS Rate, # Rooms, Reference toggle, Derivation mode (% / €), Derivation value, Base €, Min €, Max €. "Add room" button, inline delete with confirm. Total-rooms footer.
- `DOWTab.tsx` — 7 number inputs (Mon–Sun, %) over `dow_adjustments`. Recharts bar chart of resulting multiplier.
- `MonthlyTab.tsx` — 12 inputs (Jan–Dec) over `monthly_adjustments` + bar chart.
- `LeadTimeTab.tsx` — 9 inputs for buckets `6m_plus, 3m_plus, 1_5m_3m, 4w_6w, 2w_4w, 1w_2w, 4d_7d, 2d_3d, last_day` over `lead_time_adjustments`.

Wire them into `RevenueHotelDetail.tsx` under a new sub-tab group "Pricing Strategy" so the existing Prices/Events/Pickup/Min Stay tabs stay first-class.

Persistence pattern (matches existing settings flow): upsert by `(hotel_id, organization_slug, key)`, toast on save, optimistic UI.

---

## 3. Year & Quarter calendar zoom

Two new components:

- `src/components/revenue/CalendarQuarterView.tsx` — renders 3 months side-by-side (current + 2 ahead). Each cell is the same `DayCell` already used by month view, just with smaller padding. Re-uses `rowsByDate` map untouched.
- `src/components/revenue/CalendarYearView.tsx` — 12 mini-months in a 4×3 (desktop) / 2×6 (tablet) / 1×12 (mobile) grid. Each cell is a 12×6 dot grid; cell colour = price-band gradient (green ▲, red ▼, neutral grey) derived from `suggestedDelta`. Hover/click drills into the existing day side-panel.

Add a 4-button view switcher in the header: `Week | Month | Quarter | Year`. Year view loads the full 365-day window already fetched (no extra queries).

Layout follows attached RPG screenshots: month-name header on each mini-month, weekday header `M T W T F S S`, day numbers arranged on the proper weekday columns.

---

## 4. Driver-chip side panel

Replace the existing day-panel "Reason" line with a structured **Pricing Drivers** section that mirrors the new engine formula:

```text
Base price          €120  (room_types.base_price_eur)
× DOW (Sat)         ×1.15  (+15%)
× Month (Aug)       ×1.10  (+10%)
× Lead time (1–2w)  ×1.05  (+5%)
× Occupancy target  ×1.08  (running 78% vs 70% goal)
× Pickup tier       +€8    (tiers from hotel_revenue_settings)
─────────────────────────
Suggested rate      €172
Clamped to [min, max]  €172
```

Each line is a chip with the source-table name as a tooltip, and a "Why this number?" link that opens the corresponding settings tab pre-filtered to that row. Chips are colour-coded: green (boost), red (cut), grey (neutral). When a setting is missing, chip shows "—" so the gap is obvious.

We also extract the rule-engine logic from `RevenueHotelDetail.tsx` into `src/lib/revenuePricing.ts` (`computeSuggestedRate(row, settings, multipliers) → { rate, breakdown[] }`) so the same code drives both the chip render and the actual recommendation insert. The `rate_recommendations.reason` column gets the same breakdown serialised, so the existing approval/audit flow keeps full traceability.

---

## Technical details

**Migration** (`supabase/migrations/<ts>_revenue_rls_tighten.sql`):
- Drop and recreate generic policies for the 14 Phase-1 tables with hotel-scope + role-tighten.
- Add `hotel_id` scope to `hotel_revenue_settings`, `pickup_snapshots`, `rate_recommendations`, `rate_history`, `rate_change_audit`, `revenue_alerts`.
- New helper `public.user_can_access_hotel(_uid uuid, _hotel_id text) returns boolean` (SECURITY DEFINER) to keep the policies short and avoid duplication.

**Files added**:
- `src/components/revenue/settings/RoomsSetupTab.tsx`
- `src/components/revenue/settings/DOWTab.tsx`
- `src/components/revenue/settings/MonthlyTab.tsx`
- `src/components/revenue/settings/LeadTimeTab.tsx`
- `src/components/revenue/CalendarQuarterView.tsx`
- `src/components/revenue/CalendarYearView.tsx`
- `src/components/revenue/PricingDriverChips.tsx`
- `src/lib/revenuePricing.ts`

**Files edited**:
- `src/pages/RevenueHotelDetail.tsx` — add sub-tabs, new view modes, integrate driver chips, swap inline engine math for `revenuePricing.ts`.

**Hooks/queries**: each settings tab fetches its own table (single round-trip), so the existing `load()` in RevenueHotelDetail isn't slowed down. Quarter/Year views need no extra fetch — they reuse the 365-day buffer already loaded.

**Housekeeping safety**: zero changes to housekeeping tables, RLS, or pages. All edits scoped to `revenue/`, the Phase-1 revenue tables, and the new helper function.

**Out of scope** (deferred to next batch): Occupancy Strategy, Min-Stay settings, Yielding Tags, Surge Protection, Benchmarking, daily ingest engine, Previo push wiring — covered by later phases in `.lovable/plan.md`.

**Verification after build**: I will (a) read back each new policy via `supabase--read_query` impersonating each role, (b) save & reload one row in each new settings tab, (c) toggle Year/Quarter/Month views and confirm cells render, (d) open a day with multipliers configured and confirm chips show the exact numbers, and (e) smoke-test housekeeping Auto-Assign and Team View to confirm no regression.