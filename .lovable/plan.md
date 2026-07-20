## Goal

Change the DND flow so first-attempt DND rooms do NOT hit manager approval. Instead, the room recycles back to the same housekeeper's queue as a clearly-labeled "2nd attempt" until either (a) all their other rooms are finished, or (b) 14:30 local time — whichever comes first. Only if the 2nd attempt is also DND does it appear in Pending Approvals, with photos from both attempts side-by-side.

## Behavior

### Housekeeper side
- **1st DND**: current DND photo capture stays. On save, the assignment does NOT become `completed`. Instead it flips to a new state `dnd_pending_retry` with `dnd_attempt_count = 1`. The room drops to the bottom of the housekeeper's task list, visually muted, with a chip "DND · Retry at 14:30 or after other rooms". The housekeeper can tap it any time to retry — no confirmation prompt questioning them.
- **Unlock trigger** on housekeeper client: when either (i) every other assignment for that housekeeper today is `completed`/`approved`, or (ii) local time ≥ 14:30, the retry chip changes to "2nd attempt ready" and the card becomes fully actionable again. The housekeeper can also open it manually before that.
- **2nd attempt**: same room card, header shows "2nd attempt" badge and thumbnails of the 1st-attempt DND photo(s) for context. If they mark DND again, it saves as `dnd_attempt_count = 2`, `status = completed`, `is_dnd = true` → routes to manager approval. If they clean it, normal completion.
- Today's already-DND rooms (created before this change) are migrated: if `is_dnd = true` and `status = completed` and never approved, treat as attempt 1 and requeue.

### Manager side
- Pending Approvals only shows DND rooms where `dnd_attempt_count ≥ 2` (or legacy `is_dnd` with no attempt tracking after migration cutoff).
- The DND approval card renders both attempts stacked: "Attempt 1 — HH:MM" with its photo(s), "Attempt 2 — HH:MM" with its photo(s), each opening in the existing PhotoLightbox.
- No 1st-attempt DND rooms appear in the approval queue.

### Photo storage
- `dnd_photos` rows already store per-attempt records via `marked_at` + `assignment_id`. Add `attempt_number smallint not null default 1` so the approval UI can group them. Both attempts' photos persist (no deletion on retry).

## Data model

Migration adds:
- `room_assignments.dnd_attempt_count smallint not null default 0`
- `room_assignments.dnd_first_attempt_at timestamptz`
- `room_assignments.dnd_retry_unlocked_at timestamptz` (nullable; set when 14:30 or all-others-done fires so the UI stays consistent across devices)
- New status value `dnd_pending_retry` allowed in `room_assignments.status` (kept as text; no enum change needed)
- `dnd_photos.attempt_number smallint not null default 1`

Backfill: for existing `room_assignments` where `is_dnd = true` and `status = 'completed'` and `supervisor_approved_at is null` and `assignment_date = current_date`, set `dnd_attempt_count = 1`, `status = 'dnd_pending_retry'`, `dnd_first_attempt_at = dnd_marked_at`. Existing `dnd_photos` rows get `attempt_number = 1`.

No RLS changes; new columns inherit existing policies.

## Files to change

- **Migration** (new): the schema + backfill above.
- `src/components/dashboard/AssignedRoomCard.tsx`
  - Rework `markAsDND`: branch on `dnd_attempt_count`. Attempt 1 → `status='dnd_pending_retry'`, `dnd_attempt_count=1`, `dnd_first_attempt_at=now`, do NOT set `completed_at`; write photo with `attempt_number=1`. Attempt 2 → current behavior + `attempt_number=2` + `dnd_attempt_count=2`.
  - Add retry banner UI for `status==='dnd_pending_retry'`: shows "DND · retry after other rooms or 14:30", 1st-attempt thumbnail, "Try again now" button (always enabled). When unlocked, banner switches to "2nd attempt ready".
  - Remove the current "questioning" confirmation copy; label everything as "2nd attempt".
- `src/components/dashboard/HousekeepingStaffView.tsx` (or wherever the housekeeper task list is ordered — verify during build)
  - Sort `dnd_pending_retry` assignments to the bottom.
  - Effect that computes unlock: on mount + every 60s + when other assignments change, if all sibling assignments are in a terminal state OR `now >= 14:30 local`, patch `dnd_retry_unlocked_at = now()` for that housekeeper's `dnd_pending_retry` rows (idempotent via `is null` guard).
- `src/components/dashboard/SupervisorApprovalView.tsx`
  - Filter out `status = 'dnd_pending_retry'` from pending approvals.
  - When rendering a DND completion, fetch `dnd_photos` for the assignment grouped by `attempt_number` and render "Attempt 1" / "Attempt 2" sections.
- `src/components/dashboard/EnhancedDNDPhotoCapture.tsx`
  - Accept and forward `attemptNumber` when inserting into `dnd_photos`.
- `src/hooks/useTranslation.tsx`
  - New keys (EN + UK + placeholders for HU/ES/VI/MN): `dnd.attempt1`, `dnd.attempt2`, `dnd.retryQueuedTitle`, `dnd.retryQueuedDesc` ("We'll try this room again after your other rooms or at 14:30"), `dnd.retryReadyTitle`, `dnd.tryAgainNow`, `dnd.secondAttemptBadge`, `approvals.dndAttemptsHeader`.

## Edge cases

- Housekeeper goes off shift before retry: the room stays as `dnd_pending_retry`. Nightly job (existing auto-signout window) is out of scope; manager can force-approve manually via a future action — not added now.
- Room reassigned to a different housekeeper: `dnd_attempt_count` and photos persist on the assignment row, so the new assignee sees "Attempt 1" thumbnails and the retry is theirs.
- Guest opens the door between attempts: housekeeper cleans normally, `dnd_attempt_count` reset to 0 on successful completion so `is_dnd` stays false.

## Out of scope

- Server-side cron for the 14:30 unlock — the client-side effect covers it because at least one housekeeper is online during the day; adding an edge function can be a follow-up if needed.
- Changing manager notification copy beyond the "attempts" grouping.
