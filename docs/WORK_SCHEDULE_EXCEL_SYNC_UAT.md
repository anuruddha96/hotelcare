# RD Hotels Excel roster sync — pilot UAT / release blocker

**Draft code only. Do not merge, deploy, apply production migrations or upload the real roster to GitHub.** See PR #229 and issue #228. `WORK SCHEDULE 2026.xlsx` was inspected locally for structural patterns only; no employee names, usernames, account IDs or workbook bytes were committed.

## Structures observed in the supplied workbook (2026-09-17)

- Hungarian month/year worksheet titles (`Szeptember 2026`, `Október 2026`, etc.) and an undated `minta` template; one month tab may contain columns for multiple hotels, restaurants and departments.
- Row 1 holds the department or venue per column, row 2 the employee's display name; column A contains numeric days and column B weekdays. Weekly blank rows occur.
- Many monthly tabs append a few next-month days after the last day. The parser skips those trailing days rather than assigning them to the wrong month or double-importing them from the following tab.
- Some human-entered `08-17` or `11-20` shifts became Excel date serials with an **`m-d` or `mm-dd`** number format. The importer accepts *only* these specific formats, with a clear manager opt-in that converts the displayed `08-17` to `08:00–17:00`. Other Excel number formats and arbitrary numbers still block. Validate their meaning against the original workbook before enabling.
- Opaque codes such as `SZ`, `K`, `HK`, `SV`, and department/location text cannot be guessed globally. A reviewer must explicitly define their shift times or off/leave status. Explicit `(+1)` overnight and clearly written split shifts are recognized.
- Historic sheets have formulas in total/footer cells. A formula in an included employee's active day slot must block import; a footer formula on an unselected sheet must not block name/account mapping.

## Test-environment acceptance (NOT performed by frontend CI alone)

1. Independently review and apply migrations `20260917160000` (foundation), `20260917163000` (account links) and `20260917170000` (atomic import) ONLY to an approved TEST database. Use synthetic staff and workbook data; verify function ownership, grants and RLS.
2. As an RD venue manager, confirm that another venue is unavailable via UI, direct REST and forged RPC arguments. Verify an employee, unauthenticated user and other-org user cannot read private account links or write schedules. HR/admin authorization must be verified against persisted venue permissions.
3. In mapping section 1, upload a synthetic multi-venue workbook and confirm names against authorized existing HotelCare profiles. Duplicates, missing accounts and unauthorized venues must not silently match or create users. In section 2, reload confirmed links and select the same workbook.
4. Select two or more dated tabs; the undated template must be ignored. Verify correct month/year, every date 1–last day, blank week separators and no trailing next-month duplicate entries.
5. Verify unknown codes, invalid times, duplicate staff/day/slot, missing confirmed aliases, wrong-hotel headers, active-slot formulas, unsupported numeric cells and ambiguous overnight expressions all block import. HR explicitly reviews codebook and recognized Excel auto-date conversion.
6. Compare test database entries: new, changed draft, unchanged, conflicting published. Published *differences* block the whole import; identical published work, **off and leave** entries must show unchanged. Missing Excel rows never delete saved records; existing operational notes are preserved.
7. Approve and submit as a real manager JWT (not service-role credentials). Verify one transaction, audit events, import-run counters, revision numbers, source `xlsx` and draft-only state. Staff can see only their own entries after separate authorized publication, never draft entries.
8. Re-import unchanged data: zero inserts/updates, all unchanged. Race an edit in a second session after preview; stale versions must reject and roll back all changes. Forge another hotel, employee ID, source alias, duplicate row or invalid date: reject with no partial writes.
9. Verify pagination past 1,000 rows, maximum 6,000 import rows, rejection of truncated >15,000-row previews and safe retry after a network failure. Test real-device desktop/mobile and proper Hungarian/English language support.
10. Obtain HR/local labor-law and privacy clearance (roster notice, breaks/rest, DST, GDPR roles and retention) before any production merge/deployment. Draft import must never impersonate staff, change existing attendance, payroll or send premature published-shift notifications.

## Explicit limitations and release blockers

- Employee mapping and shift synchronization currently require two browser-local selections of the same workbook, with an account-link reload after confirmation; one-upload UX is not delivered yet.
- There is no deletion of missing rows, automatic modification of published schedules, actual/paid-hour or holiday calculation, creation of login accounts, or unreviewed code inference. Maximum 6,000 rows per **all-or-nothing** hotel batch. An audited undo/revision process for an already successful batch is not yet implemented.
- Production migrations have NOT been run. Frontend build and synthetic Vitest tests cannot certify the SQL functions, authenticated RLS, complete source-file interpretation, regulatory compliance or real-account UAT. Keep PR draft until those gates pass.
