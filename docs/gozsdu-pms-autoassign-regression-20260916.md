# Gozsdu Court — 16 September 2026 PMS / Auto Assign regression

## Verified evidence (Budapest local time, read-only queries)

- Morning 06:00: Previo rooms mapping reported 82/82; room sync updated all 82 without a full room import.
- 09:29: `import_rooms` upserted all 82 rooms; further full imports occurred through the day. This is the point at which the write path changed, but without full row history it cannot be proven to be the sole cause of classification drift.
- Later selected-date Previo overview: 82 unique rooms and 25 scheduled departures. Stored `rooms.is_checkout_room` was only 3 after the evening import. A sparse *actual checkout* poll cannot represent all scheduled departures.
- Registry / manager mappings: 66 operating units and 16 inactive. All 66 operating units have manager-mapped housekeeping sections, size, verified beds and configured `gozsduAutoAssign` minutes. Do not overwrite or remap them.

## Physical sharing policy — only Gozsdu

- Building I, II ↔ Holló 12; Building I and II can be grouped together.
- Building III, IV, V ↔ Holló 10 and Kazinczy A/B/C; III, IV, V can group together.
- Kazinczy A/B/C ↔ either Holló 12 or Holló 10, but NEVER Building I or II.
- Holló 12 ↔ Holló 10, Building I/II ↔ III/IV/V, and Holló 12 ↔ III/IV/V are not authorized combinations.
- Use `hotel_housekeeping_sections` / `hotel_housekeeping_section_rooms` for route identity. `gozsduAvailability.buildingCode` (such as `1B`) is a PMS room-category code repeated across physical sites, not a walking route.

## Acceptance gates

1. The today room overview and live Auto Assign must read the same 82-row, fresh, selected-date Previo overview. If incomplete/stale, leave existing live assignment data intact and refuse a new unverified preview rather than assigning incorrect rooms.
2. Preserve actual started/completed work, manager-configured size/beds/service and checkout durations; these are read-only projections, not a production room-table rewrite.
3. Allocate only due operating tasks. Include every selected eligible unit once, never inactive units or a Laundryner, and ensure every assigned worker's section combination obeys the matrix above.
4. Balance estimated minutes, checkout load and verified bed effort; only split a mapped section when justified by excessive workload imbalance or shift capacity. Incompatible routes require at least two available cleaning employees and fail closed otherwise.
5. Guard manual moves and final confirmation, including existing saved plans; leave all non-Gozsdu properties on their previous algorithms.
6. Verify focused and complete CI before merging PR #209. Confirm live property-level behavior after actual deployment; GitHub green checks alone do not verify the production app.
