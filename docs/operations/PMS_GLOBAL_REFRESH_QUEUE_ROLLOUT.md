# Global Previo full PMS refresh queue — rollout and rollback

## Incident / evidence (9 October 2026, Budapest time)
- Ottofiori UI 07:09 displayed 18 checkout / 3 daily; manual refresh changed it to 12 checkout / 9 daily.
- Production `pms_morning_sync_runs` showed successful automatic runs at 06:00 Memories (71 rooms), 06:10 Mika (33), **06:20 Ottofiori (21 rooms, already computed 12 checkout / 9 daily)**, 06:30 Gozsdu (82), 06:40 SLNT PMS 1 (9), and 06:50 SLNT PMS 2 (52). This means the cron is running; the visible discrepancy may stem from later conflicting writes or stale UI. Do not claim the scheduler missed 06:20.
- `LiveSyncContext` previously treated the newest `pms_sync_history` row, including frequent `checkouts_poll` rows, as completed full PMS, incorrectly showing “Up to date.” The UI now filters `sync_type='rooms_refresh'`.

## Deploy in this exact order
1. Review security/RLS, build and Edge Deno type checks in PR. Ensure new tests green.
2. Apply `20261009102000_global_pms_refresh_queue.sql` to the HotelCare Supabase project.
3. Deploy **both** `hotelcare-pms-morning-sequence` (now supports queue-owned targeted work) and `pms-refresh-queue-worker` with `verify_jwt=false` and the existing Vault worker-secret check. NEVER expose the secret to browsers. Verify unauthorized requests receive 401.
4. Check `pms_refresh_queue` table, `enqueue_pms_manual_refresh` RPC and an authorized staged manual request. Ensure worker executes and queue row finishes, and that an unrelated tenant cannot enqueue a property.
5. Confirm the last completed `pms_morning_sync_runs` for the current day, so cutover doesn't duplicate completed automatic jobs.
6. Only **after both functions and database are verified**, in a single transaction, unschedule old 10-min morning cron and create a 1-min queue driver with the existing worker secret:
   ```sql
   begin;
   select cron.unschedule('hotelcare-pms-morning-sequence');
   select cron.schedule('hotelcare-pms-global-queue-1min','* * * * *', $job$
     select net.http_post(
       url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/pms-refresh-queue-worker',
       headers := jsonb_build_object('Content-Type','application/json',
                                   'x-worker-secret',public.get_housekeeping_release_worker_secret()),
       body := jsonb_build_object('trigger','cron','at',now()),
       timeout_milliseconds := 30000
     );
   $job$);
   commit;
   ```
   This is a *runbook only* and intentionally **not** an auto-applied migration: changing the schedule before deploying Edge workers would stop automatic refreshes.
7. Merge/release the frontend changes, ensure all buttons enqueue instead of running a direct full sync, and verify mobile feedback.
8. Verify two days (including Europe/Budapest DST if relevant). Audit room states, assignment types, freshness badge, failed attempts and `pms_sync_history` source. The first auto run must start at/after 06:00 local, next auto start at least 10 minutes later, with manual jobs overtaking only waiting automatics.

## Operational safeguards
- Do not run multiple full refreshes concurrently across any RD Hotels or SLNT target.
- Manual requests run first when a current full sync finishes; waiting auto jobs retain their order and 10-minute minimum spacing.
- Queue claims are transactional and leased. A timed-out claim fails visibly for operator review; it does not silently retry a possibly half-written refresh.
- Scheduled hotel list is the four approved active RD Previo properties, plus active SLNT account records. Inactive SLNT room exclusions remain delegated to the existing SLNT worker.
- Full sync success requires completed server reconciliation; five-minute lightweight checkout polls remain separate, and cannot set the “full PMS up to date” badge.
- No auto activation/production change from merely merging code; the cutover is explicit and reversible.

## Rollback
If the new driver fails, in one transaction unschedule `hotelcare-pms-global-queue-1min` and restore the original `hotelcare-pms-morning-sequence` definition/schedule `*/10 4-8 * * *` (UTC) with the original Vault worker-secret header. Before rollback, inspect any running global queue row; do not start two concurrent full syncs. Roll back the frontend controls to the original manual refresh path only after the queue has drained. Do not drop queue audit records.
