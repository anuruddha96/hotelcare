# SLNT flat room-chip Team View — release QA

## Scope and intent
The manager rejected the earlier property-row and multi-card layouts because 40+ daily units required excessive scrolling and each one-unit apartment repeated its full venue name above a generic "Unit" chip.

The **v4** layout retains the shared HotelCare room-chip component and the familiar Hotel Memories-style continuous board. Changes apply ONLY when the authenticated tenant is SLNT (`slnt` or `slnt-group`), venue grouping is enabled, the date is live (not historical) and the current tab is Team View. No changes to RD Hotels, Previo, housekeeping business states, drag/drop handlers, approvals, assignments, historical snapshots or server authorization.

## Expected SLNT presentation
- Checkout and Daily Cleaning remain independent sections with their original, unfiltered totals and original operational colours/status flags.
- Each single-unit property appears as **one** fully named actionable room chip. If PMS specifies a distinctive room name, append the meaningful suffix (for example: `Elisabeth Downtown · One Bedroom`). Do not render the repeated property heading, a fake `Unit` second chip or a decorative card.
- Multi-unit properties (Silver Rooms, St King 11, K4) appear as compact inline **clusters**. Full venue heading and count appear exactly once next to the original numbered room chips. Their heading retains whole-group selection and drag-to-housekeeper.
- All groups remain sorted by their configured property name, then room number. Distinct venues with duplicate room numbers must remain identifiable.
- The SLNT-only compact toolbar shows Checkout, Daily and the global count of rooms with no current assigned housekeeper. Search matches both room identifier and full venue name. The optional Unassigned toggle and search both filter **only Today's visible board**; original section counts and yesterday's snapshot remain unchanged. Select all applies to today's visible units when filtered.
- The existing full legend remains available behind Show Legend; no icon/status warning is deleted. The tiny `v4` marker beside Property Overview is a **deployment diagnostic** only.

## CI
- Production build succeeds.
- Full Vitest suite succeeds, including `slntFlatRoomBoard.test.ts`, `slntPropertyClusters.test.ts`, `HotelRoomOverview.slnt.test.tsx` and `venueUnitLabel.test.ts`.
- Confirm every stylesheet selector requires the SLNT wrapper AND Team View ancestor; preserve the non-SLNT venue row code path and the Hotel Memories floor board.

## Authenticated manual browser acceptance (not established by CI)
1. With SLNT's real portfolio, compare Checkout and Daily totals to the original v3 board and current Previo data. The compact board must show every room, every badge and no duplicates.
2. Check Be Local Budapest Apartment, Dorothilux Apartment, CityNest, Downtown Terrace Passion, DobNest Charming New Central Flat and other one-unit venues. Each is one legible, full-name chip with its live status, never an additional "Unit" card.
3. Silver Rooms, St King 11, K4 and other groups must have **one** full venue header plus numbered room chips. Check group drag/select all, individual chip actions, housekeeper-to-room inverse drag/drop, staged changes, room-to-room reclassification confirmation and approval statuses.
4. Use Find property or room and the Unassigned filter together; the unfiltered Checkout/Daily counts must remain correct, visible select-all must not silently select hidden rooms, and Clear restores all chips.
5. Confirm RTC, clean, towel, dirty linen, C/O+1, notes, DND, No Service, early checkout, no-show, pending approval and assigned housekeeper labels remain accurate. These are display-only changes, not changes to the PMS sync engine.
6. Inspect 320/375px phones, 768px tablet, 1280px/1440px desktops and the narrower admin Today pane with Yesterday alongside. Full names may wrap; no horizontal overflow, clipped badge or hidden action is acceptable.
7. Check SLNT manager, restricted supervisor and housekeeper accounts, plus RD Hotels' Hotel Memories, Gozsdu, Mika and Ottofiori. Non-SLNT should retain prior layout and initial legend behavior. Verify no cross-tenant records are revealed.

## Gate
Passing CI is not proof of a successful live deployment or authenticated visual acceptance. No merge or production deployment is authorized by the approval to **develop** this change.
