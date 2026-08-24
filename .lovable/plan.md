# Pricing calendar: fix mixed-up occupancy prices

## What Rishi is seeing

The complaint "2 persons costs more than 3 persons" is real and measurable. Right now, across live dates (today to +200 days), the stored rates contain occupancy inversions inside the *same* room type on the *same* date:

| Property | Inverted cells | Range |
| --- | --- | --- |
| Ottofiori | 287 | 24 Aug 2026 – 07 Mar 2027 |
| Previo-test | 187 | 24 Aug 2026 – 28 Feb 2027 |
| Gozsdu Court | 12 | 06 Sep – 10 Oct 2026 |
| Memories Budapest | 10 | 06 Sep – 16 Dec 2026 |
| Mika Downtown | 1 | 10 Sep 2026 |

Examples from Ottofiori: on 12 Sep 2026 "Deluxe Čtyřlůžkový Pokoj" is 407 for 2 guests but 405 for 3 guests; "Deluxe Queen Room" is 359 for 1 guest and 356 for 2. On 03 Oct 2026 "Luxusní třílůžkový pokoj" is 428 for 1 guest and 411 for 2.

## Root cause

Every pricing path in the system treats one *cell* (date + room type + occupancy) as an independent unit:

1. The automation engine loads `revenue_room_type_rates` row by row and decides per occupancy level. Each level gets its own markdown, surge, and top-up decision.
2. The safety floors amplify this: the far-out floor top-up (100 -> +22, 150 -> +50) and the ADR floor apply per cell. When only the 2-guest level sits under the floor, it is lifted above the untouched 3-guest level.
3. Per-cell dedupe (one action row per date/room/occupancy/slot) means some levels of a ladder are actioned in a round while their siblings are skipped, so the ladder drifts apart over time.
4. Previo pricelists themselves already contain inversions (the inverted rows above carry `source = previo`), and nothing in Hotel Care detects or repairs them — we mirror them straight into the calendar.

The existing safety layer (`_shared/rateSafety.ts`) only guards the *cross-room-type* order (Single vs Double, Studio vs One-Bedroom) at equal occupancy, and only for Gozsdu and Memories. It never checks the occupancy ladder within a room type, and never runs for the other properties. So this class of mix-up passes through untouched.

## The fix

### 1. Ladder-aware pricing (shared, all properties)

Add occupancy-ladder handling to `_shared/rateSafety.ts`:

- `normalizeOccupancyLadder(...)`: after all decisions are made and before anything is written, group the pending changes by date + room type, merge them with the currently stored levels for that group, and enforce a non-decreasing ladder (1 <= 2 <= 3 <= 4). Repairs go *upward*: a higher occupancy that fell below a lower one is lifted to match it. Lower levels are never pushed down, so no floor, no min-ADR, and no markdown cap is violated by the repair.
- Extend `assertRoomHierarchy` to run for every hotel with a configured room order (not just the two hard-coded slugs), and keep it as the cross-room-type check.
- Every repaired sibling becomes a first-class change, so it is pushed to Previo, audited in `rate_change_audit`, and shows in cell history with the reason "occupancy ladder repair".

Wire it into all four write paths that already import `rateSafety`: `revenue-pickup-automation`, `revenue-enqueue-rates`, `revenue-push-drafts`, `previo-push-rates`. Manual edits, bulk edits, and automation then obey one identical rule.

### 2. Repair pass in the next automation round

Add a `ladder_repair` pass to `revenue-pickup-automation` that runs once per hotel per round, before the markdown and surge passes:

- Scan the full horizon for occupancy inversions and cross-room inversions.
- Queue upward corrections through the same draft/push pipeline (so Previo gets the corrected pricelist, not just our calendar).
- Log each repair as its own decision type so the audit trail explains why a price moved without a pickup trigger.
- Respect the existing publisher lease, staggering, and whole-number rounding; cap repairs per round so a first sweep cannot flood Previo.

### 3. Visibility in the calendar

In `RateStrategyGrid`, mark any cell that is part of an inversion with a warning marker and a tooltip naming the conflicting level ("406 for 3 guests is below 407 for 2 guests — queued for repair"). This makes the condition visible instead of relying on someone spotting it.

### 4. Tests

Extend `_shared/rateSafety_test.ts` with cases for: simple 2-vs-3 inversion, floor-induced inversion, equal prices (allowed), missing intermediate levels, and confirmation that repairs never lower a price below a floor.

## Technical notes

- Files touched: `supabase/functions/_shared/rateSafety.ts`, `_shared/rateSafety_test.ts`, `revenue-pickup-automation/index.ts`, `revenue-enqueue-rates/index.ts`, `revenue-push-drafts/index.ts`, `previo-push-rates/index.ts`, `src/components/revenue/RateStrategyGrid.tsx`.
- No schema change is required; repairs reuse `revenue_rate_drafts`, `revenue_pickup_automation_actions` (new `decision_type` value), and `rate_change_audit`.
- Ladder normalization happens after `assertExactRateMappings`, so a room type without an exact Previo mapping still errors out rather than being repaired through the wrong pricelist.
