# Revenue worker authentication: deployment runbook

**Merge is not deployment. This migration must be deployed BEFORE the secured Edge Functions.**

## Step 1 — Database migration

- Apply supabase/migrations/20261122090000_revenue_cron_vault_worker_auth.sql through the approved Supabase migration pipeline.
- The migration creates a random dedicated 256-bit Vault credential and a service-role-only validation RPC, then adds an x-hotelcare-worker header to three existing jobs without changing their timing, target URLs, or request bodies.
- Verify active cron jobs revenue-automation-scheduler-10min, revenue-previo-sync-hourly, revenue-publish-queue-3min each have x-hotelcare-worker in cron.job.command. Never print Vault secrets or JWTs.
- Confirm execute permissions on public.hotelcare_verify_revenue_cron_token(text) are granted to service_role and not anon/authenticated.

## Step 2 — Edge rollout

- Only AFTER the database migration, deploy revenue-publish-queue, revenue-engine-tick, revenue-autopilot-tick and revenue-pickup-automation together.
- Confirm anonymous POSTs and public apikey-only cron impersonations return 401, even with scheduled:true. Service-role internal handoffs and Vault-backed cron calls must succeed.
- Verify human manager rate changes still use authenticated user/tenant paths. Confirm one publisher lease, queued draft delivery and Previo readback.
- Monitor cron.job_run_details, net HTTP errors, publisher queue backlogs and live revenue pickup cycles.

## Rollback

Old worker code ignores the extra Vault header. Rolling back only the Edge Functions is safe; do not remove the new cron header while new worker code remains deployed. Never re-enable the anonymous scheduled-request bypass.

Unit and isolated PostgreSQL tests are in CI. Database migration and live Edge deployment require separate authorization.