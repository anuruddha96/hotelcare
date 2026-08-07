# SLNT Team View: venue-grouped chips + real Previo clean-status round trip

SLNT-only. Every change below is gated on the SLNT tenant flags (`venuesEnabled` / org slug `slnt`). Ottofiori and RD Hotels keep byte-identical behaviour, chips, grouping and PMS logic.

## 1. Organize the Checkout / Daily chips by venue

Today the board groups chips by floor. All 61 SLNT units sit on floor 0, so every chip lands in one flat "F0" row and it is impossible to see which building a unit belongs to. All 61 SLNT rooms already carry a `venue_id` (20 venues), so:

- For SLNT, group each section by venue instead of floor: one row per venue with the venue name as the row label (Silver Rooms, St King 11, K4, WR Pension, Grandio, and the single-unit apartments last).
- Inside a venue, units are sorted naturally (Room 1, 2, 3 … 18).
- Single-unit venues collapse into one shared "Standalone apartments" row so the board does not become 20 near-empty rows.
- Each chip gets a coloured left edge (a 3px bar) whose colour is the venue's colour, so the same building is instantly recognisable even after chips move into a housekeeper card. Venue colour is derived deterministically from the venue id from a fixed palette of design-system tokens, so it is stable across sessions and consistent between the board and the housekeeper cards.
- The venue row label is also a drag target shortcut: dragging a venue label onto a housekeeper card stages every still-unassigned unit of that venue to that housekeeper in one move (using the existing staged-assignment queue, so it is still a single Apply).
- Hotel tenants keep the existing floor grouping and chips with no left bar.

## 2. Pull the real Previo clean status for every unit

The Previo REST roster already returns a per-room housekeeping status (`roomCleanStatusId`) and the sync function already maps it to a `Status` label. On the app side that value is currently discarded for any room that has a reservation today: the refresh forces "dirty" for every checkout/daily room.

For SLNT only:

- When Previo reports an explicit clean status for a unit, that status becomes the source of truth for `rooms.status` (Clean → clean, Untidy → dirty), instead of the blanket "has a reservation today ⇒ dirty" rule.
- A unit cleaned and approved in HotelCare today is never pushed back to dirty by a later sync, unless Previo confirms a departure after the clean finished (the existing guard, kept).
- Units with no Previo status keep today's behaviour.
- The refresh also stores each unit's Previo room id on the room record (`pms_metadata.roomId`) once it has been resolved by the unit resolver. None of the 61 SLNT rooms has it today, which is the reason no status can currently be pushed back.

## 3. Push "clean" back to Previo when a supervisor approves

Approval already flips the unit to clean inside HotelCare (a database trigger does this, and it applies to SLNT today). What does not happen is the push back to Previo: both the outbound queue trigger and the push edge function look the unit up in `pms_configurations` / `pms_room_mappings`, and SLNT has neither — it uses `pms_accounts` and `pms_unit_mappings`.

- Teach the push path to resolve a unit through `pms_unit_mappings` → `pms_accounts` when no legacy configuration exists, so SLNT units resolve to the right Previo account (782407 or 783103) and the right external room id (60 of 61 mappings already carry one).
- On supervisor approval of an SLNT unit: mark clean locally (already happens), then push clean to the owning Previo account, and log the attempt in the sync history exactly like Ottofiori does.
- Failures never block approval — they surface as a warning toast and a failed row in sync history, and the unit stays clean locally.
- Ottofiori's existing allowlist/kill-switch gating is untouched; SLNT gets its own equivalent switch on `pms_accounts` so the push can be turned off per account without code changes.

## 4. RTC (ready to clean) behaves exactly like Ottofiori

The Ottofiori rule already implemented centrally: a checkout unit is ready to clean only when PMS confirms the departure **today**; daily units are always ready; a manual release stays sticky for the day; each refresh corrects assignments whose RTC flag disagrees. This logic is currently applied on the file-upload and refresh path but is bypassed for SLNT units that failed to match. With the resolver now matching them, the same rule runs for SLNT with no rule changes — the plan only makes sure the SLNT path calls it for every matched unit and stamps `readyToCleanDate` so the flag expires at the end of the day like it does for Ottofiori.

## 5. Technical notes

- Files: `src/components/dashboard/HotelRoomOverview.tsx` (venue grouping, chip left bar, venue-row drag), `src/components/dashboard/HousekeepingManagerView.tsx` (same colour bar on the chips inside housekeeper cards), `src/lib/pmsRefresh.ts` (Previo clean status precedence, room id persistence, RTC for matched units), `supabase/functions/previo-update-room-status/index.ts` (pms_accounts / pms_unit_mappings fallback), plus a small venue-colour helper next to `propertyTerminology.ts`.
- Database: one migration adding a per-account outbound switch on `pms_accounts` and extending the outbound-queue trigger to recognise portfolio accounts. No changes to any table used by Ottofiori or RD Hotels.
- No new dependencies.

## 6. Checks before hand-off

- Ottofiori and RD Hotels Team View: floor grouping, chip appearance, status and RTC behaviour byte-identical; PMS refresh diff shows no unexpected status flips.
- SLNT: chips grouped under the 20 venues with consistent colour edges; dragging a venue label stages the whole building.
- After a PMS refresh, unit statuses match what Previo shows for the same units.
- Approving a unit turns it clean in HotelCare and clean in Previo, with a success row in PMS sync history.
- A checkout unit stays not-ready-to-clean until Previo confirms the departure, and a manual release survives the next refresh.
