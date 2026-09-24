# Housekeeping tenant security: staged production rollout (#353)

**Release state (23 Sep 2026).** The smart planner and next-day application checks are
already merged in #355. The three SQL migrations are isolated in draft #356.
DO NOT deploy #356 or independently apply its migrations until active legacy
cross-tenant records are reconciled. All test fixtures contain synthetic data.

## Known production audit (read-only aggregate from 22 Sep 2026)

The earlier audit counted **724** `room_assignments` rows whose assignee's
`profiles.organization_slug` differs from the assignment's
`organization_slug`: 649 RD Hotels-to-SLNT, 75 test-tenant-to-SLNT.
Their statuses: 617 completed, 102 assigned, **5 in progress**. Separately,
**four** RD Hotels-labeled rows reference rooms in the test organization
(all assigned). These are historical observations, **not current reverified
counts**, and may overlap across the two categories.

## Preflight with an authorized database administrator

1. Back up the affected assignment rows, audit events, photos, timestamps and
   related housekeeping records securely. Never commit exported data or employee
   identifiers to this **public** repository. Record a pre-release row count,
   counts by status and both mismatch categories; compare to the historical
   counts above without assuming they are unchanged.
2. Run the read-only queries below in an authorized database console. Also run
   `supabase/tests/housekeeping_tenant_guard_release_preflight.sql` using
   `psql -X -v ON_ERROR_STOP=1 -f ...` against an authorized, production-equivalent
   snapshot; it must emit `HK_TENANT_PREFLIGHT_OK` before rollout. It fails closed
   when any `assigned`/`in_progress` mismatch falls inside the operational
   window (today, future work, or yesterday carry-over), or when a next-day plan
   has duplicate primary owners. Older mismatch rows are retained as historical
   evidence rather than silently rewritten; the write trigger prevents recurrence. No employee identifiers
   are printed by the preflight. Its GitHub CI tests deliberately fail on
   unresolved synthetic active links and pass after synthetic reconciliation.
   Store any row-level audit reports in a secure internal location accessible
   only to authorized property managers and administrators.
3. For **in-progress and assigned** mismatches, confirm the owning hotel,
   legitimate working organization, real employee identity and intended
   assigned person *with the relevant property manager*. This project models
   one organization per profile: do not switch an employee's entire organization
   to repair one assignment, and do not guess an employee based on matching names.
   Preserve pending photos, instructions and room state when correcting links.
   Keep an immutable before/after audit with author, reason and affected IDs.
4. Preserve completed history and evidence. Agree on the audit and reporting
   treatment of historical mismatches before any update. Do not erase, silently
   merge or recreate completed work.
5. Confirm no active assignment belongs to a foreign worker or foreign room,
   and that a missing room card or unexpected task reassignment will not occur
   when the new restrictive read policies become effective. Recheck *both*
   categories after remediation.
6. Test the three migrations against a **production-equivalent disposable
   database**, not the production project. #356's GitHub Actions PostgreSQL
   fixture proves syntax and representative RLS negative paths, but cannot
   certify the existing ~610 migration history or live schema. The Supabase
   PR preview was previously skipped at the concurrent-preview-branch limit.
7. In staging, with distinct authenticated RD Hotels, SLNT and test-tenant
   manager/housekeeper accounts, verify unauthorized cross-org reads and writes
   fail; legitimate org/property updates, next-day approvals and 08:00 release
   still work. Test a legitimate staff member moving *between properties of one
   organization* according to configured hotel access; a shared employee must
   not silently become a member of another legal tenant. Test that stale PMS
   status, no-shows and incomplete assignments cannot be approved.
8. Verify that the primary-room unique index was **actually created**. Migration
   1 deliberately emits a NOTICE and skips the index when existing duplicate
   primary rows are found; a successful migration alone does not prove the
   uniqueness guard exists.
9. Have authorized owners approve a migration maintenance window, fresh backup,
   explicit rollback and post-deployment checks. Confirm deployment automation
   cannot apply SQL prematurely. During rollout, closely monitor missing
   assigned-room cards, worker task completion and overnight release.
10. Only after live observation and negative checks may the team close #353 and
    describe production tenant isolation as verified.

## Read-only mismatch audit (run in a secure console)

```sql
WITH reviewed AS (
  SELECT a.id, a.organization_slug AS assignment_org, a.status,
         a.room_id, r.organization_slug AS room_org, r.hotel,
         a.assigned_to, p.organization_slug AS worker_org,
         (a.organization_slug IS DISTINCT FROM p.organization_slug) AS worker_mismatch,
         (a.organization_slug IS DISTINCT FROM r.organization_slug) AS room_mismatch
    FROM public.room_assignments a
    LEFT JOIN public.rooms r ON r.id = a.room_id
    LEFT JOIN public.profiles p ON p.id = a.assigned_to
)
SELECT assignment_org, worker_org, room_org, status,
       COUNT(*) FILTER (WHERE worker_mismatch) AS foreign_worker_rows,
       COUNT(*) FILTER (WHERE room_mismatch) AS foreign_room_rows,
       COUNT(*) FILTER (WHERE worker_org IS NULL) AS missing_worker_profiles,
       COUNT(*) FILTER (WHERE room_org IS NULL) AS missing_room_records
  FROM reviewed
 WHERE worker_mismatch OR room_mismatch
 GROUP BY assignment_org, worker_org, room_org, status
 ORDER BY assignment_org, status;
```

For row-level reconciliation, run the same CTE but select `id`, `room_id`,
`hotel`, `assigned_to`, `assignment_org`, `worker_org`, `room_org`,
`status`, filtering `worker_mismatch OR room_mismatch`. Do not paste the
row-level export into issues, PRs, CI logs, chats or other public channels.

After the staged migration, verify the primary index with:

```sql
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'next_day_hk_one_primary_per_room_idx';
```

## Why the source-controlled migrations do not repair old records automatically

The live-assignment trigger rejects **new** foreign room/staff links, and
validates an identity change during UPDATE. It intentionally permits status
updates on an unchanged legacy reference to preserve the possibility of
finishing and reconciling history. The restrictive read policy checks the
**assignment's** organization, so the foreign worker will lose access to
the mislinked active task after deployment; this is precisely why the five
historically in-progress and 102 assigned records must be reviewed *first*.
The four foreign-room records can otherwise continue to have an incorrect
`assignment_org` label visible to that organization's manager; they also
require explicit reconciliation before the security rollout.

## Rollback principles

Do not drop RLS protections automatically in response to a report of a
missing room. Pause rollout, identify the specific mismatch with authorized
personnel, restore the prior state using a reviewed migration and verified
backup only if necessary, and log the incident. A rollback must not silently
reintroduce general cross-organization reads or delete historical work.


## 24 Sep 2026 live read-only re-audit

A fresh aggregate audit confirmed the same 724 worker mismatches and four room
mismatches, but none are dated today or in the future; the latest mismatch date
is 28 May 2026. All 724 worker mismatches point to one currently-SLNT admin
profile, with no same-organization assignment rows for that profile. The foreign
rows span old RD Hotels and test-tenant assignments. Preserve these rows as
historical evidence rather than guessing replacement workers. The release gate
continues to block any mismatch in the operational window (today/future plus
yesterday carry-over).
