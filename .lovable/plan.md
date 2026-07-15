## Goals

Fix four related PMS/housekeeping issues so the morning refresh is trustworthy and matches reality:

1. Clear stale manual overrides on a new working day (same pattern already used for DND).
2. Auto-detect bed arrangement from PMS notes and surface it to housekeepers, without overwriting manager-set values.
3. Mark already-departed checkout rooms as Ready-to-Clean on assignment, and split them across housekeepers during Auto-Assign.
4. Restrict the Early Checkout badge to real checkout rooms (never daily rooms).

---

## 1. New-day reset of manual overrides

`src/lib/pmsRefresh.ts` already clears DND once per calendar day using `pms_metadata.lastPmsRefreshDate`. It does NOT clear `pms_metadata.manual_checkout` or `pms_metadata.manual_daily`, so a manual promotion made yesterday keeps forcing today's bucket — that's why 201 still shows the yellow "M" and stays under Checkout Rooms today.

Change in `pmsRefresh.ts` new-day block:

- When `lastRefresh < today`, in addition to clearing DND, for every room in the hotel:
  - Strip `manual_checkout`, `manual_checkout_at`, `manual_checkout_by`, `manual_daily`, `manual_daily_at`, `manual_daily_by` from `pms_metadata`.
  - Clear stale note prefixes ("Early Checkout …", "No Show") when `pms_metadata.pmsSyncDate < today` so yesterday's text does not leak into today's UI.
- Do NOT touch `is_checkout_room` directly here — the per-row loop that follows will recompute it authoritatively (and the same-day manual-override branch keeps working for moves made today).
- Log a single "New day reset" entry into `pms_sync_history` so managers see it.

Result: on the first morning refresh the yellow "M" chip disappears automatically; if PMS still reports the room as checkout, it stays a checkout; if not, it moves back to Daily.

## 2. Auto-detected bed configuration from PMS notes

Today `rooms.bed_configuration` is only set manually. PMS notes like "Separate beds", "single beds", "twin beds" arrive in `row.Note` and are stored verbatim into `rooms.notes`. The dropdown values (screenshot: Room 401) are: Double Bed, Twin Beds, Twin Beds Separated, Single Bed, Baby Bed, Extra Cot Added.

Changes:

- New file `src/lib/bedConfigInference.ts` exporting `inferBedConfigFromNote(note: string): { value: string; matchedKeyword: string } | null`. Keyword map (case-insensitive, multilingual for HU/IT/ES where common):
  - `separate beds`, `twin beds separated`, `beds separated`, `külön ágy`, `letti separati` → `Twin Beds Separated`
  - `twin beds`, `two singles`, `2 singles`, `single beds` (plural, with a guest count > 1) → `Twin Beds`
  - `single bed` (singular) → `Single Bed`
  - `double bed`, `matrimoniale`, `franciaágy`, `queen`, `king` → `Double Bed`
  - `baby bed`, `crib`, `cot` (not "extra cot") → `Baby Bed`
  - `extra cot`, `extra bed`, `rollaway`, `pótágy` → `Extra Cot Added`
- New test `src/lib/bedConfigInference.test.ts` covering each bucket + negative cases (empty/unrelated notes → null).
- In `src/lib/pmsRefresh.ts` per-row loop, after computing `row.Note`:
  - Compute `inferred = inferBedConfigFromNote(String(row.Note ?? ""))`.
  - If `inferred && !room.bed_configuration` → set `updateData.bed_configuration = inferred.value` and set `pms_metadata.inferredBedConfig = { value, keyword }`.
  - Never overwrite an existing manager-set value. If manager later clears it, next refresh may re-infer.
- Add a diff row into `proposedChanges` so the PMS Refresh preview dialog shows the auto-detected bed config change before it applies.

Housekeeper visibility: bed configuration already renders prominently in `AssignedRoomCard.tsx` (blue "BED CONFIGURATION" panel), `HousekeepingStaffView`, `SupervisorApprovalView`, and on room chips in `HotelRoomOverview`. No UI work required beyond an optional small "auto from PMS" hint in the manager Room Settings popover (only if the popover file is straightforward — safe to skip).

