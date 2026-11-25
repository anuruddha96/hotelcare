# RD Hotels — Master Staff Schedule rollout

**Status:** Development branch only; production schema migration and workbook data import require review. This is an operational roster, not an authoritative payroll ledger.

## Existing system and findings (11 November 2026)
- Database: `staff_schedules`, `staff_schedule_venues`, `profiles`, `staff_attendance`. One schedule source of truth; never make a separate Housekeeping/HR copy.
- The current SQL RLS for `staff_schedules` was SLNT-only; RD Hotels had **zero** stored schedule rows. The dashboard displayed 84 active RD profiles but zero scheduled shifts.
- RD profile `assigned_hotel` values alternate between canonical IDs and full hotel names. Normalize before filtering and inserting.
- The source workbook `WORK SCHEDULE 2026-2.xlsx` has month sheets with departments across row 1, employee names row 2, and calendar dates in column A. There are repeated names across the organization, and imported Excel date-formatted values which originated as clock ranges. Never silently convert those date objects into shifts.
- January–December source review yielded 22,309 non-empty staff-day cells; only 2,552 were confident explicit clock ranges. The rest are source-specific abbreviations, venue descriptions, or ambiguous entries. `SZ` and `K` are NOT globally safe to treat as paid leave or a working shift.
- Source workbook and full review CSV are **private user materials** and must not be committed to the public repository.

## Role matrix

| Role | Roster scope | Write scope | Staff administration | Hours/leave overview |
|---|---|---|---|---|
| Admin | RD organization | Active/future RD schedules | Existing administrative staff-management dialog | Portfolio |
| Top management | RD organization | Active/future RD schedules | Position editing via scoped RPC; user account creation requires separate auth workflow | Portfolio |
| HR | RD organization | Active/future RD schedules | Position editing and position history; user account creation requires separate auth workflow | Portfolio |
| Property manager | Assigned RD hotel, treating IDs and display names as aliases | Own property's active/future employee schedules | Position editing for own property's staff; actual account creation via existing secure workflow only | Property |
| Housekeeping manager | Same as property manager | Own property | Own property's positions | Property |
| Operational staff | Own **published** roster only | No editing | None | Own shift details only |

**Important:** React visibility is not authorization. RLS and a dedicated job-title RPC enforce permission on the server. All requests are scoped to the authenticated user's trusted database profile, not a user-editable JWT metadata field.

## Shipped in this branch
1. A weekly planner plus Excel-style monthly matrix: rows = dates, columns = employees grouped by department, sticky headers, filters, quick editing, copying, draft publishing and workbook export.
2. Work status: working, off, leave, sick, training. Clear differentiation of draft vs published and historical read-only. Future room autoassign consumes only explicitly published working housekeeping shifts and may not change started/manual/completed room assignments.
3. Calculated planned hours with overnight support. This is clock-span total **before** breaks, overtime, paid/unpaid leave balance, attendance reconciliation, holiday rates and contracts.
4. Reusable property normalization of RD's canonical hotel keys vs full names; managers see only their assigned property; normal staff see only their own published shifts.
5. A **review-first** browser-side workbook reader; only exact employee name matches and unambiguous future clock ranges are eligible. Invalid dates, unfamiliar codes, duplicate employee-days, past dates and existing entries are excluded. Explicit import creates draft records in batches of at most 100; it does not publish or overwrite.
6. Secure, audit-logged free-text position editing. HR position labels never grant/revoke access; only the existing role-management system may assign security roles. Admin can open existing user-management dialog.
7. Additive RD-specific RLS database migration; old SLNT access policies preserved; server blocks editing past dates.

## Operational gates before release
- Run `bun install --frozen-lockfile && bun run test && bun run build` through the Frontend CI workflow.
- Review all RLS migrations with DBA; run authorization tests with representative RD admin, HR, top manager, hotel manager, housekeeping, maintenance, laundry and receptionist accounts, and negative cross-hotel/tenant cases. Verify the administrative role and audit function are not invokable by ordinary staff.
- Test day/night shifts, DST weekends, invalid time ranges, published leave/off (no shift hours), browser timezone vs Budapest timezone.
- Import one future week as draft for one property, review against the Excel source, then publish using a separate approval step. Do not call planned shifts confirmed attendance.
- Confirm mapping for departed employees, missing accounts, duplicate/nicknamed employee headers and the abbreviations from each department.
- Scope employee account onboarding/offboarding and HR security role assignment separately: existing UserManagementDialog is admin-focused; do not widen it to HR/top managers without validating edge-function authorization.
- Payroll phase: approved leave requests and balances; attendance correction approval; paid/unpaid break policy; 2026 public holiday calendar; employment-specific hour/OT rules; exporting pay period totals.
- Housekeeping phase: roster → staffing preflight only, no automated room allocation until assignment quality and manual-assignment protection pass production tests.

## Privacy / retention
- Never push the workbook, employee list, or import CSV to GitHub.
- Avoid permanently deleting accounts with past work or leave records; deactivate employees and preserve history in a legally reviewed retention policy.
- Proposed position history table is accessible only to HR/executives in RD Hotels.
- Treat input workbook dates and abbreviations as data. Human-approved mapping rules are required before backfilling historical archive.
