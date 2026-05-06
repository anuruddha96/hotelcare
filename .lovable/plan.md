## Problem

1. **Wrong guest names** for room 306. Today's overview parser picks `ongoing || arrival || departure` as the guest cell. For breakfast on 06/05, the guest who slept in the room last night is the **Departure** or **Ongoing** guest — never **Arrival** (they haven't arrived yet). Room 306 = `(1) DOMINIK FURTWAENGLER` in Departure, but UI shows `(1) Hein Gunter` from Arrival.
2. The page lacks an at-a-glance view of the day — staff need to see all rooms eligible for breakfast and their status (pending / partial / served / not arrived).

## Fix 1 — Guest selection priority (parser)

In `supabase/functions/revenue-overview-upload/index.ts`, change the guest cell priority for breakfast-context rows:

- **Departure** wins (guest checking out today ate breakfast this morning).
- Then **Ongoing** (mid-stay guest).
- **Arrival** is ignored for guest_names/pax (they arrive in the afternoon — not at breakfast).

Status logic stays the same, but `guest_names`/`pax` are derived only from Departure ⟶ Ongoing. If only Arrival is present, `guest_names = null`, `pax = 0`, and `status = "arriving"` (not eligible for today's breakfast — they weren't here last night).

The breakfast/lunch/dinner counts in the row already reflect today's meals correctly so they stay as-is.

User must re-upload the affected daily overview xlsx after deploy.

## Fix 2 — Lookup respects the new rule

`breakfast-public-lookup` already returns `guest_names` and `status` from the snapshot, so no logic change needed beyond Fix 1. Add an `arriving` short-circuit: if status is `arriving` and breakfast counts are 0 → return `not_eligible_no_breakfast` with hint "Guest has not arrived yet."

## Fix 3 — Replace "Show today's served list" with a Room Chip Grid

In `src/pages/Breakfast.tsx`, below the lookup card, render a grid of small room chips for the selected hotel + date.

**Data source:** new edge function `breakfast-rooms-overview` (or extend `breakfast-public-lookup` with a `mode: "list"` branch). Returns for the selected hotel/date:

```
[
  { room: "306", room_type_label: "Single", pax: 1, breakfast: 1,
    served: 1, status: "served" | "partial" | "pending" | "arriving" | "no_breakfast",
    guest_names: [...] }, ...
]
```

It joins `daily_overview_snapshots` with aggregated `breakfast_attendance` for that hotel+date and computes status:
- `arriving` → arrival-only row, no Departure/Ongoing guest
- `no_breakfast` → breakfast=0 and all_inclusive=0
- `served` → served_total ≥ breakfast count
- `partial` → 0 < served_total < breakfast count
- `pending` → eligible, served_total = 0

**UI:**

```text
[ 101 ] [ 102 ] [ 103✓ ] [ 104◐ ] [ 105 ] ...
 pend    pend    served   partial  pend
```

Color codes (Tailwind):
- pending: `bg-blue-100 text-blue-900 border-blue-300`
- partial: `bg-amber-100 text-amber-900 border-amber-400`
- served: `bg-green-100 text-green-900 border-green-400`
- arriving: `bg-slate-100 text-slate-500 border-slate-300` (muted, disabled-look)
- no_breakfast: `bg-rose-50 text-rose-700 border-rose-200`

Chip shows room number + a small icon/dot. Tapping a chip calls the same `lookup()` flow with that room number — opens the existing eligible card so the staff can confirm/partial-confirm.

A small legend row above the grid explains the colors.

**Real-time updates:** subscribe to `breakfast_attendance` Postgres changes filtered by `hotel_id=eq.{selection.hotel_id}` and `stay_date=eq.{date}` via `supabase.channel(...).on("postgres_changes", ...)`. On INSERT/UPDATE/DELETE, refetch the chip list (debounced ~300ms). Also refetch right after a successful `markServed`.

Remove the existing "Show today's served list" toggle and `loadTodayList`/`todayList` state — the chip grid replaces it.

## Translation keys

Add to `src/lib/breakfast-translations.ts` for en/hu/es/vi/mn/az: `roomsTitle`, `legendPending`, `legendPartial`, `legendServed`, `legendArriving`, `legendNoBreakfast`, `notArrivedYet`.

## Files to change

- `supabase/functions/revenue-overview-upload/index.ts` — guest cell priority + pax derivation
- `supabase/functions/breakfast-public-lookup/index.ts` — `arriving` short-circuit; new `mode: "list"` returning per-room status
- `src/pages/Breakfast.tsx` — remove served-list toggle; add chip grid + realtime subscription + click-to-open
- `src/lib/breakfast-translations.ts` — new keys in 6 languages

## Out of scope

- No DB schema change.
- Re-upload of past xlsx files needed for guest names to correct.
