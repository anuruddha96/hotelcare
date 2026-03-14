

## Plan: Fix No Service Button UI & Add Guest Consent + Manager Visibility

### Issue 1: Missing Translations for No Service Button
The button shows raw key `housekeeping.noService` because no translations exist in `comprehensive-translations.ts`.

**Fix**: Add all `housekeeping.noService*` keys to English, Czech, Hungarian, and Spanish translation blocks in `src/lib/comprehensive-translations.ts`.

### Issue 2: Guest Consent Confirmation
The current dialog asks "Are you sure the guest declined?" but doesn't make it clear that the housekeeper must confirm the **guest explicitly told them** they don't want service.

**Fix** in `src/components/dashboard/AssignedRoomCard.tsx`:
- Add a checkbox the housekeeper must tick: "I confirm the guest personally informed me they do not require cleaning service today"
- Disable the "Confirm" button until the checkbox is checked
- Store the confirmation in the notes: `[NO_SERVICE] Guest confirmed no service required`

### Issue 3: Manager Visibility for Next-Day Planning
Currently `[NO_SERVICE]` is only stored in assignment notes. Managers have no way to see which rooms were skipped when planning next day's towel/linen strategy.

**Fix**:
- In `SupervisorApprovalView.tsx`: Detect `[NO_SERVICE]` in assignment notes and show a distinct badge (e.g., gray "No Service" badge) on approval cards so managers see it clearly
- In `HotelRoomOverview.tsx`: When rendering room chips, check if the room's most recent completed assignment has `[NO_SERVICE]` and show a visual indicator (e.g., "NS" code on the chip) so managers know that room was skipped yesterday and may need extra attention today

### Files to Change

| File | Changes |
|------|---------|
| `src/lib/comprehensive-translations.ts` | Add `housekeeping.noService`, `noServiceTitle`, `noServiceConfirm`, `noServiceNote`, `confirmNoService`, `noServiceConsent` in all languages |
| `src/components/dashboard/AssignedRoomCard.tsx` | Add consent checkbox to No Service dialog; disable confirm until checked |
| `src/components/dashboard/SupervisorApprovalView.tsx` | Detect `[NO_SERVICE]` in notes, show distinct "No Service" badge on card |
| `src/components/dashboard/HotelRoomOverview.tsx` | Show "NS" indicator on room chips for rooms that had no-service yesterday |

