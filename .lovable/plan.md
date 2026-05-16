## Goal
Make assigned checkout rooms switch to ready-to-clean reliably and immediately after Previo marks them checked out, without depending on an admin browser tab being open.

## What I’ll implement

### 1) Replace browser-only polling with backend polling
- Add a real Supabase cron schedule for `previo-poll-checkouts` every 10 minutes.
- Send the required `x-cron-secret` header so the function can run server-side without a user session.
- Keep the existing manual/admin trigger in the UI, but treat backend cron as the source of truth.

### 2) Fix room matching inside `previo-poll-checkouts`
- Update the function so it matches local rooms using the same robust fallbacks already used in PMS sync:
  - exact `room_number`
  - normalized numeric room token from the Previo room name
  - `rooms.pms_metadata->>roomId`
- This will prevent assigned rooms from being skipped when Previo uses a different display name than the app.

### 3) Fix assignment creation for already-checked-out rooms
- Update checkout assignment creation so `ready_to_clean` is set correctly at insert time:
  - if the room is already dirty / already flagged as checkout-ready from PMS, create the assignment as ready immediately
  - only keep it blocked when the guest has truly not checked out yet
- This removes the current bug where newly assigned checkout rooms start blocked even when PMS already marked them dirty.

### 4) Improve audit visibility
- Ensure every backend checkout poll writes a `pms_sync_history` row with counts for checked, marked, skipped, and errors.
- Surface enough detail to verify whether a room was released, skipped due to no match, or failed due to Previo/API issues.

### 5) Validate against today’s failing case
- Re-test the `previo-test` hotel flow against today’s assigned checkout rooms.
- Confirm that rooms like 201/203/301 transition correctly and that the housekeeper card stops showing the waiting state when appropriate.

## Why this should fix your issue
I verified two concrete problems:
- there is currently no backend cron record for `previo-poll-checkouts`, so the “every 10 minutes” behavior is effectively browser/session-dependent
- today’s checkout assignments were inserted with `ready_to_clean = false`, even though the rooms were already dirty/checkout rooms in local data

## Technical details
- Files likely involved:
  - `supabase/functions/previo-poll-checkouts/index.ts`
  - `src/components/dashboard/RoomAssignmentDialog.tsx`
  - new Supabase migration for the cron schedule
- I will not change broader housekeeping workflows; this fix will stay focused on checkout auto-release reliability.

## Expected result
- Assigned checkout rooms auto-release even if no admin has the app open
- Newly assigned already-checked-out rooms are immediately actionable for the housekeeper
- Sync history/logs clearly show whether the poll ran and what it changed