## 3. Ready-to-Clean for departed checkouts + split across housekeepers

The Previo sync already writes `pms_metadata.checkedOutToday: true` and `rooms.checkout_time` when the guest has actually departed (status ids 5/9, as fixed in the last round). But `src/components/dashboard/AutoRoomAssignment.tsx` line 520 forces `ready_to_clean: false` for every `is_checkout_room`, regardless of whether the guest has left.

Changes in `AutoRoomAssignment.tsx`:

- Add a helper `const hasDeparted = (room) => room.pms_metadata?.checkedOutToday === true || !!room.checkout_time;`
- Include `checkout_time` in the room select (line ~278).
- When building each assignment row:
  - `ready_to_clean: hasDeparted(room) ? true : !(room.is_checkout_room || room.pms_metadata?.scheduledDepartureToday === true)`
- So 201/303/403 (already departed today) will be RTC the moment they're assigned. Not-yet-departed checkouts stay non-RTC until the front desk (or a later PMS refresh) confirms the departure — existing `previo-poll-checkouts` flow already flips them.

Split departed checkouts across housekeepers, so both start with real work:

- After `assignmentPreviews` are built, extract every already-departed checkout across all previews into a `departedPool`.
- Remove those rooms from each preview's `rooms[]`.
- Round-robin push them back — one to each housekeeper first, then continue distributing extras — so each housekeeper starts their day with a departed checkout when supply allows.
- Priority-1 sort within each housekeeper's queue is unchanged, so departed rooms still land at the top of the queue.

No change to auto-assign for non-departed checkouts or dailies.

## 4. Restrict Early Checkout badge to checkout rooms

`isEarlyCheckout` in `src/components/dashboard/HotelRoomOverview.tsx` (line 491) only checks `room.notes`. A daily room whose notes still contain "Early Checkout" (e.g. 103 leftover from yesterday) shows the orange ring.

Change:

```ts
const isEarlyCheckout = (room: RoomData) => {
  if (!room.is_checkout_room) return false;
  return room.notes?.toLowerCase().includes('early checkout') || false;
};
```

Effects:
- `earlyCheckoutRooms` list and the top "EARLY C/O" KPI both correct themselves.
- Combined with the note-cleanup in section 1, stale "Early Checkout" text from yesterday will also be scrubbed on the first morning refresh so it can never resurface as a badge again.

---

## Technical details

Files changed:
- `src/lib/pmsRefresh.ts` — extend new-day reset (strip manual override keys + stale note prefixes), call `inferBedConfigFromNote`, write `bed_configuration` when empty, add change to preview diff.
- `src/lib/bedConfigInference.ts` (new) + `src/lib/bedConfigInference.test.ts` (new).
- `src/components/dashboard/AutoRoomAssignment.tsx` — RTC for departed checkouts, departed-checkout round-robin distribution, select `checkout_time`.
- `src/components/dashboard/HotelRoomOverview.tsx` — gate `isEarlyCheckout` on `is_checkout_room`.

No DB migration required. No edge-function redeploy required. All changes are client-side + the shared PMS sync routine.

## Verification

1. Trigger a PMS refresh — confirm 201 loses its yellow "M" and moves back to Daily if PMS no longer flags it (or stays in Checkout if PMS confirms it).
2. Confirm 201/303/403 assigned via Auto-Assign land as RTC (green) and are distributed across housekeepers rather than piled on one.
3. Confirm 103 no longer shows the orange Early Checkout ring, and the "EARLY C/O" KPI count drops.
4. Confirm a room whose PMS note is "Separate beds" auto-populates `Bed Config = Twin Beds Separated` and shows in the housekeeper's Assigned Room Card. Manually set a different value and confirm the next refresh does not overwrite it.
5. Run `bun vitest run src/lib/bedConfigInference.test.ts src/lib/pmsClassification.test.ts`.
