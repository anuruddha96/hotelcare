# Map SLNT units and venues from the two Previo cleaning exports

Both uploaded exports match the seeded draft exactly (9 units for Previo 782407, 52 real units + 2 `Technikai` rows ignored for 783103). The draft mapping already exists but nothing is grouped into venues yet: all 61 rows still have no venue and no room, and 4 rows are flagged as conflicts.

This step turns the draft into a verified venue/unit structure, still SLNT-only and still behind an explicit Apply.

## Venue grouping to be created (21 venues, 61 units)

PMS 1 — Previo 782407 (8 venues, 9 units)

| Venue | Units |
|---|---|
| Grandio | Grandio 1, Grandio 2 |
| Best View Budapest | 1 |
| CityNest | 1 |
| Dandelion Apartment | 1 |
| DobNest | 1 |
| Park&Garden – Kis Kazinczy | 1 |
| Saphir Apartment | 1 |
| Urban Oasis | 1 |

PMS 2 — Previo 783103 (13 venues, 52 units)

| Venue | Units |
|---|---|
| Silver Rooms | 1–21 (no 20 missing; 21 units total) |
| St King 11 | Room 1–9 (9) |
| K4 | Room 1–7 (7) |
| WR Pension | 101–106 (6) |
| Elisabeth Downtown | One Bedroom, Studio (2) |
| Be Local Budapest | 1 (conflict) |
| Castle Garden Residence | 1 |
| Dorothilux Apartment | 1 (conflict) |
| Downtown Terrace Passion | 1 |
| Duplex Penthouse Terrace – Klauzál utca 11 | 1 |
| Giselle Apartment | 1 |
| Sobi Apartment | 1 |

No street addresses are invented — venue addresses stay empty until Previo API metadata or manual entry supplies them.

## What happens

1. Re-import both uploaded files through the existing SLNT importer so `source_file` / `source_date` are recorded (idempotent — no duplicates, `Technikai` skipped, trailing-space names normalised).
2. Attach a `suggested_venue_name` to every row per the tables above and set the group rows (Silver Rooms, St King 11, K4, WR Pension, Elisabeth Downtown, Grandio) to high confidence.
3. Create the 21 `venues` rows for the SLNT organization, one per cluster, and link each mapping to its `venue_id`.
4. Mark the 57 unambiguous rows `confirmed`. The 4 Staymood rows (Be Local, Dorothilux, Giselle, Sobi) stay in review until you decide — see below.
5. You press **Apply verified mapping** in the review UI: that creates the canonical `rooms` for confirmed rows, attaches `venue_id`, and links external Previo IDs. Nothing becomes live housekeeping inventory before that click.

## The 4 conflicts

Dorothilux (1002801), Giselle (1002803), Be Local (1002805) and Sobi (1002807) appear on the Previo room-type screen you shared, which belongs to the *Vedrusz Apartmanok* profile, while their longer names appear in the 783103 housekeeping export. They will be shown as one review card each with a "same unit, different profile" explanation, plus a **Confirm ownership: 783103** action. Confirming keeps the external type ID and clears the conflict; I will not resolve it silently.

## Technical notes

- Only `pms_unit_mappings`, `venues` and (on Apply) `rooms` rows scoped to the SLNT organization are touched. Existing rows for other tenants are untouched; no schema changes.
- Silver Rooms 20 is present in the export and included; the sequence has no 20 gap after normalisation — the numbering 1–21 minus none is preserved as-is from the file.
- The review UI gains a venue column filter and a "bulk confirm cluster" action so you can eyeball the 21 venues quickly.
- Verification: re-run the import twice and assert the mapping count stays 61; assert `Technikai` never appears; assert Apply creates exactly 57 rooms on first pass and 0 duplicates on a second pass.

## Where to check

Admin → Venues & Access → **Previo unit mapping review**: grouped by venue, with the 4 conflict cards pinned at the top.
