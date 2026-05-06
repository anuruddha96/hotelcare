## Problem

Two bugs combine to produce the wrong result you saw:

1. **Wrong hotel mapping in `/bb`**: `src/pages/Breakfast.tsx` hardcodes only two locations:
   - `Memories Basement` → `memories-budapest`
   - `Levante` → `mika-downtown` ← **wrong**
   
   Levante and Memories Basement are both restaurants of **Hotel Memories Budapest**. So picking "Levante" actually queried Mika Downtown, where room 306 is a Twin with the Spanish guests — exactly what you saw.

2. **Lookup ignores the date**: `breakfast-public-lookup` pulls the 500 most recent snapshots for the hotel and matches against `snaps[0].business_date` (the latest date in the table), not the `stay_date` the staff entered. If today's file isn't uploaded yet, it silently shows yesterday's data.

## Changes

### 1. `src/pages/Breakfast.tsx` — two-step picker

Replace the flat `LOCATIONS` array with a hotel-first flow:

- **Step 1 — Hotel**: Hotel Memories Budapest, Hotel Mika Downtown, Hotel Ottofiori, Gozsdu Court Budapest.
- **Step 2 — Restaurant** (only when Memories is selected): Levante, Hotel Breakfast (= Memories Basement). For the other three hotels, skip step 2 and use a single default location key (`main`).
- Persist `{ hotel_id, location_key, location_label }` in `localStorage` under `bb_selection_v2`. Show "Hotel Memories Budapest · Levante" in the header with a "Change" button that resets both.
- All subsequent lookups and `markServed` calls use the selected `hotel_id` — never a hardcoded mapping.

Location keys per hotel:
- `memories-budapest`: `levante`, `memories_basement`
- `mika-downtown`: `main`
- `ottofiori`: `main`
- `gozsdu-court`: `main`

### 2. `supabase/functions/breakfast-public-lookup/index.ts` — date-correct lookup

- Query snapshots filtered by **both** `hotel_id` **and** `business_date = stayDate` directly (not "latest 500 then filter").
- If no row for that exact date, fall back to the most recent snapshot ≤ stayDate for that hotel and include `snapshot_date` in the response so the UI can show "Showing data from <date>".
- Continue to match by `normalizeRoomNumber(room_number)`.

### 3. `src/pages/Breakfast.tsx` — UI safety

- Show the active hotel name prominently above the room input so staff cannot mistake which hotel they are checking.
- If the lookup response includes `snapshot_date !== stay_date`, display an amber warning: "No overview uploaded for {date}. Showing {snapshot_date}."

### 4. No DB / RLS changes

`breakfast_attendance.location` already accepts arbitrary text, so the new `main` / `levante` / `memories_basement` keys work without migration. Existing rows remain valid.

## Files

- `src/pages/Breakfast.tsx` (rewrite picker + lookup wiring)
- `supabase/functions/breakfast-public-lookup/index.ts` (date filter + snapshot_date in response)

## Verification

After implementation, on `/bb`:
1. Pick Hotel Memories Budapest → Levante → enter `306` → must return SNG (Single), guests `4. 5.`, breakfast 1 (the memories-budapest row above).
2. Pick Hotel Mika Downtown → enter `306` → returns the Twin with the Spanish guests.
3. Pick Gozsdu Court → enter `306` → returns the 1BBALC.
