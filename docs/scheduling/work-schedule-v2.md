# Work schedule v2 (RD Hotels)

Requested 23 Nov 2026 after reviewing `WORK SCHEDULE 2026` (the Excel the team plans in today). The workbook itself is private and is not in this repository.

## What changed

**Who sees what**

| Role | Sees | Plans |
|---|---|---|
| Admin, top management, HR, Controlling | every hotel | every hotel |
| Manager (role set by the owner) | every hotel | every hotel |
| Housekeeping manager | every hotel (new) | own hotel |
| Housekeeping supervisor, reception on manager level | own hotel | own hotel |
| Everyone else | own published days only | nothing |

**Changing a day staff have already seen**

1. A manager edits a published day. The change is saved as a draft; the employee keeps seeing the last published version (`workforce_entries.published_version`). Nobody is told anything yet.
2. Emptying a published day becomes an explicit "day off" draft, not a silent delete.
3. On **Publish** the employee gets one notice per changed day (before → after, who, optional reason) and one push notification, and confirms with one tap. A change less than 4 days ahead is flagged: under Mt. 97. § (5) the employee has to agree.
4. The first publication of a month creates no notices.
5. Optional visibility window (Teams & codes): staff see only the next N days of their schedule; approved leave is always visible.

**Planner screen**

- Uses the whole window width; venue tabs and team chips with head-counts; one "Show" filter (drafts, unpublished changes, not confirmed by staff, leave, sick, nights, to check, nothing planned).
- Header groups split by hotel when several hotels are shown; "On duty" column (day + night) and a "Days worked" total.
- An unplanned month shows its public holidays and offers Copy last 4 weeks / Let Mira draft it.
- **History**: every change of the month from the audit log, grouped by person and moment, with "Restore to before this". Restored days are drafts; past days and other hotels are skipped.
- All texts of the Schedule tab, day details, history and the employee's own schedule exist in the nine app languages; public holidays, weekdays and default team/job names follow the language.

**Mira**: `get_schedule_changes` (who has not confirmed, what is not published yet); housekeeping managers may ask about another hotel's schedule (read-only).

## Release order

1. Apply `supabase/migrations/20261123120000_workforce_schedule_v2.sql` (additive; safe to apply twice). The app works before and after it: without it the new columns are simply not read.
2. Merge, redeploy the Edge Functions that bundle `_shared/assistantScheduleTools.ts` and `_shared/accessPolicy.ts`, then publish the frontend.
3. Optional: set the visibility window under Work schedule › Teams & codes.

## Tests

- `src/test/workforceScheduleV2.test.ts` (history, restore, filters, wording, nine-language completeness).
- `supabase/tests/workforce_schedule_v2_test.sql` on a scratch database prepared with `workforce_schedule_v2_fixture.sql` (23 checks: scope, pending changes, notices, push, visibility window).

## Not in this change

- The Staff, Analytics, Teams & codes and Import Excel sub-tabs still have English labels.
- An employee cannot decline a change in the app; a short-notice change shows "tell your manager now".
- Excel import of clock ranges that Excel turned into dates (`08-17` stored as 17 August) is unchanged.
