# Reliable long-range rate publishing and Previo reconciliation

## Confirmed current problems

- The push function marks a cell as `pushed/sent` and immediately overwrites HotelCare’s grid mirror after an EQC success response, before a later Previo pull proves the published value. This can make HotelCare look successful even when only part of a larger operation landed.
- Long-range edits are still processed as many date × room-type EQC calls inside one request. Even with concurrency, the browser/function request can time out after Previo has already accepted some calls, so the user sees a failure for an operation that was partially or fully applied.
- The grid’s blue marker is driven by user activity/audit intent, not authoritative Previo confirmation. It can therefore appear on a rate that was drafted or attempted but not actually published.
- The revenue sync only reconciles drafts still marked `draft` or `failed`; rows already marked `pushed/sent` are excluded from confirmation. Current records also show `verified: 0`, so successful transport is not the same as verified publication.
- A Previo pull upserts the latest value over the mirror without first recording the prior authoritative value. HotelCare therefore cannot currently explain a Previo-side adjustment as “previous → requested → actually landed.”

## Implementation

### 1. Make bulk publishing resumable instead of one long request

- Give every send action a client-generated run ID before the first request.
- Split work into small, deterministic date/room-type groups and send bounded chunks that finish comfortably inside the Edge Function limit.
- Persist each group’s lifecycle independently: queued, sending, accepted by EQC, confirmed from Previo, divergent, or failed.
- Make retries idempotent by run ID and cell key, and retry only groups that are not authoritatively confirmed.
- If the browser loses a response, recover progress from the database instead of declaring the whole range failed.
- Keep the required gap-free occupancy ladder per room type so fixing throughput does not reintroduce Previo error 3092.

### 2. Separate “accepted” from “confirmed”

- After EQC accepts a group, record it as **Sent — awaiting Previo sync**; do not present the optimistic mirror as a confirmed live rate.
- Trigger a targeted Previo read for the affected dates/room types, then compare every occupancy level with its requested price.
- Mark each cell independently:
  - **Confirmed** when Previo equals the requested value.
  - **Different in Previo** when Previo returns another value after the reconciliation window.
  - **Still checking** when Previo has not reflected the write yet.
  - **Failed** only when Previo explicitly rejects it or retries are exhausted.
- Return and display exact counts for confirmed, still checking, different, and failed room-type prices rather than one all-or-nothing error.

### 3. Build an authoritative rate-change trail

- Preserve the prior synced Previo price before each pull overwrites the current mirror.
- Record a reconciliation event per cell containing: previous Previo price, HotelCare requested price when applicable, actual Previo price, difference, source, run ID, user, and timestamps.
- Detect Previo-side manual edits when a pulled value changes without a matching active HotelCare request, and label them **Changed in Previo**.
- For the August 23 example, show one of these clear narratives:
  - `Previo €176 → HotelCare requested €173 → confirmed in Previo €173 (-€3)`
  - `Previous Previo €176 → changed in Previo to €173 (-€3)`
  - `HotelCare requested €173 → Previo currently €176 (difference +€3)`

### 4. Make markers truthful

- Keep dotted/underlined styling for unsent drafts.
- Show the fresh blue dot only after an authoritative Previo read confirms the HotelCare-requested value.
- Keep the light-orange dot for confirmed manual changes older than four hours.
- Use a distinct warning state for partial/divergent cells; never give them the blue confirmed marker.
- Update desktop hover and mobile tap details to show transport status, confirmation status, requested value, actual landed value, difference, user, and time.

### 5. Improve bulk-operation feedback and recovery

- Replace the generic non-2xx result with a persistent progress view grouped by date and room type.
- Allow “Retry unconfirmed only” and show which room types landed versus which did not.
- Keep confirmed cells out of retries, even when the original browser request timed out.
- Refresh only affected grid cells during reconciliation so the calendar remains visible and stable.

## Technical details

- Extend the existing draft/run tracking rather than creating a second competing pricing workflow; add a compact reconciliation history table only if the existing audit payload cannot safely preserve requested and actual values.
- Update `revenue-push-drafts` to process a bounded chunk idempotently and return durable per-group state.
- Update `previo-revenue-sync` to reconcile `sent` rows as well as draft/failed rows, compare before upsert, and emit confirmed/divergent/external-change audit events.
- Update the frontend batching helper and Rate & pickup calendar to resume by run ID and render confirmation-derived markers.
- Preserve hotel and organization scoping on every query and policy.

## Validation

- Test 2–3 days, 30 days, and a long season range across all Ottofiori room types.
- Simulate a lost/timeout response after Previo acceptance and verify the UI recovers the true per-cell result without resending confirmed cells.
- Force one room type to fail and verify only that room type is marked/retried.
- Change a rate directly in Previo, sync, and verify the before/after difference appears as a Previo-side change.
- Confirm blue/orange markers appear only for rates verified from Previo on both desktop and mobile.
