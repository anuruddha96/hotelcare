# Production-schema acceptance gate (review item 12)

This workflow uses Claude's 2026-11-24 table-only schema snapshot with exact production table definitions, constraints and indexes. It is **not** a full live database clone: original general PMS helpers and pre-existing authority read policies are not exported. Replayed NTAK migration functions, policies, triggers and financial core are real code; the explicitly named helper doubles model only synthetic users and hotel access. Passing this gate does not establish live RLS/ACL equivalence or authority certification.

## Files and ownership

- `ntak-production-baseline.sql`: Claude-owned snapshot, never rewritten by the test.
- `ntak-production-migrations.txt`: Claude-owned ordered migrations not materialized in the snapshot (including those deployed after the snapshot date).
- `ntak-production-deployed-migrations.txt`: dependency-ordered replay of already materialized migrations.
- `ntak-production-helpers.sql`: exact-signature doubles for absent general PMS helpers, pre-existing scoped read policy doubles, no-op push and scheduler.
- `ntak-production-regression.sql`: transactional synthetic tests; no production rows.
- `scripts/render_ntak_production_replay.py`: test-only replay projection. Skips duplicate already-materialized table creation and the named resend UNIQUE already in snapshot, skips the four empty-database financial backfills, restores the two omitted CHECK constraints directly from source ASTs. It does not drop or loosen any baseline constraint or modify an original migration.

## Execution

CI starts PostgreSQL 17 on localhost, loads the unmodified snapshot and helper doubles, reconstructs deployed migration code, applies Claude's ordered post-snapshot manifest verbatim, and requires the final regression to pass. Immediately after the original Phase 8 migration the regression must reproduce its NULL-organization posting failure; after the corrective migration it must succeed. Synthetic tests exercise all three posting triggers, native manager-only rules and mixed financial balance, room status compatibility and overlap constraint, historical-date denial, scoped guest RLS, and the restored country/category constraints. Tests for fixes not yet present in the post-snapshot manifest cannot establish their production readiness.

No production connections, credentials, live endpoint calls, notifications, authority messages, or scheduled jobs. A missing dependency or failed assertion must fail CI. Do not make the gate green by weakening constraints or stubbing the code under test. Claude maintains the baseline and post-snapshot manifest.
