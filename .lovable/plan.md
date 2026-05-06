## 1. Auth screen logo spacing

In `src/pages/Auth.tsx` the logo block uses `-space-y-2` on a flex container with a 192px-tall image, which collapses the logo into the title and creates the awkward whitespace gap shown in the screenshot.

- Remove `-space-y-2` and `gap-0`; use `gap-1`.
- Reduce logo to `h-20 sm:h-24 md:h-28` so the lotus and "Hotel Care" wordmark sit close together.
- Tighten `CardHeader` spacing to `space-y-1 pb-3`.

## 2. Move Revenue into the main navigation

- Remove the standalone `Revenue` button from `src/components/layout/Header.tsx`.
- Add a new entry to `PMS_NAV_ITEMS` in `src/components/layout/PMSNavigation.tsx`:
  `{ key: 'revenue', icon: TrendingUp, labelKey: 'pms.revenue', roles: ['admin', 'top_management'] }`.
- Drop the `profile?.role !== 'admin'` early-return in `PMSNavigation` so `top_management` also sees the bar (each item already filters by role).
- Add `pms.revenue: "Revenue"` to translation files.

## 3. Organization-scoped hotels in Revenue

`src/pages/Revenue.tsx` currently loads every active hotel. Change `load()` to:

1. Resolve the user's organization via `profile.organization_slug` → `organizations.id`.
2. Query `hotel_configurations` with `.eq('organization_id', orgId).eq('is_active', true)`.
3. Same scoping applied in `RevenueHotelDetail` guard.

This removes "HotelCare.App Testing" for RD Hotels users.

## 4. Richer Revenue hotel cards

Enhance each card in `src/pages/Revenue.tsx` with:

- **Occupancy strip** (next 7 / 14 / 30 days) from the latest `occupancy_snapshots` row — show `% occ` and `rooms sold / total`.
- **Pickup detail list**: top 3 dates with biggest positive Δ in the last snapshot, formatted `Sat 9 May  +6`. Pulled from `pickup_snapshots` (group by `stay_date`, sum `delta` in last 24h).
- **Mini bar chart** of next-14-day occupancy (replace today's sparkline of pickup deltas with a more meaningful occupancy chart; keep pickup Δ as a number badge).
- **Last upload** chip: filename + captured_at + uploader.
- **Quick actions**: Open · Upload · Run AI (admin/top_mgmt).
- Layout: switch grid to `md:grid-cols-2 xl:grid-cols-3` and give each card a header row, KPI row, occupancy chart, pickup list, footer actions.

A small new component `RevenueHotelCard.tsx` keeps `Revenue.tsx` readable.

## 5. /bb Breakfast page — public, no QR gate

Currently `Breakfast.tsx` shows the "scan QR" warning when no `hotelCode` is in the URL. Replace with a fully public flow used by breakfast staff:

**UI changes** (`src/pages/Breakfast.tsx`):
- Drop the `if (!hotelCode)` warning card entirely.
- On first load, prompt the staff to choose a **breakfast location**:
  - `Memories Basement` (hotel_id = Hotel Memories Budapest)
  - `Levante` (hotel_id = Hotel Mika / Levante hotel)
  - Persist choice in `localStorage` so re-opens skip the picker.
- After location is chosen, show: room input, date (default today), and a Check button.
- Result card shows guest name(s), nights remaining (`departure - today`), pax, breakfast count, and:
  - A **"Mark X served"** stepper (default = `breakfast_count`) and **Confirm** button.
  - On confirm, insert into a new `breakfast_attendance` table.
- Add a "Today's served list" toggle showing rooms already marked at this location (so staff don't double-count).

**Data model** (new migration):
```sql
create table public.breakfast_attendance (
  id uuid primary key default gen_random_uuid(),
  hotel_id text not null,
  organization_slug text,
  location text not null,         -- 'memories_basement' | 'levante'
  stay_date date not null,
  room_number text not null,
  served_count int not null,
  guest_names text[],
  served_by text,                 -- staff label (optional free text)
  created_at timestamptz default now()
);
alter table public.breakfast_attendance enable row level security;
-- public insert via edge function only; managers/admins can select for their hotel
create policy "mgr select" on public.breakfast_attendance
  for select using (
    public.has_role(auth.uid(),'admin') or
    public.has_role(auth.uid(),'top_management') or
    public.has_role(auth.uid(),'manager')
  );
```

**Edge functions**:
- New `breakfast-public-lookup` — same shape as `breakfast-lookup` but takes `{ hotel_id, room, date }` directly (no code), with rate limiting.
- New `breakfast-mark-served` — inserts a row into `breakfast_attendance`. Validates `hotel_id`, `room`, `served_count`. Public CORS, IP rate limit.
- Keep existing `breakfast-lookup` for legacy QR flows.

**Manager view** (`src/components/admin/BreakfastAttendanceView.tsx`, mounted in admin tabs and reports):
- Table of today's attendance: location, room, served_count, guest, time.
- Filter by date and location; CSV export.
- Visible to admin / manager / top_management for their hotel only (RLS + query filter).

**Routing**:
- `/bb` → location picker + lookup form (public).
- `/bb/:hotelCode` → preserves existing QR deep-link (auto-selects location based on code mapping).

## Technical summary

Files changed:
- `src/pages/Auth.tsx` (logo spacing)
- `src/components/layout/Header.tsx` (remove Revenue button)
- `src/components/layout/PMSNavigation.tsx` (+revenue tab, allow top_management)
- `src/pages/Revenue.tsx` + new `src/components/revenue/RevenueHotelCard.tsx`
- `src/pages/RevenueHotelDetail.tsx` (org guard)
- `src/pages/Breakfast.tsx` (full rewrite of empty-state flow)
- New `src/components/admin/BreakfastAttendanceView.tsx` and admin tab wiring
- New migration creating `breakfast_attendance` + RLS
- New edge functions `breakfast-public-lookup`, `breakfast-mark-served` (+ `supabase/config.toml` registration)
- Translation strings (`pms.revenue`, breakfast labels)

No breaking changes to existing pickup/occupancy upload flows.
