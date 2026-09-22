# SLNT flat room board — release QA

## Scope
Only authenticated `slnt` / `slnt-group` with venue grouping enabled, inside Team View. The existing live room overview, checkout/daily classification, assignment events, PMS data and historic snapshots are reused unchanged. Hotel Memories and all RD Hotels stay on their existing layout.

## CI gate
- Production build passes.
- Full Vitest suite passes, including `HotelRoomOverview.slnt.test.tsx` and `slntPropertyClusters.test.ts`.
- No database migrations, Previo write changes, new business-state mappings, or hidden room chips.

## Manual browser acceptance (NOT covered by CI)
1. Open SLNT Team View with the actual two-account portfolio on phone, tablet and desktop. In Checkout and Daily, all rooms should appear in one flat wrapping flow rather than a card per venue. Similar venues remain adjacent, with a small inline location label and the original venue-colored room edges; room counts per section match PMS.
2. Confirm both a previously saved Compact preference and saved Roomy preference render the same flattened board, and the redundant density toggle is hidden only for SLNT.
3. Confirm long property names have a full title tooltip and all room identifiers, assigned cleaner labels, RTC, T, C, DND, NS, notes, No Show and arrival indicators remain available. Confirm venues with duplicate room numbers can be distinguished by adjacent venue marker and color. Verify there is no clipped content or horizontal page overflow.
4. Test click/tap on individual rooms, long press, drag room to cleaner, inverse housekeeper-to-room drop, bulk selection and staged apply/unassign. Ensure no lost assignment or ambiguous drop target. Confirm checkout↔daily moves still require the existing confirmation, and no service type is changed by merely displaying this UI.
5. Verify managers retain access to the refresh button, signed-in cleaner tray, actionable checkout/daily counts and alert/exception sections. Top redundant stats are absent and the optional legend is a horizontal strip; all its entries are still accessible by scrolling within it.
6. Compare Hotel Memories, Ottofiori, Mika and Gozsdu Team View layouts before/after. Their CSS and workflows must be unchanged. Test supervisor venue restrictions with separate SLNT accounts and ensure no cross-tenant records are visible.
7. Confirm client feedback about actual SLNT **daily-cleaning schedule and cadence** before implementing any calendar or business-rule changes. Fruzsi's September 21 email requests normal/daily/deep cleaning types but does not define daily timing or frequency.

Passing CI does not establish that these browser, access, or PMS scenarios were executed. A merge is distinct from a production deployment.
