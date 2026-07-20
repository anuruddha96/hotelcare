## Problem

1. **False minibar popup on approval** — `fetchMinibarForRooms` in `SupervisorApprovalView.tsx` surfaces *every* uncleared `room_minibar_usage` row with `usage_date < endOfDay`, including rows from previous days that were never cleared. So a room with no consumption today still triggers the "Room X — minibar used" confirmation because yesterday's row is still `is_cleared = false`.

2. **Minibar Tracking page** — shows historical rows from previous stays, generic "Staff" badge (no real user name), no room-level roll-up, no refill state, no hotel summary.

3. **No refill audit trail** — `room_minibar_usage` has no `cleared_by` / `cleared_at`; refill data is silently written into `guest_checkout_date`, so we can't display "refilled by whom / when".

## Fix Plan

### A. Approval gate — only today's housekeeper-added usage

In `src/components/dashboard/SupervisorApprovalView.tsx`:
- Change `fetchMinibarForRooms` filter from `.lt('usage_date', endOfDay)` to `.gte('usage_date', startOfDay).lt('usage_date', endOfDay)` so only rows dated for the currently-approved day gate the approval.
- Restrict to sources the housekeeper flow actually creates (`source in ('housekeeper','staff')`) so guest-QR / reception-added rows don't block a housekeeping approval.
- Prior-day uncleared rows still exist in the DB and remain visible/actionable on the Minibar Tracking page — they simply no longer block today's room approval.

### B. Refill audit columns (migration)

Add to `public.room_minibar_usage`:
- `cleared_by uuid` (nullable, references `auth.users`)
- `cleared_at timestamptz` (nullable)
- `cleared_note text` (nullable, optional short reason)

Backfill: none required (existing rows stay null).

Update `markMinibarUsageCleared` in `SupervisorApprovalView.tsx` to write `cleared_by = auth.uid()` and `cleared_at = now()` instead of overloading `guest_checkout_date`.

### C. Minibar Tracking page rewrite (`MinibarTrackingView.tsx`)

Replace the current per-record list with a room-chip dashboard:

**Header summary (hotel-scoped, today or selected date):**
- Rooms with active (uncleared) usage
- Total items consumed
- Total revenue
- Rooms up-to-date (green)

**Body:** grid of room chips, one per occupied room in the hotel.
- Green chip → no uncleared usage → label "Minibar up to date"
- Red chip → has uncleared usage → shows count of items, total €, and last recorder name
- Tap a chip → drawer/sheet with: each item + qty + price, **added by <full name>** (from `profiles.full_name` via `recorded_by`) + timestamp + source badge (Housekeeper / Manager / Reception / Guest QR), and if `cleared_at` is set: "Refilled by <name> at <time>"

**Auto-recycle on checkout:** hide any row where the room's current reservation shows the guest has already checked out (reservation `check_out < today` and no active in-house reservation). Rely on existing reservation data; do not delete rows — just filter them out of the view. If no reservation data is available, fall back to hiding rows older than 7 days.

**Recorded-by resolution:** join `recorded_by` → `profiles.full_name` (already partially done). Remove the hard-coded "Staff" label; when `source = 'guest'` keep "Guest (QR)".

### D. Translations

Add keys for: `minibar.upToDate`, `minibar.needsRefill`, `minibar.addedBy`, `minibar.refilledBy`, `minibar.roomsUpToDate`, `minibar.roomsNeedingRefill`, in EN + UA (+ HU/ES/VI/MN placeholder = EN fallback).

## Technical Notes

- Files changed: `SupervisorApprovalView.tsx`, `MinibarTrackingView.tsx`, `useTranslation.tsx`, one new migration for the three new columns on `room_minibar_usage`.
- No RLS changes required — new columns inherit existing table policies.
- Existing `LateMinibarApprovals` tab (which is exactly the place to reconcile older uncleared rows) is unaffected.
