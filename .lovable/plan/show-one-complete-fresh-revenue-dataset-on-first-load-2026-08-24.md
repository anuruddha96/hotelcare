# Show one complete, fresh Revenue dataset on first load

## Confirmed findings

- Ottofiori is not missing server data: its latest successful Revenue sync completed at **14:53 Budapest**, and the stored feeds cover all **191 requested dates** through 2 March 2027.
- The browser currently loads only **60 days first**, marks that payload usable, and starts the 190-day load 250 ms later. This is why the first three months can show numbers while later months shimmer, then the headline figures change.
- A Revenue sync currently updates live tables in place. For example, it deletes the current booking-night range and reinserts the replacement in 500-row chunks. A page opened during that process can therefore read an incomplete intermediate state even though the previous successful sync was complete.
- After the six-second cover timeout, the page is allowed to expose partial/zero values. That creates the “never synced”, €0, and incomplete occupancy states shown in the screenshots.

## Fix

### 1. Publish Revenue syncs atomically

Introduce a per-run batch identifier for the authoritative Revenue feeds. A sync writes the new rates, reservations, cancellations, snapshots, room types and pickup movements into a new batch without removing the currently published batch.

Only after every required write succeeds, one database transaction will:

- mark the new batch as the active completed dataset for that hotel;
- update `revenue_sync_state.last_success_at` and the actor;
- retire the previous batch for later cleanup.

If a sync fails or is still running, readers continue to receive the previous completed batch. They will never see a half-deleted or half-inserted dataset.

Access remains restricted by the existing organization/hotel rules; the active-batch lookup will also validate the viewer's hotel and organization scope.

### 2. Load one coherent initial horizon

Update `useRevenueHotelData` so the first visible payload is the complete requested initial horizon (currently 190 days), not a 60-day payload followed by an immediate replacement.

- Fetch the active batch marker once.
- Read every initial feed against that same batch.
- Commit all React state together only after room types, reservations, rates, cancellations, snapshots, pickup movements, settings and freshness have succeeded.
- Discard responses from an older hotel, horizon, or batch.
- Keep later 12-month growth incremental, but never let it alter the already-correct headline month while a slice is incomplete.

### 3. Never present partial values as real data

- Keep the full Revenue skeleton visible until the coherent initial payload is ready; remove the six-second fallback that exposes zero/partial metrics.
- Do not render “never synced” while freshness is unresolved.
- Show `Data as of HH:MM · refreshed automatically every 30 minutes` from the exact active batch being displayed.
- During a background server refresh, keep the previous complete numbers visible with a small “Refreshing in background” indicator. Swap to the new dataset only after its active batch changes.
- If loading genuinely fails, keep the last completed dataset when available; otherwise show a clear non-numeric error state rather than zeros.

### 4. Keep manual edits consistent

Price pushes and other Revenue writes that must appear immediately will update the active published dataset (or trigger a focused reload) without exposing a mixed sync batch. Existing pricing, pickup and automation calculations remain unchanged.

## Verification

- Open Ottofiori during an active server sync and confirm the prior complete figures remain visible until one atomic swap.
- Hard reload and switch properties on desktop and mobile; verify no €0/0%/“never synced” flash and no three-month partial state.
- Confirm August headline KPIs, six-month outlook, rate grid and pickup all identify the same active batch and freshness timestamp.
- Simulate a failed sync and verify the previous completed dataset remains available.
- Confirm the initial payload completes in seconds and the 12-month extension does not change already-loaded headline figures.
- Run the Revenue analytics tests plus targeted tests for stale-response rejection and atomic batch switching.
