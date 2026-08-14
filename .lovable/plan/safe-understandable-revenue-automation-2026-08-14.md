# Safe, understandable revenue automation

## Goal
Make hourly and manual automation reliable without flooding Previo or adding unnecessary database load. Keep every property isolated, preserve manual work priority, and make every confirmed automated change visible as purple activity with full history.

## What the audit confirmed
- Enabled properties are already staggered through a 10-minute scheduler and each rule has its own minimum 60-minute interval; one due property is claimed per scheduler tick.
- The durable publisher queue runs every 3 minutes, orders manual work before automation, and the Previo publisher uses a single token-based global lease.
- `Run now` is blocked when markdown or strong-demand actions exist because its conflict columns do not match an inferable unique index. The existing index is partial (`no_pickup_markdown` only), while the code uses the same target for markdown and smart-demand actions.
- Current action data has no duplicates on either active conflict key, so the index repair does not require deleting or merging historical rows.
- Confirmed automation writes already flow into `rate_change_audit`; the marker/history RPCs classify `push_automation` and `previo_automation_confirmed` as automation, which is the durable purple-dot path.

## Implementation
1. **Repair idempotency without losing history**
   - Replace the partial markdown-only index with one full unique index over the existing scheduled-action key: hotel, stay date, room, occupancy, rule version, schedule slot, and local business date.
   - Keep the existing positive-pickup event index unchanged.
   - Do not delete, rewrite, or collapse any historical automation actions.

2. **Make all automatic publishing truly background work**
   - Keep decisions and price intents durable in `revenue_pickup_automation_actions`, `revenue_rate_push_runs`, `revenue_rate_drafts`, and push items.
   - Stop the automation evaluator from directly waiting on or launching the Previo publisher.
   - Let the existing 3-minute queue drainer claim work by priority and let the global token lease serialize Previo delivery.
   - Preserve priority order: manual 10, pickup/strong demand 20, reconciliation 30, markdown 40.
   - Preserve superseded drafts as history; never delete them and never replace work already claimed by the publisher.

3. **Make `Run now` accurate and safe**
   - Use exactly the same decision and enqueue path as cron; the button performs one property evaluation and returns once durable work is queued.
   - Report separately: pickups found, markdowns, strong-demand increases, suggestions, queued changes, blocked dates, and failures.
   - Do not claim that a price was sent until the background publisher confirms it.
   - Continue showing precise PMS-unavailable, busy, paused, disabled, and validation messages instead of object-shaped errors.

4. **Keep the pricing rules understandable and bounded**
   - Retain the existing user controls for hourly cadence, pickup tiers, weak/strong occupancy thresholds, lead-time windows, ADR floor, per-change limits, daily rise/fall caps, manual-edit hold, and auto-publish.
   - Enforce the core behavior consistently:
     - positive net pickup can increase prices;
     - cancellations never cause an increase;
     - low occupancy close to arrival can decrease one bounded step;
     - high occupancy far from arrival can increase one bounded step;
     - the same stay date cannot move both directions in one evaluation;
     - stale PMS data, sold-out dates, recent manual edits, and daily caps block unsafe moves.
   - AI assist remains optional and may only soften or cancel a deterministic move, never enlarge it.

5. **Keep purple markers and history durable**
   - Ensure every queued automation draft carries an automation intent source.
   - Keep audit creation at confirmed publish time so purple means an automated price actually reached the publishing workflow, not merely that a calculation ran.
   - Refresh marker/history data after queue progress without adding broad raw-audit polling.

## Technical verification
- Run the focused pricing, smart-pricing, queue priority, coalescing, and error-format tests.
- Add regression coverage for both automation conflict keys and for “enqueue only; publisher runs separately.”
- Verify live, without blindly changing rates:
  - the new full unique index exists and duplicate counts remain zero;
  - `Run now` dry-run completes with readable structured output;
  - scheduler, queue drainer, per-hotel lock, and global publisher lease remain active;
  - no new direct automation-to-publisher call remains;
  - recent confirmed automation audit rows resolve to automation markers/history.
