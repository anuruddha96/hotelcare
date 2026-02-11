

## Plan: Clear DND on PMS Upload + Auto Sign-Out at Midnight

### Change 1: Clear DND Records on PMS Upload

**Problem:** When a new PMS file is uploaded (new working day), old DND flags from the previous day persist on rooms and show in the Hotel Room Overview and room cards.

**Fix:** In `src/components/dashboard/PMSUpload.tsx`, after fetching each room during PMS processing, reset the DND fields (`is_dnd`, `dnd_marked_at`, `dnd_marked_by`) as part of the room update. Since a new PMS upload represents a new working day, all DND statuses from the previous day should be cleared -- housekeepers will re-mark rooms as DND if needed.

**File:** `src/components/dashboard/PMSUpload.tsx`
- In the `updateData` object (around line 430), add three fields:
  ```
  is_dnd: false,
  dnd_marked_at: null,
  dnd_marked_by: null,
  ```
- This ensures every room processed by PMS upload gets its DND cleared automatically.

---

### Change 2: Auto Sign-Out Edge Function (Midnight Cron)

**Problem:** Users who forget to sign out remain with "checked_in" status indefinitely. Their working hours are not calculated.

**Solution:** Create a new edge function `auto-signout` that runs via a cron job before midnight. It will:

1. Find all `staff_attendance` records for today where `status = 'checked_in'` or `status = 'on_break'` and `check_out_time IS NULL`
2. Set `check_out_time` to 4:30 PM of that work_date (the standard end-of-shift)
3. Set `status` to `'auto_signout'`
4. Calculate `total_hours` from check_in_time to 4:30 PM minus break_duration
5. Add a note: "Auto signed out"

**New file:** `supabase/functions/auto-signout/index.ts`

**Cron setup:** Schedule via `pg_cron` to run daily at 23:50 (11:50 PM).

---

### Change 3: Late Sign-Out Confirmation (After 6 PM)

**Problem:** If a user tries to sign out after 6 PM, the system should ask whether they forgot to sign out or actually worked until that time.

**Fix:** In `src/components/dashboard/AttendanceTracker.tsx`, modify `handleCheckOut`:
- If current time is after 18:00 (6 PM), show a confirmation dialog asking:
  - Option A: "I forgot to sign out" -- signs out at 4:30 PM, status `'forgot_signout'`
  - Option B: "I worked until now" -- signs out at current time, status `'checked_out'`
- Create a new `LateSignoutDialog` component inline or as a separate dialog.

**File:** `src/components/dashboard/AttendanceTracker.tsx`
- Add state for `lateSignoutDialogOpen`
- In `handleCheckOut` (line 279), before `performCheckOut`, check if hour >= 18
- If yes, show dialog instead of proceeding
- Add two handler functions: `handleForgotSignout` (sets checkout to 4:30 PM) and `handleWorkedLate` (proceeds normally)

---

### Change 4: Update Attendance Status Badges

**Problem:** Status labels in attendance records should use concise terms.

**File:** `src/components/dashboard/AttendanceReports.tsx` (line 196-213)
- Add cases for the new statuses:
  - `'auto_signout'` -- Badge: "Auto Signed Out" (red/orange)
  - `'forgot_signout'` -- Badge: "Forgot Sign Out" (amber)
- Update the existing `checked_in` past-day label from "Not Signed Out" to stay as-is (it handles legacy records)

**File:** `src/components/dashboard/AttendanceTracker.tsx`
- In `getStatusBadge` (line 421), add cases for `'auto_signout'` and `'forgot_signout'`

---

### Summary of Changes

| File | Change |
|------|--------|
| `src/components/dashboard/PMSUpload.tsx` | Add `is_dnd: false, dnd_marked_at: null, dnd_marked_by: null` to room update data |
| `supabase/functions/auto-signout/index.ts` | New edge function to auto sign out users before midnight, calculating hours until 4:30 PM |
| New SQL migration | Set up `pg_cron` job to call auto-signout function daily at 23:50 |
| `src/components/dashboard/AttendanceTracker.tsx` | Add late sign-out dialog (after 6 PM) with "forgot" vs "worked late" options; add new status badges |
| `src/components/dashboard/AttendanceReports.tsx` | Add badge cases for `auto_signout` and `forgot_signout` statuses |

### Technical Details

**Auto-signout edge function logic:**
```
1. Query: SELECT * FROM staff_attendance WHERE work_date = today AND status IN ('checked_in', 'on_break') AND check_out_time IS NULL
2. For each record:
   - Set check_out_time = work_date + '16:30:00' (4:30 PM)
   - Calculate total_hours = (16:30 - check_in_time) - break_duration
   - Set status = 'auto_signout', notes = 'Auto signed out'
3. Return count of processed records
```

**Late sign-out dialog flow:**
```
User clicks Sign Out after 6 PM
  -> Dialog appears: "Did you forget to sign out?"
     [Forgot Sign Out]     -> checkout at 4:30 PM, status = 'forgot_signout'
     [I worked until now]  -> checkout at current time, status = 'checked_out'
```

**DND clearing:** Every room processed by PMS upload resets `is_dnd = false`. Housekeepers will re-mark DND rooms when they encounter them during the new day's work.

