# Restore Ottofiori automatic pricing to live production

## Confirmed diagnosis

- The 12:50 UTC run failed because three existing prices were below their configured occupancy floors; the safety check blocked the entire run and set `auto_publish = false`.
- The corrective code is now present: the 14:00 UTC run evaluated 218 dates with no bound violations and calculated 5 increases plus 2 decreases across 91 cells.
- Those 91 cells were not sent because the rule is currently in an inconsistent state: `mode = live` but `auto_publish = false`. Engine V2 treats that combination as shadow mode, so changing only `mode` did not actually resume publishing.
- The stored `auto_pause_reason` is also stale even though the latest shadow calculation was safe.
- Current self-healing code can snap one under-floor cell directly to its floor while other cells move by the normal date step. That conflicts with the rule that every price cell on a stay date must move by the same EUR amount.
- Delivery accounting is premature: Engine V2 marks date decisions `published` and notifications count cells as pushed immediately after queue creation, before Previo acceptance/read-back. The publisher does successfully send and confirm automation batches, but the run record does not currently receive those final counts.

## Production correction

1. **Keep one uniform movement per stay date**
   - Remove per-cell floor/ceiling snapping.
   - Allow a legacy out-of-bound cell to move only in the corrective direction, using the same whole-EUR step as every other cell on that date.
   - Continue to hold the whole date if any cell would move farther outside its bounds, has no valid bound/mapping, or cannot take the minimum safe common step.
   - Preserve all existing Engine V2 pickup, pace, manual-hold, ADR, seasonal-anchor, event, sold-out, daily-budget and direction-cooldown rules.

2. **Make live state atomic and self-consistent**
   - Treat `mode` and `auto_publish` as one state: live means both are enabled; shadow means publishing is disabled.
   - Prevent future mixed `live + auto_publish false` states in the Engine V2 activation/watchdog path.
   - Clear the obsolete unsafe-price pause reason only after a clean preflight, then enable Ottofiori live publishing and restart its 48-hour watchdog timestamp.
   - Do not change automation settings for any other property.

3. **Report real Previo outcomes**
   - Leave decisions `queued` when drafts are created.
   - When the publisher finishes, update the linked automation run and date decisions from actual outcomes: accepted, confirmed, different, or failed.
   - Show queued counts separately from accepted/confirmed/failed counts; never label queued work as already pushed.
   - Keep payload-refresh timeouts non-fatal because Previo has already accepted the write; the normal sync remains the recovery path.

4. **Regression and integration coverage**
   - Test the exact three below-floor scenarios from the failed run.
   - Assert every changed cell on a stay date has exactly the same delta.
   - Assert an improving below-floor price is allowed, a worsening one is blocked, and no cell is independently snapped.
   - Test live-state invariants and queue-to-Previo status propagation.
   - Run the Engine V2 suite and targeted Edge Function tests.

5. **Deploy, activate, and verify end to end**
   - Deploy the automation and publisher functions.
   - Run a non-publishing Ottofiori preflight and require: 21-room inventory, fresh PMS data, valid mappings, whole-EUR cells, no unsafe movements, and uniform date deltas.
   - Atomically set Ottofiori to live with automatic publishing enabled, then trigger one immediate production run.
   - Verify in the live database that the run is linked to its push run, drafts reach Previo, read-back confirmations match intended prices, pickup ledger entries are consumed once, and the next hourly run remains scheduled.
   - If the preflight fails, keep publishing stopped and surface the precise failing dates/cells rather than silently returning to shadow.

## Success criteria

- Ottofiori shows live automatic pricing with `auto_publish = true` and no stale pause reason.
- A clean run creates a publisher run and sends eligible prices without manual action.
- All cells for each changed stay date move by one identical whole-EUR delta.
- Below-floor legacy cells improve without stopping unrelated safe dates or violating the uniform-date rule.
- Activity reflects actual queued, accepted, confirmed, different and failed totals.
- Other hotels and Engine V1 behavior remain unchanged.
