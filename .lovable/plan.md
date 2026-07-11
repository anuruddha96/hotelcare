## Read-only verification: how `rooms.status` becomes `'clean'` on manager approval

### 1. Frontend mutation (SupervisorApprovalView)

`src/components/dashboard/SupervisorApprovalView.tsx`:
- **Single approve** — `handleApproval(...)` at ~L315-345 updates `room_assignments` only:
  ```ts
  supabase.from('room_assignments').update({
    supervisor_approved: true,
    supervisor_approved_at: new Date().toISOString(),
    supervisor_approved_by: (await supabase.auth.getUser()).data.user?.id,
  }).eq('id', assignmentId)
  ```
  Then (L565) calls `pushCleanStatusToPrevio(assignment.room_id)` → edge function `previo-update-room-status`.
- **Bulk approve** — `handleBulkApprove` at ~L615 sets the same three fields per row, then per-row calls the same push helper.

There is **no `.from('rooms').update({status:'clean'})`** anywhere in this component. The local room row is not written by the client.

### 2. Database trigger that actually flips `rooms.status`

Migration: `supabase/migrations/20250909210854_d30c29f1-68ea-4ec6-af6f-01eafe8dcca4.sql` L57-82 (also earlier `20250908113609_...sql` and `20250909210833_...sql` — same body; latest revision wins).

Function: `public.update_room_status_on_assignment_completion()` (`SECURITY DEFINER`, `search_path=''`). Body:
```sql
IF NEW.supervisor_approved = true AND OLD.supervisor_approved = false THEN
  UPDATE public.rooms
     SET status = 'clean',
         last_cleaned_at = now(),
         last_cleaned_by = NEW.assigned_to,
         updated_at = now()
   WHERE id = NEW.room_id;
END IF;
```

Trigger: same migration installs it on `public.room_assignments` (BEFORE-row-update variant that also sets `completed_at`).

So the sequence on approve is:
1. Client `UPDATE room_assignments SET supervisor_approved=true …`.
2. Trigger fires **synchronously in the same transaction** → `UPDATE rooms SET status='clean' …`.
3. Client then invokes edge function `previo-update-room-status` (out-of-transaction, best effort).

### 3. Realtime handlers

Realtime subscribers on `rooms` (e.g. `HotelRoomOverview.tsx`, `HousekeepingManagerView.tsx`, `LiveSyncContext.tsx`) receive the post-trigger `UPDATE` payload and re-render — they do not perform the mutation themselves. No client handler flips `rooms.status` for approvals.

### 4. Can `supervisor_approved=true` coexist with `status` still `'dirty'` / `'ready_for_inspection'`?

**No — not because of the PMS call.** The trigger runs in the same DB transaction as the approval update. If the trigger errors, the whole approval UPDATE is rolled back and `supervisor_approved` also stays `false`. If the trigger succeeds, `rooms.status` is guaranteed to be `'clean'` before the Previo push is even attempted.

The Previo edge function call (`pushCleanStatusToPrevio`) happens **after** the DB commit and only affects the **remote** PMS. Its failure has zero impact on local `rooms.status`. Consequences of a Previo failure:
- Local `rooms.status = 'clean'` — set. (`last_cleaned_at`, `last_cleaned_by` — set.)
- `room_assignments.supervisor_approved = true` — set.
- Previo remote room stays dirty; failure is toasted client-side (`SupervisorApprovalView.tsx` ~L594) and logged to `pms_sync_history` (`sync_status='failed'`) by `supabase/functions/previo-update-room-status/index.ts` L149-162.
- There is no retry/outbox and no compensating update that would revert local `rooms.status` if the PMS call fails.

The only realistic way to observe `supervisor_approved=true` with local `rooms.status` still `dirty` is:
- The trigger is dropped/disabled on the DB (not the case in current migrations), or
- A concurrent process writes `rooms.status='dirty'` after approval (e.g. a subsequent PMS overview upload marking the room as a new checkout).

### Summary of exact references

- Client write: `src/components/dashboard/SupervisorApprovalView.tsx` L315-345 (single), L615-660 (bulk).
- Client PMS push (post-commit, best-effort): same file, `pushCleanStatusToPrevio` ~L590-608 → `supabase/functions/previo-update-room-status/index.ts`.
- DB trigger function: `public.update_room_status_on_assignment_completion` — latest definition in `supabase/migrations/20250909210854_d30c29f1-68ea-4ec6-af6f-01eafe8dcca4.sql` L57-82; trigger installed same migration.
- No realtime handler mutates `rooms.status` for approvals.

Approval-vs-PMS coupling: **decoupled**. Local `rooms.status='clean'` is committed by a trigger before the PMS call; a PMS failure never leaves `supervisor_approved=true` with local status still `dirty`/`ready_for_inspection`.

No code changes proposed.
