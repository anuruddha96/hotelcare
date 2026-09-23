# SLNT Team View — full-name compact room-board QA

## User-facing fix
The previous full-width one-property-per-row view wasted most of the screen on one-unit venues, still truncated long names in the live screenshot and left the expanded legend taking valuable room. This release uses responsive property **cards** within each existing Checkout / Daily Cleaning / Arrival section. One/two-unit venues share rows (two above a 48rem board, three above 68rem); 3+ unit venues remain full-width so a Silver Rooms or K4 group has one unmistakable header and its own visible chips.

Every property name is a real, wrapping line of text in the card; even when the separate stylesheet fails to load, the new JSX has readable mobile-first base classes rather than the old 7.5/11rem truncating rail. Status flags, property-colored bars, room selection, click/tap, both drag directions, bulk selection and unchanged checkout/daily logic are retained. There are no database, API, migration or Previo changes. Only authenticated SLNT Group live Team View receives this layout; Hotel Memories and all RD Hotels retain their existing interfaces.

The new tiny **v3** marker next to **Property Overview** is a deployment diagnostic. If it does not appear, the live app is not showing this code, regardless of whether GitHub `main` has the merge. Managers get the legend collapsed on first render, with the same full legend a click away; other tenants retain the previously expanded default.

## Automated release gate
- Run the production build and full test suite, including `slntPropertyClusters.test.ts`, `HotelRoomOverview.slnt.test.tsx` and unit-label regressions.
- CSS scoping must require both the tenant wrapper and the `team-view` ancestor. Tests cover true full-name wrapping, fallback layout, 48/68rem container breakpoints, multi-room spanning, preserved actions and the v3 diagnostic.

## Manual browser acceptance — authenticated SLNT preview required
1. Confirm the **v3** marker is visible next to **Property Overview** on the active SLNT Team View. If not, stop and verify production deployment SHA rather than diagnosing room grouping.
2. With the actual SLNT portfolio, check Be Local Budapest Apartment, DobNest Charming New Central Flat, Downtown Terrace Passion, Castle Garden Residence and long apartment names. They must appear **fully**, with natural wrapping, without a tooltip or ellipsis.
3. Checkout and Daily Cleaning must retain independent counts, PMS flags and actions. At ~1100px of actual board width expect three *small* venue cards per row, while Silver Rooms, K4, St King 11 and other 3+ unit venues each take the full width.
4. Check mobile 320/375px, tablet and the admin's narrow Today pane alongside Yesterday. Narrow board widths should stack every property card, and no property or chip may clip or overflow horizontally.
5. Test tap/click, long-press, whole-property bulk select/drag, housekeeper-to-room drop, room-to-housekeeper drag, staged assignment apply/unassign and confirmation on manual checkout/daily moves.
6. Confirm room numbers duplicated across two Previo accounts remain inside clearly labelled properties. Verify room total per section, RTC, DND, no-show, arrival, departure tomorrow, notes, cleaner names and pending approval badges.
7. Check unrelated RD Hotels (Memories, Mika, Ottofiori, Gozsdu) and SLNT outside Team View. None should show the v3 badge, change room layout or inherit the collapsed legend. Verify tenant/venue permissions with authenticated accounts.

Passing CI establishes only the code-build and automated checks, not live visual QA or production deployment.
