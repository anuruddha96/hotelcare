# SLNT property overview: full-name and room-chip release QA

## Scope
Only authenticated `slnt` / `slnt-group` with venue grouping enabled, inside the **live Team View**. Property names always wrap in full; no ellipsis, hover-only naming or fixed narrow label rail. Rooms remain within the correct property group. Changes to the existing live board are presentation-only, with no PMS, database, assignment, room-status or housekeeping service-rule modifications. RD Hotels and other tenants retain their prior presentation.

## Responsive behavior
- **Phone and narrow panels:** one property per row; full property name above its rooms. No horizontal overflow or hidden label.
- **Medium-width board (at least 42rem):** full property name on the left (up to 19rem), room chips on the right. Labels can wrap to multiple lines.
- **Genuinely wide board (at least 76rem of actual board width):** properties with one or two units can sit side by side; properties with three or more units (or unmapped venues) span the entire board. This breakpoint responds to container width, so a narrow admin Today panel does not force two cramped columns.
- Room chips remain individually clickable/selectable, preserve colored venue edges and all status flags, and have more even horizontal and vertical spacing.

## Automated gate
- Production build passes.
- Full Vitest suite passes, including `HotelRoomOverview.slnt.test.tsx`, `slntPropertyClusters.test.ts`, and any venue label tests.
- Confirm the CSS selectors and responsive container rules apply only inside the authenticated SLNT Team View wrapper.

## Manual browser acceptance — must use authenticated live/preview accounts
1. View Checkout and Daily Cleaning on desktop, tablet and phone. Read the **entire** names of Downtown Terrace Passion, DobNest Charming New Central Flat, Castle Garden Residence, and any longer name, without a tooltip.
2. Compare one-unit properties and larger groups (Silver Rooms, K4, St King 11, WR Pension). Verify chips and counts remain tied to the correct venue, even when room numbers repeat in separate Previo profiles.
3. Check admin's Yesterday/Today split at 1024–1440px viewport widths. Confirm the responsive grid reacts to the narrow Today panel rather than desktop viewport width.
4. Test room tap/click, long press, keyboard focus where supported, bulk-select via property name, drag property to housekeeper, room-to-housekeeper drag, housekeeper-to-room drag, staged Apply, and unassign.
5. Confirm checkout/stayover classification, RTC, towel, clean room, C/O+1, DND, No Service, arrival/no-show indicators, assigned housekeeper names and live PMS refresh remain unchanged.
6. Test logged-in SLNT manager, restricted supervisor and housekeeper roles, then RD Hotels (Hotel Memories, Ottofiori, Mika and Gozsdu) plus an unrelated tenant. Confirm layout changes never appear outside SLNT Team View and no cross-tenant records are visible.
7. Check 320px and 375px mobile widths and dark mode for clipped text, overlapping status badges, horizontal page overflow and extra vertical whitespace.

Successful CI does not establish browser visual/interaction acceptance or production deployment.
