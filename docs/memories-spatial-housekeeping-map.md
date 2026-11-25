# Hotel Memories Budapest — spatial housekeeping mapping

## Confirmed physical rules

- **Near the elevator** is a first-floor section.
- Near the elevator may share a route with **100 Side**.
- Near the elevator may share a route with **130 - 140 Side**.
- **Ground Floor** may help **100 Side** when Ground Floor has materially lighter cleaning work.
- Ground Floor overflow is directional: this rule does not automatically pull Ground Floor rooms into a 100 Side route.

## Auto-Assign behavior

The section map remains authoritative. Spatial links do not remap rooms. Instead, the planner may add at most one helper from an already-planned nearby section to the current section's candidate pool. For Ground Floor overflow, the helper is only offered when Ground Floor work per native worker is at least 25% lighter than 100 Side, unless a manager configures an explicit minute threshold.

Room profile fields already present on `rooms` are used for workload: room size, capacity, verified bed count, bed configuration, cleaning size, elevator proximity and room category. Managers can also mark room pairs as **Keep together**, **Nearby**, or **Far apart**.

## Manager mapping tools

The Operational room sections page keeps its existing drag/tap section mapper and adds an **Assignment intelligence** panel for Hotel Memories administrators. It provides:

- section-to-section proximity / overflow / separation mapping;
- room-to-room together / nearby / far mapping;
- priority for each relationship;
- optional minute threshold for an overflow source section;
- room cleaning profile editing for room size, guest capacity, verified beds, bed configuration, cleaning size, elevator proximity and category.

The three confirmed section relationships are seeded by migration and also exist as safe in-code defaults so the assignment preview still respects them if optional metadata loading is temporarily unavailable.
