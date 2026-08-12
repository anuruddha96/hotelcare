# Faster, self-confirming price pushes and provable automation history

Three changes to the Rate & pickup calendar: show how long a push actually takes, take confirmation entirely off your hands, and make the purple dot prove itself with a real automation history.

## 1. Push progress and timing

Today the grid's "Push to Previo" sends everything in one call and shows only a spinner, so a long push looks stuck and you can't tell whether it got faster. The bulk editor already sends in batches with a progress bar; the grid will use the same path.

- Push from the grid switches to the batched sender (same one the bulk editor uses), so large pushes go out in parallel batches instead of one long request.
- A progress panel appears while pushing: `Sent 420 / 1,240 prices · batch 3 of 5 · 6.2s elapsed · ~9s left`, with a progress bar.
- When it finishes, a short result line stays visible for a few seconds: `1,240 prices sent to Previo in 12.4s (≈100 prices/sec)` — that's the number you can compare between runs.
- A "Cancel" control stops sending further batches; anything already accepted by Previo stays accepted.

## 2. No more "Check now" — confirmation runs itself

- The "Check now" button is removed from the calendar banner.
- Pushed prices already appear in the grid immediately (Previo's acceptance is mirrored back on the spot), so the numbers you see right after the push are the new ones.
- Confirmation becomes fully automatic: after a push the app quietly re-reads in the background (a few short refreshes, then a self-triggered Previo read-back if anything is still unconfirmed after about a minute, repeated a couple of times with a widening gap). You never press anything.
- The banner wording changes from an action to a status: `Confirming in the background…` with a small spinner, which disappears on its own once every price is confirmed. Only two things still ask for you: prices Previo refused, and prices that landed on a different value — those keep a visible warning and a review link, because they need a human decision.

## 3. Purple dot = provable automation history

Right now the purple dot can be drawn from the automation action log while the cell's history popup only reads the audit trail, so a cell can show "changed by automation" and then show no automation entry — exactly the confusion you described.

- The cell history (hover on desktop, tap sheet on mobile) merges the pickup-automation actions for that cell with the audit trail, in one time-ordered list.
- Each automation entry reads in plain words, for example:
  `€111 → €123  +€12 (+11%)`
  `Today 09:14 · Pickup automation tool · live in Previo`
  `Triggered by booking #114488609 picked up at 09:12 · 2nd booking in the window · 14 days out`
- The author label for those entries is "Pickup automation tool" instead of a person's name, and the status line says which stage it reached: sent, live in Previo, waiting, or refused.
- A purple dot is only drawn when such an entry exists for that exact cell, so a dot without a story becomes impossible. The legend entry becomes "changed by the automation tool".

## Technical notes

- `src/components/revenue/RateStrategyGrid.tsx`: `pushDrafts()` moves to `pushRateDraftsBatched` with `onProgress`/`shouldCancel`; new state for `startedAt`, batches done/total and final duration; remove `verifyWithPrevio` button and replace the banner's action area with a background-status chip; add a self-scheduling verification effect (invokes `previo-revenue-sync` at ~60s/150s while `awaitingDrafts.length > 0`, cancelled on unmount or when the queue empties).
- Marker logic in the grid: require a matching entry in `automationByCell` or an audit row with `payload.origin === "pickup-automation"` / source `previo_automation_confirmed` before rendering the purple dot.
- `src/components/revenue/RateCellHistory.tsx`: accept an `automation: AutomationAction[]` prop and render merged, time-sorted entries; map `status` (`suggested`/`queued`/`pushed`/`failed`) to the status wording and show `reservation_id`, `pickup_at`, `pickup_sequence`.
- `src/hooks/usePickupAutomationActions.ts` already indexes actions by cell key — pass `byCell` into the grid's tooltip and mobile history sheet.
- No database or edge function changes; `revenue-push-drafts` already mirrors accepted prices and verifies in the background via `EdgeRuntime.waitUntil`.
