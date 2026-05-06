1. Repair the daily overview parsing that is losing guest names
- Update `supabase/functions/revenue-overview-upload/index.ts` so it identifies the guest columns exactly, instead of matching `arrival`/`departure` against `Date (arrival)` and `Date (departure)`.
- This will fix rooms like 206/306 where the app currently stores date-like text such as `4. 5.` as `guest_names`, sets `pax` to 0, and still shows breakfast counts.
- Keep the hotel-specific room-code parsing, but make the row extraction deterministic for turnover/arrival/departure rows.
- Make re-uploads replace prior snapshot rows for the same hotel/date/file so corrected uploads clean up bad data instead of stacking duplicates.

2. Fix the confirm and partial-confirm edge function failures
- Update the `/bb` client and `supabase/functions/breakfast-mark-served/index.ts` to accept guest names safely whether they come in as a string or an array.
- Normalize the payload to the `breakfast_attendance.guest_names text[]` format before insert.
- Return clearer error messages from the edge function so the UI can show a useful failure reason if something else goes wrong.
- Keep partial confirmations supported exactly as now, but make them reliable.

3. Add cross-restaurant visit warning for Hotel Memories Budapest
- Reuse `breakfast_attendance` records to detect whether the same room was already marked at another restaurant on the same stay date.
- Extend `breakfast-public-lookup` to return prior visit info with location and timestamp.
- In `src/pages/Breakfast.tsx`, show a non-blocking warning such as “Already served at Levante at 08:14”.
- Staff will still be able to continue and confirm service at the current restaurant.

4. Show a clear “breakfast not included” message
- For reservations found on the selected hotel/date where breakfast and all-inclusive are both 0, show a clear staff message that breakfast is not included and they should check with reception.
- Keep `not_found` separate from `not_eligible`, so staff can distinguish “no reservation found” from “reservation exists but breakfast is not included”.

5. Make `/bb` multilingual
- Convert the hardcoded Breakfast page strings to `useTranslation()` keys.
- Add the needed labels/messages for the app’s supported UI languages currently in code: `en`, `hu`, `es`, `vi`, `mn`, and `az`.
- Translate the hotel/restaurant selection flow, lookup states, warnings, confirm actions, and served-list text.

6. Isolate the public `/bb` page from manager notifications
- Remove `/bb` from the authenticated real-time notification shell, or gate the notification provider by route so `/bb` never subscribes to manager/admin channels.
- Keep only page-local feedback toasts for breakfast actions.
- This prevents a logged-in manager from seeing unrelated internal notifications while using the public breakfast screen.

7. Validate the full flow
- Verify rooms like 206 and 306 show the correct room type, guest names, and pax after the fixed overview file is uploaded again.
- Verify full confirm and partial confirm both succeed.
- Verify a second-restaurant visit warning appears for Hotel Memories Budapest and still allows confirmation.
- Verify `/bb` shows no manager notifications even when a manager session exists in the browser.

Technical notes
- Root causes identified:
  - The daily overview uploader currently uses fuzzy header matching, so `arrival` can match `Date (arrival)` and `departure` can match the wrong header. That is why some rooms show dates instead of guest names.
  - `daily_overview_snapshots.guest_names` is stored as `text`, while `breakfast_attendance.guest_names` expects `text[]`. Confirming from snapshot-backed results likely fails when the client sends a string into the attendance insert.
  - `/bb` is currently rendered inside the global notification/auth shell, so logged-in manager/admin users can receive unrelated app notifications there.
- Existing bad snapshot data cannot be corrected from the current stored rows alone. After the parser fix is deployed, the affected daily overview XLSX files should be re-uploaded so the corrected guest data replaces the bad records.