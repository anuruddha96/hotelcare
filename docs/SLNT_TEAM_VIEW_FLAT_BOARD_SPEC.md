# SLNT Team View — flat daily/checkout board specification

Requested September 22, 2026. UI-only implementation: preserve the HotelCare room overview, its checkout/daily classification and interaction handlers, and the separate Hotel Memories and RD Hotels interfaces.

## Verified customer request
Fruzsina Darázsi's September 21 email asks for three separate cleaning types (normal, daily and deep), team-to-apartment assignment, conspicuous unassigned rooms, and a simplified role-specific interface. It **does not specify** a daily-cleaning cadence, day-of-stay rules, or mapping from the three cleaning types to the two existing room categories. No service scheduling, assignment types, or checkout semantics may be redefined based on an assumption.

## Implementation
- SLNT Team View only: present the existing venue-grouped room chips in one flat, wrapping board per checkout/daily section, keeping alphabetically adjacent venue groups together. Small inline venue labels preserve identification without one card per building.
- Both existing Compact/Roomy stored preferences converge to this one flat layout, so a saved preference cannot bring back long rows. Hide the now-irrelevant density toggle in this scoped board.
- Retain every chip and badge, full room identifiers, room click and drag/drop handlers, selection and existing checkout/daily section hierarchy; leave exceptions (arrivals/no-shows) visible when present.
- Suppress only the redundant top four-metric ribbon (section counts remain visible). When expanded, the existing legend becomes a one-line horizontally scrollable reference rather than taking multiple rows. Preserve staff assignment tray, refresh, RTC, DND and exception visibility.
- Presentation-only SLNT-scoped CSS. No schema, PMS or service-cycle changes.

## Release acceptance
- Build and full test suite; stylesheet tests verify authenticated SLNT Team View scoping, both density modes, visible chips and visual hierarchy.
- Live browser QA still required on real SLNT data at desktop/tablet/mobile sizes: repeated room numbers, assignment drops, checkout/daily confirmation, unassigned clarity, access scope and overflow. CI does not prove these interactions.
- Verify that RD Hotels, including Hotel Memories, retains the prior layout and behavior. Merging is authorized by the user; deployment is not independently authorized.
