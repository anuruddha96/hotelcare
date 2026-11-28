# Supabase migration-history reconciliation

The GitHub migration filename timestamp is the canonical version for future
deployments. Applying SQL through an API that assigns a new timestamp can
produce a different remote version for identical SQL.

## Read-only audit

Use a private PostgreSQL connection profile for the intended project (verify
the project reference before connecting). The connection needs read access to
the migration ledger and the installed pgcrypto extension. Use a protected
PGSERVICE/PGPASSFILE or normal PostgreSQL environment; never put credentials
in a command, report, repository, or CI log.

```sh
python3 scripts/audit_migration_history.py --report /tmp/hotelcare-migration-audit.json
python3 -m unittest discover -s scripts/tests -p test_audit_migration_history.py
```

The audit uses a read-only transaction. It compares Git blob hashes with stored
migration SQL (allowing only terminal LF differences), does not export SQL
bodies, and never modifies a database. A unique content match requires one
remote-only version and one local-only version with no competing candidates.
A matching timestamp alone is not proof of matching content. The exit code is
nonzero for any version drift or unverified common version. Treat the report as
private; it is not an executable repair manifest.

## Reconciliation gate

1. Coordinate a single database deployment owner and pause concurrent
   migration writes for the repair window. Capture an access-controlled backup
   of the complete migration ledger, plus a verified database recovery point.
2. Run the audit against the exact Git revision planned for deployment. Review
   one-to-one content matches and investigate all unresolved entries, including
   duplicate SQL, manually edited SQL, missing statements, split migrations and
   actual pending migrations. Never treat a name match as proof of deployment.
3. Validate historical ordering and actual schema state on an isolated database
   before preparing a reviewed version-mapping and ledger repair. Preserve
   original history and SQL for audit. Use the supported Supabase migration
   repair mechanism, not a bulk schema replay.
4. Only after all ambiguous entries are classified and the mapping rehearsed,
   perform the reviewed history reconciliation in production. Run the audit
   again, check the migration deployment dry run for only explicitly approved
   pending SQL, then verify Supabase deployment checks and application health.
5. For future releases use a single canonical filename/version, the normal
   migration deployment workflow and post-deployment verification. If a
   timestamp-generating API is unavoidable, stop and reconcile the generated
   version before releasing additional migrations.

Do not run a remote database reset, force a historical replay, create empty
placeholder migrations, or mark unknown SQL applied to make CI green.

Official guidance: https://supabase.com/docs/guides/deployment/database-migrations
