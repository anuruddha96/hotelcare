## What I verified first

- `HousekeepingManagerView.tsx` counts assignment statuses into only three buckets (`completed`, `in_progress`, `assigned`) and the room-chip list filters by those statuses — so `dnd_pending_retry` rooms fall out of every bucket and vanish from manager housekeeper cards. Confirmed root cause.
- The 2nd-attempt DND block in `AssignedRoomCard.tsx` is hardcoded English ("2nd attempt — …", "You can try this room again now…", "Still Do Not Disturb — send to supervisor"), and the status chip renders the raw enum `DND PENDING_RETRY`.
- Manager messages are inserted in `HotelRoomOverview.tsx` with `assignment_id: null`, but the housekeeper card queries `housekeeping_notes` with `.eq('assignment_id', assignment.id)` — so a manager message never reaches the housekeeper (Room 305 case). Confirmed root cause.
- The approval card labels every `housekeeping_notes` row "HOUSEKEEPER MESSAGES" regardless of `created_by`, and shows only a bare time — hence Room 202 looking like a housekeeper message.
- `roomCard.managerNotes` and `roomCard.translateNote` exist in **no** language bundle (that's the raw `ROOMCARD.MANAGERNOTES` in Room 203).
- All `dirtyLinen.*` keys (incl. `totalItemsLabel`, `removeConfirm*`) **are** present in the English bundle now; that finding looks already fixed, so this plan verifies it in the browser rather than assuming.
- Manual bed configuration is saved in `HotelRoomOverview.tsx` as a plain `rooms.bed_configuration` update — no author or timestamp is stored, so provenance has to be added.

## Plan

**1. DND rooms visible to managers**
- Add a `dnd` bucket in `HousekeepingManagerView.tsx`: count `dnd_pending_retry` (and rooms flagged `is_dnd`) as their own tile next to Done / Working / Pending, and include those assignments in the clickable room-chip list so they never disappear.
- Include `dnd_pending_retry` in the hotel-overview housekeeper card status mapping and chip badge, with a distinct purple "DND · 2nd attempt" style.

**2. DND 2nd-attempt UI translated**
- Add keys `dnd.secondAttemptTitle`, `dnd.retryNowHint`, `dnd.retryLaterHint`, `dnd.stillDndSendSupervisor`, `status.dndPendingRetry` to en/hu/es/vi/mn/uk/ru/az/tl and use them in `AssignedRoomCard.tsx` (banner + status chip) and in the manager views.

**3. Checkout rooms: no "Bed Linen Change"**
- Suppress the linen badge/instruction block for checkout cleans exactly as towels already are, in `AssignedRoomCard.tsx`, `MobileHousekeepingCard.tsx`, `HotelRoomOverview.tsx`, `SupervisorApprovalView.tsx`, `ApprovalHistoryView.tsx` and `AutoRoomAssignment.tsx` (shared `needsLinenChange(assignment)` helper next to the towel one).

**4. Manager → housekeeper messages actually delivered**
- Manager send in `HotelRoomOverview.tsx`: resolve today's assignment for that room and store its `assignment_id` (keep `null` only when no assignment exists).
- Housekeeper card fetch: match on `assignment_id = this assignment` **OR** (`room_id` = this room AND note created today in Budapest time AND `assignment_id is null`). Same for the realtime subscription (subscribe on `room_id`).
- Messages show for checkout rooms that are still "waiting for guest checkout" / not started — the message block is rendered regardless of assignment status.
- Each message gets a "Translate" action using the existing `translate-note` edge function into the viewer's selected language, plus an auto-translate on load when the note language differs.

**5. Message attribution (sender, role, Budapest time)**
- Join `profiles` on `created_by` when loading notes in `SupervisorApprovalView.tsx` and `AssignedRoomCard.tsx`.
- Render sender name + role badge ("Manager" vs "Housekeeper") with distinct colours and left/right alignment, and the timestamp formatted through `budapestTime.ts` as `MMM d, HH:mm`.
- Section header becomes "Messages" instead of "Housekeeper messages".

**6. Manager note translation on the housekeeper card**
- Add the missing `roomCard.managerNotes` / `roomCard.translateNote` keys to every language bundle, so Room 203 shows a real label and a working translate link.

**7. Bed configuration provenance**
- On manual save, write `pms_metadata.manualBedConfig = { value, setBy: <user id>, setByName, setAt }`.
- Display "Set by {name} · {Budapest date/time}" under the bed-configuration block on the manager overview and on the housekeeper card; PMS-inferred configs show "From PMS" instead.
- Existing checkout reset logic already clears `manualBedConfig`, so provenance clears with it.

**8. Dirty Linen dialog**
- Re-verify in the running app (English) that the cart total, intro line, save status, "Latest" badge and remove-confirmation render real words; fix any key that still falls through.

**9. Delete User**
- Re-verify the `admin-delete-user` → `soft_delete_user_profile` path end-to-end with an explicit caller id; if the RPC signature still lacks `p_caller_id`, add a migration for it and pass the caller's id from the edge function so the "Not authenticated" 403 cannot recur.

## Technical notes
- No schema change needed for messaging; only `housekeeping_notes.assignment_id` population and query widening.
- Bed provenance is stored inside the existing `rooms.pms_metadata` JSON — no migration.
- The only possible migration is the `soft_delete_user_profile(p_caller_id)` signature, applied for approval separately.
- There is also a runtime error in the housekeeper views (`Cannot access 'fetchAssignments' before initialization`) that I'll fix along the way.
