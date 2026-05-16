## Scope clarification
All work stays gated to the **test hotel only** (`previo-test`, Previo hotel ID `730099`). Ottofiori and every other live hotel remain untouched — the existing `if (pmsConfig.hotel_id !== 'previo-test') skip` guard in `previo-update-room-status/index.ts` stays in place exactly as it is.

---

## What's already wired (test hotel)
In `SupervisorApprovalView.tsx` (`handleApproval`), single-room approval already calls `previo-update-room-status` with `{ roomId, status: 'clean' }`. For `previo-test` rooms it pushes through to `PUT /rest/rooms/{previoRoomId}/clean-status` and logs to `pms_sync_history`. For every other hotel the function returns `{ skipped: true }` and does nothing — that's the safety we want to keep.

## What's missing

1. **Bulk approve doesn't push to Previo.** `handleBulkApprove` only updates `room_assignments` — no `previo-update-room-status` call inside the loop. For a test-hotel bulk approve, the rooms get marked clean in our DB but Previo never hears about it.
2. **No visual feedback** on whether the PMS push succeeded for a given approval.
3. **No easy way to verify** end-to-end in the test hotel without checking edge logs.

---

## Plan (test hotel only — no live hotel side effects)

### 1. Add Previo push to bulk approve
In `SupervisorApprovalView.handleBulkApprove`, after each successful `room_assignments` update call `supabase.functions.invoke('previo-update-room-status', { body: { roomId, status: 'clean' } })` inside the per-assignment try/catch. Fire-and-forget on error so one Previo failure can't break the batch. The edge function's existing hotel gate guarantees only `previo-test` rooms actually hit Previo — Ottofiori bulk approvals will silently skip.

### 2. Visual confirmation pill on approved rows
Add a small inline status next to the approved row:
- "✓ Synced to PMS" (green) when the invoke returns `success: true` without `skipped`
- "PMS sync skipped" (muted) when `skipped: true` — expected for non-test hotels
- "PMS sync failed" (amber, with tooltip showing the error) when the invoke errors

This makes it obvious that production hotels are intentionally skipped while the test hotel is actually pushing.

### 3. Surface recent PMS pushes in `PmsSyncStatus.tsx`
Add a small "Last clean-status push" row that reads the most recent `room_status_update` entries from `pms_sync_history` for the active hotel: timestamp, room number, success/fail. Lets you watch test-hotel pushes happen in real time without leaving the app.

### 4. No edge function changes
`previo-update-room-status/index.ts` is left exactly as-is. The `previo-test` gate stays. When you're ready to go live for Ottofiori or other hotels later, the only change needed is widening that gate (and adding the relevant `pms_configurations` + room mappings) — not before.

---

## How to test (after implementation)
1. In the test hotel, assign a room to a housekeeper and let them mark it cleaned.
2. As manager, open Pending Approvals → approve the single room → expect "✓ Synced to PMS" pill and a new row in `pms_sync_history` with `status: 'success'`.
3. Cross-check the Previo dashboard for the test hotel — the room's clean status should flip to clean.
4. Repeat with a bulk approve covering 3–5 test-hotel rooms; all should push.
5. As a safety check, approve a room in Ottofiori or another live hotel → expect "PMS sync skipped" pill and no `pms_sync_history` row (or a `skipped` log row only). Confirms live hotels are untouched.