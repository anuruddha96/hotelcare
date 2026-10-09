# PMS refresh queue rollout (RD Hotels + SLNT)

**State:** disabled until explicit staging validation and production cutover. Tracks #568.

## Engine

- The new queue Edge Function verifies user JWTs for manual requests/status and the Vault-backed worker secret for server ticks.
- A PostgreSQL advisory transaction lock plus global unique running-job index serializes all PMS queue claims.
- Automatic jobs start no earlier than 06:00 Europe/Budapest: Memories, Mika, Ottofiori, Gozsdu, then the two active SLNT accounts. Automatic starts remain at least ten minutes apart.
- Manual jobs have priority over pending automatic jobs but cannot interrupt the running job. SLNT needs both account jobs to finish before the UI reports success.
- Attempts, lease expiry, service-role-only claims, fenced completion and retry backoff prevent most duplicate execution. A worker that outlives an expired lease could still be writing rooms; keep execution well below 15 minutes.
- Queue calls the same existing server-side morning reconciliation routine for manual and automatic jobs; this is NOT necessarily equivalent to the old rich browser manual refresh. Parity is a mandatory release gate.
- No production cron jobs are changed by these migrations. Queue settings default to enabled=false; the frontend additionally requires VITE_PMS_REFRESH_QUEUE_ENABLED=true.

## Mandatory release gates

1. Apply additive migrations on staging and verify the service-role-only grants, permissions, claim uniqueness and retry logic.
2. Deploy both queue and morning Edge Functions on staging. Test unauthorized users, cross-tenant hotel IDs, invalid worker secrets, and active SLNT account mapping.
3. Reproduce Ottofiori 9 October (18 misleading checkout / 3 daily versus 12 real checkout / 9 daily). Compare all physical rooms for server queue versus legacy manual refresh. Do not enable until notes, occupancy, assignments, and RTC parity is verified.
4. Identify and fix the Ottofiori checkout database trigger drift from incidental pms_metadata writes; verify rooms 103, 203, 402, 404, 405, 406 remain daily when Previo confirms.
5. Test Gozsdu same-day arrivals, no-shows, SLNT inactive-room exclusions, manual overrides, in-progress housekeeping, and tenant scope.
6. Test concurrent manual requests, two overlapping worker ticks, expired leases, retry exhaustion, automatic 10-minute starts and Budapest DST.
7. Prepare a failed-job alert and verified per-room before/after audit. Do not show green freshness from checkout-poll history.
8. Configure a once-per-minute queue worker cron using Vault x-worker-secret, without storing service-role keys in the database job.
9. Cut over in one controlled maintenance window: disable old morning cron, allow active old job to finish, enable queue setting, enable queue cron, release frontend flag. The old endpoint has an additional queue-enabled skip guard.
10. For rollback, disable queue cron and queue setting before restoring old cron and turning off the browser flag. Preserve job history.

## Read-only checks

    SELECT enabled FROM public.pms_refresh_queue_settings WHERE id=true;
    SELECT business_date,target_key,source,status,requested_at,started_at,finished_at,attempts
    FROM public.pms_refresh_jobs ORDER BY requested_at DESC LIMIT 50;
    SELECT count(*) FROM public.pms_refresh_jobs WHERE status='running';

**This implementation is infrastructure, not a claim of completed rollout.**