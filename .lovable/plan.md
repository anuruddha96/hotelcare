## Problem
Daily Overview's `Room` column stores Previo's internal codes, not the room numbers staff/guests know. Each hotel uses a different convention, so today the snapshot stores e.g. `70SNG-306` and a breakfast clerk typing `306` finds nothing. Some rows are also non-room filler (`Departures`, stray totals like `15`, `43`, `82`) and must be skipped.

## Hotel-specific patterns observed in the four uploaded files

| Hotel | Examples | Rule |
|---|---|---|
| Memories Budapest (`memories-budapest`) | `70SNG-306`, `19SYN.DOUBLE-107SH`, `26QDR-114`, `59TRP-209SH` | `^\d+<TYPE>-<ROOM>(SH)?$` — room = digits after last `-`, strip trailing `SH` into `suffix='SH'` |
| Mika Downtown (`mika-downtown`) | `DB - 101`, `TWIN - 103`, `EC - 309`, `SUITE - 1/2`, `ST - 2/6` | `^<TYPE>\s*-\s*<ROOM>$` — room = full token after `-` (digits or `N/M` apartment id) |
| Ottofiori (`ottofiori`) | `DB/TW-102`, `Q-101`, `TRP-104`, `CQ-405` | `^<TYPE>-<ROOM>$` — room = digits after last `-` |
| Gozsdu Court (`gozsdu-court`) | `1B-110`, `1BBALC-3002`, `2B-A21`, `1B-C13`, `1B-2/1/5`, `ST-109` | `^<TYPE>-<ROOM>$` — room = everything after first `-` (mixed alphanumeric / apartment ids) |

Type-code dictionary (used for display + future filtering, no validation gate):
`SNG`=Single, `DB`=Double, `TW`/`TWIN`=Twin, `DB/TW`=Double-or-Twin, `Q`/`QUEEN`=Queen, `TRP`=Triple, `QDR`/`EC.QRP`=Quadruple, `EC`/`ECDBL`=Economy, `SYN.DOUBLE`/`SYN.TWIN`=Synagogue-view, `ST`=Studio, `1B`/`2B`/`3B`=1/2/3-Bedroom, `BALC`=Balcony, `SUITE`=Suite, `CQ`=Corner Queen. Suffix `SH`=Shabbat-friendly room.

Filler rows to drop: `Room` value is empty, equals `Departures`/`Arrivals`, or has no `-` AND parses to nothing (e.g. `15`, `35`, `43`, `82`).

## Changes

### 1. Migration — extend `daily_overview_snapshots`
Add columns and index:
```sql
alter table daily_overview_snapshots
  add column room_number text,
  add column room_type_code text,
  add column room_suffix text;
create index on daily_overview_snapshots (hotel_id, business_date, room_number);
```
Existing `room_label` keeps the raw Previo code for traceability.

### 2. `supabase/functions/revenue-overview-upload/index.ts`
- Add `parseRoomCode(raw, hotelId)` implementing the four rules above and returning `{ room_number, room_type_code, room_suffix }` or `null`.
- Skip the row when `parseRoomCode` returns `null` (filler/junk).
- Populate the three new columns alongside `room_label`.

### 3. `supabase/functions/breakfast-public-lookup/index.ts` & `breakfast-mark-served`
- Match by `room_number` (case-insensitive, trim, strip leading zeros for digit-only inputs) instead of `room_label`. Accept optional `SH` suffix typed by staff but ignore it for matching.
- Look up against both `daily_overview_snapshots` (today's pax/guest names from the latest `business_date`) and existing reservation tables, in that priority order.

### 4. Frontend
- `RevenueHotelDetail.tsx` — show `room_number` (with `room_type_code` as a small muted chip) instead of the raw code in the daily-overview table.
- `Breakfast.tsx` — display `room_number` and the decoded type label; show `Shabbat` badge when `room_suffix='SH'`.

### 5. Shared room-code helper
New `supabase/functions/_shared/roomCode.ts` exporting `parseRoomCode` so both `revenue-overview-upload` and the breakfast lookup functions use the exact same logic. (Edge functions can't import from `src/`, hence the shared folder.)

## Out of scope
- No changes to pickup/occupancy uploads.
- No backfill of historical `daily_overview_snapshots` rows — they'll be re-populated on the next upload. (Easy to add a one-shot UPDATE later if needed.)

## Files
- New migration adding 3 columns + index on `daily_overview_snapshots`.
- New `supabase/functions/_shared/roomCode.ts`.
- Edited: `revenue-overview-upload/index.ts`, `breakfast-public-lookup/index.ts`, `breakfast-mark-served/index.ts`, `src/pages/RevenueHotelDetail.tsx`, `src/pages/Breakfast.tsx`, `src/integrations/supabase/types.ts` (regenerated).
