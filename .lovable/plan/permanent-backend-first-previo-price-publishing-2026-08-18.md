# Permanent backend-first Previo price publishing

## Confirmed cause

- Price edits already appear immediately in HotelCare, and the browser hands them to `revenue-enqueue-rates`; however, the calendar still loads accepted-but-unverified rows into the **Price changes waiting to go live** dialog and shows them as **still checking**. The screenshot therefore exposes an internal verification state as though the user must manage it.
- The live Gozsdu data confirms the pictured rows were not unsent: 30 had been accepted and were awaiting read-back, while 30 older mismatches were in automatic retry state.
- Large runs are currently sliced into 400 draft rows and consecutive identical dates are compressed into Previo date-range messages. Continuations start immediately, but a run that encounters a busy global publisher can fall back to the queue cron, which currently runs only every three minutes.
- Manual publishing is also guarded by the global `automation_enabled` switch in the queue drainer. Turning automation off must not pause manager-requested price delivery.
- The frontend polls each run for up to roughly 20 minutes and exposes verification/reconciliation controls. That duplicates backend responsibility and adds unnecessary reads and user confusion.

## Implementation

### 1. Make the database queue the only publishing authority

- Keep the immediate optimistic calendar update when the user confirms a price change.
- Make enqueueing atomic and durable: create the run, cell intents, and queue items before returning success, with database deduplication by run and cell.
- Preserve latest-intent-wins semantics so repeated edits from multiple tabs or properties supersede older unsent work and can never revert a newer price.
- Keep manual, automation, and recovery priorities, but separate **manual publishing enabled** from the automation master switch.

### 2. Process bounded Previo batches continuously

- Claim one queued run through the existing database single-flight lease.
- Process a bounded chunk based on both cell count and Previo message count/time budget, while preserving the complete occupancy ladder required by Previo.
- After a chunk finishes, persist every accepted/refused item, release or renew the lease safely, and immediately kick the next queued chunk only when work remains.
- If another worker owns the lease, exit cleanly and leave the work queued; use the cron only as a recovery backstop, not the normal handoff mechanism.
- Keep unrelated browser windows safe: every property submission becomes durable backend work, and closing or refreshing a tab does not affect delivery.

### 3. Keep verification and recovery invisible

- Treat a successful Previo write response as **delivered** for normal UI purposes and remove it from all pending/error surfaces immediately.
- Continue authoritative Previo read-back in the backend for audit accuracy and detection of partial/date-range anomalies.
- Never require a user to click **Check Previo now**, clear accepted rows, or manage reconciliation retries.
- Requeue only the newest intent for a cell, with bounded attempts and cooldown; verification must never create a retry that can overtake a newer manual edit.
- Persist genuine terminal refusals after retry exhaustion and surface only those actionable failures.

### 4. Simplify the calendar experience

- Remove accepted, checking, sent, different, and retrying rows from the user-facing pending dialog and status pill.
- Remove the **Check Previo now**, **Keep Previo’s**, and clear-confirmation workflow from normal revenue-manager UI.
- Keep the immediate new price, fast change animation, and normal price history.
- Show a single non-blocking error notification only when Previo persistently refuses specific cells; provide a compact failure list and retry action for those cells only.
- Stop long browser-side run polling; use short-lived progress feedback for enqueue acceptance and backend-backed completion/failure updates.

## Technical details

- Refactor `revenue-enqueue-rates`, `revenue-publish-queue`, and `revenue-push-drafts` into one durable run/item state machine: `queued → processing → accepted` or `failed`, with confirmation retained as internal audit metadata rather than publish status.
- Update `claim_next_push_run` and queue indexes/constraints as needed so claims are atomic, stale leases recover safely, and only one active intent exists per hotel/date/room type/occupancy.
- Replace direct self-invocation with a bounded, gated continuation that carries a remaining-hop budget and a short cooldown; every entry point checks persisted pause/lease state.
- Keep `previo-revenue-sync` as the background truth source, but prevent it from generating user-visible waiting states or stale retries.
- Update `RateStrategyGrid`, `BulkPriceEditor`, `QuickRateAdjustDialog`, and shared publishing helpers so every edit path uses the same optimistic enqueue contract.
- Preserve strict `assigned_hotel` and `organization_slug` isolation on every query and policy.

## Validation

- Push one cell and verify the calendar changes immediately, the Previo write starts without a page refresh, and no confirmation dialog/pill appears.
- Push 30, 400, 1,000, and a six-month range; verify bounded sequential chunks continue immediately until complete without browser involvement or Edge Function timeout.
- Submit overlapping edits from multiple tabs and multiple properties; verify all jobs remain durable and the newest value wins for each cell.
- Turn revenue automation off and verify manual manager pushes still publish while automated pricing remains paused.
- Simulate a busy lease, worker crash, lost HTTP response, and Previo transient refusal; verify recovery occurs from persisted queue state without duplicates.
- Force a permanent Previo rejection and verify only that terminal failure is shown to the user with the exact Previo message and a targeted retry.
- Read live prices back from Previo after each scenario and confirm the published values and audit history match HotelCare’s latest intent.