# Excel employee → existing HotelCare account mapping (RD pilot)

Status: **draft only; not merged, migration not applied to production**. See PR #229 and scope #228. Use synthetic spreadsheets and approved TEST identities for this UAT; do not put real staff rosters, credentials or health information in GitHub.

## Functional contract

1. Load only accounts returned by the server-authorized `work_schedule_staff_accounts_for_hotel` RPC, intersected with the existing schedule staff list. Show each employee's full name, username (`profiles.nickname`), role and a short account-ID discriminator. Do not create a second user from an Excel label.
2. Compare the source name to existing account names/usernames to **suggest** likely matches. Never automatically confirm an unreviewed suggestion, including exact matches. Full names may be duplicated. A manager can choose a profile ID or explicitly exclude another property's column.
3. A manager explicitly confirms a reviewed mapping: organization `rdhotels` + authorized venue ID + Excel source label → immutable `profiles.id`. Confirm via `work_schedule_confirm_employee_links`; save only those aliases and IDs, never full workbook bytes, shift cells, diagnosis or password. Each new confirmation gets an audit record.
4. On a later upload to the same venue, reuse only its previously confirmed alias → profile-ID link, provided that the account is **still authorized** for that venue and the source name is not duplicated within the sheet. Changing an account's full name/nickname must not break the stable link.
5. A source alias previously linked to a different profile cannot silently be reassigned. Fixes require a future separately authorized, audited correction workflow; a mere dropdown selection cannot replace the saved identity.
6. Schedule entries independently reference `work_schedule_entries.staff_id = profiles.id`; the employee's My schedule query additionally requires the current `auth.uid()` and published state. An Excel link alone **does not create shifts**. Bulk import/publish remains disabled until codebook, transactional import, conflict/rollback and legal checks are delivered.

## Test matrix (test database and authenticated, non-service-role test accounts)

- Matching: unique username, unique full name, names with Hungarian accents, duplicate full names with distinct usernames, no-match name. Suggestions never pre-approve. Manually confirmed names reappear on subsequent uploads; account rename retains UUID.
- Workbook: ambiguous duplicate source labels across columns block permanent save; duplicate profile assigned to two columns blocks save; empty names, other-property columns and unrecognized shift codes never become identities. Correct use of Exclude does not create a mapping. A successful identity confirmation must not create roster shifts.
- Isolation: Memories manager cannot list Ottofiori accounts or mappings, nor invoke either RPC there; employee, other-organization, anon and unauthenticated tokens cannot fetch accounts/mappings or write links. Direct POST/PATCH/DELETE on link table and SELECT on audit table are denied.
- Atomicity: submit two links where the second has a foreign-hotel account or conflicts with an existing alias. The entire RPC transaction must roll back both; no partial link/audit additions. Retry the same approved links: zero new records and unchanged mapping; concurrent conflicting mapping requests must not overwrite one another.
- Identity changes: nickname/full name changed, profile disabled/deleted/reassigned to another property, hotel switched mid-file load. Only still-authorized venue accounts can be suggested/reused. On venue or month change the workbook and selection clear, and stale async account responses must be discarded.
- Permissions: approved RD admin/HR may access their authorized venues as currently defined by `work_schedule_can_manage`; property manager only assigned venue; the account picker may **not** grant additional venues. Staff may not view their colleagues' alias mappings. Validate using direct REST and RPC calls with real TEST JWTs; frontend checks alone are insufficient.
- Verify the new SQL migration and its ownership, grants, foreign keys, RLS and function execution in an independent test database. Existing frontend CI is not a substitute for database or authorization tests.

## Known blockers

The importer still cannot write shifts, account-link correction is deliberately locked pending an audited UI, and medical/contract records, holiday entitlement, attendance reconciliation, notification and Hungarian employment-law release checks remain separate outstanding phases. The real Excel workbook is never added to this repository. No production schema or employee account changes are authorized by this draft.
