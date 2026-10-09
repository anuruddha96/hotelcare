# SLNT Team View — Gozsdu-style individual room row specification

Originally requested September 22, 2026 and superseded by the October 9, 2026 SLNT layout decision. UI-only implementation: preserve the HotelCare room overview, its checkout/daily classification and room-level interaction handlers, and the separate Hotel Memories and RD Hotels interfaces.

## Verified customer request
Fruzsina Darázsi's September 21 email asks for three separate cleaning types (normal, daily and deep), team-to-apartment assignment, conspicuous unassigned rooms, and a simplified role-specific interface. It **does not specify** a daily-cleaning cadence, day-of-stay rules, or mapping from the three cleaning types to the two existing room categories. No service scheduling, assignment types, or checkout semantics may be redefined based on an assumption.

## Implementation
- SLNT Team View only: use the same visual hierarchy as Gozsdu Court — one physical venue/department label at the left and independent room chips to the right. Rooms wrap within their own venue row.
- Never collapse multiple SLNT rooms into one grouped/selectable/draggable venue chip. A venue such as WR with WR 1, WR 2, WR 3, WR 4 and WR 5 must show five independent room cells.
- Both existing Compact/Roomy stored preferences converge to this row layout, so a saved preference cannot bring back the superseded grouped-cluster view. Hide the now-irrelevant density toggle in this scoped board.
- Retain every chip and badge, full room identifiers, room click and drag/drop handlers, selection and existing checkout/daily section hierarchy; leave exceptions (arrivals/no-shows) visible when present.
- Suppress only the redundant top four-metric ribbon (section counts remain visible). When expanded, the existing legend becomes a one-line horizontally scrollable reference rather than taking multiple rows. Preserve staff assignment tray, refresh, RTC, DND and exception visibility.
- Presentation-only SLNT-scoped CSS. No schema, PMS, room classification, assignment, drag/drop, or service-cycle changes.

## Release acceptance
- Build and full test suite; stylesheet tests verify authenticated SLNT Team View scoping, both density modes, visible chips and visual hierarchy.
- Live browser QA still required on real SLNT data at desktop/tablet/mobile sizes: repeated room numbers, assignment drops, checkout/daily confirmation, unassigned clarity, access scope and overflow. CI does not prove these interactions.
- Verify that RD Hotels, including Hotel Memories, retains the prior layout and behavior. Merging is authorized by the user; deployment is not independently authorized.
