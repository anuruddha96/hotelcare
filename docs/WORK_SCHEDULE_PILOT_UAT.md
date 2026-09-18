# Work Schedule / My Schedule — RD Hotels pilot acceptance and security gate

Status: **draft implementation only. DO NOT DEPLOY, APPLY PRODUCTION MIGRATIONS OR MERGE.** See issue #228 and PR #229. All test data should be synthetic; the user-provided real employee workbook has not been placed in this repository.

## Verified preflight (read-only production configuration, 2026-09-17)

- Organization `rdhotels` has the canonical hotel IDs `gozsdu-court`, `memories-budapest`, `mika-downtown`, `ottofiori`. Some existing employee profile `assigned_hotel` values use their exact full hotel name rather than the canonical hotel ID; the migration deliberately supports both *exact registered* representations.
- Requested `anu_000` resolves as the nickname `Anu_000`; role `top_management_manager`; RD organization; persisted assigned hotel `memories-budapest`. This does **not** authorize schedule changes at Ottofiori; switching a browser dropdown must not silently grant access. An RD admin must assign any additional venue scope explicitly using approved account-management controls before testing there.
- The only matched `liny` account was `Liny_029` (housekeeping), but it is assigned to **Hotel Memories Budapest**, not Ottofiori as specified in the request. Do not change the account or assume it belongs to Anastasia. Test its own-schedule isolation at Memories only, then verify the correct Ottofiori staff account separately through HR before running Ottofiori UAT. No authentication/impersonation has been performed.
- Live production schema does not yet contain this new migration; neither a development database nor production has been changed by this PR.

## Before running manual UAT

1. Apply migration `20260917160000_rd_work_schedule_foundation.sql` only to an authorized test database; ensure `organizations`, `profiles`, `hotel_configurations` and auth identities exist. Check migrations/tests with an independent reviewer. Do not use real employee documents.
2. Confirm that the manager/HR authorization source records represent current approved property memberships. The initial version is restricted to the persisted `assigned_hotel` and exact `hotel_name` match; multi-venue assignments require a separate permission model before production.
3. Sign in with authorized *test credentials* for `Anu_000`, an RD admin, HR, an Ottofiori housekeeper and a Memories housekeeper. Never paste passwords, private employee files or medical records into GitHub.

## Functional smoke checks

- Open `/<org>/work-schedule` from Work schedule or My schedule navigation on desktop/mobile. Verify the RD-only pilot gate does not show for other organizations.
- Admin/HR sees only RD Hotels venues; a manager sees exactly their persisted assigned venue; a venue dropdown or crafted request cannot unlock a different venue.
- Create day, overnight and non-working drafts; invalid break, invalid time, missing employee, unauthorized employee, wrong organization, invalid slot and date collisions fail. A successful draft is not visible in the staff-only read.
- Edit draft with correct version. In a second session edit first, then submit an old version: stale edit must fail; no overwriting. Published entries must reject edits; repeat publish must report zero newly published.
- Publish a reviewed month; employee now sees only their own published shifts, not co-workers, draft entries, other staff notes or any HR documents. Note: first-phase publication does not notify employees; there is no acknowledgment/revision workflow yet.
- Work entries spanning midnight calculate *planned* hours correctly; e.g. 20:00–08:00 next day with 30-minute unpaid break is 11.5 planned hours. Planned != actual/paid hours. Check Europe/Budapest DST weeks manually before adoption.
- Preview original XLS/XLSX locally, including all monthly sheets and template, multiple venue headings, merged/blank columns, duplicate names, `SZ`, `K`, `L`, overnight strings, split shifts and Excel numeric cells. No preview should create a database row or upload a raw workbook; import is **intentionally disabled**.
- Verify browser reload/tenant switch does not carry over a previous venue's employee roster. Verify mobile scrolling, labels and errors.

## Security verification — must be done with real test identities, not service-role credentials

- Direct REST `SELECT`, `INSERT`, `UPDATE`, `DELETE` on schedule entries as housekeeping/maintenance: only published self-read; all writes denied. Try changing staff ID, venue and organization in query.
- Staff calls to `work_schedule_save_draft`, `work_schedule_publish_range`, and `work_schedule_staff_for_hotel`: all denied (42501). Managers calling another venue or staff member from another venue: denied.
- Other organization users, anonymous users and unauthenticated RPC calls: denied. An RD admin cannot read a different organization's profiles by using this scheduling API. RLS and table privileges must remain effective after migration.
- Direct access to `work_schedule_events` must be denied to browser roles. Test that audit records are created for successful create/edit/publish and not exposed via public API.
- No employer medical documents are accepted by this version. HR health-data access needs a separate entitlement and private bucket; even top management must not inherit diagnosis access.

## Legal/payroll release blockers (local counsel/HR approval required)

- The Hungarian Labour Code §97 roster publication and change-notice rules (typically 168 hours for original announcement; 96-hour amendment for qualifying unexpected business/operation conditions) must be implemented or manually controlled and signed off before any real publication. This pilot currently displays a manual review prompt **only**; it does not enforce those rules.
- Validate §99, §103–106 working time, breaks and daily/weekly rest as applicable; §115–126 leave and sick-leave logic; §134 records of *actual* working/extra hours, standby and leave. Check individual employment agreements and any relevant collective agreements; no automatic entitlement or payroll calculation is currently available.
- Define controller/processor roles, legal bases, employee privacy notice, data-processing agreement, permissions, retention/deletion schedule, export, access logging, breach response and DPIA determination. No health-data bucket/document feature may be activated before Article 9 and Article 32 requirements and processor arrangements have been assessed.
- Add native EN/HU labels, exact employee+hotel mapping, import dry-run and rollback, scheduled-vs-attendance reconciliation, staff notification/revision and HR workflows before go-live.

## Release decision

Build/ordinary tests passing is **necessary but not sufficient**. Keep PR draft until the migration, authenticated RLS test matrix, authorized test identities, workbook mapping, legal rules, privacy review and mobile UAT pass. Do not change the existing attendance, housekeeping or payroll authority as a shortcut.

Sources: https://njt.hu/jogszabaly/2012-1-00-00 ; https://eur-lex.europa.eu/eli/reg/2016/679/oj ; https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations_en
