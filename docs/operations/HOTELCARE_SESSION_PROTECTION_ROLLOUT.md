# HotelCare 30-minute idle suspension & obsolete-browser cutoff

## Guarantees

- **After 30 minutes of no trusted interaction** (pointer down, key, touch or
  scrolling), every authenticated management/housekeeping/reception screen
  unmounts. Polling intervals and Supabase Realtime channels owned by those
  screens are cleaned up by React. A sticky refresh dialog remains.
- A user click on **Refresh HotelCare** reloads the exact current tenant,
  hotel, route and query parameters. The existing Supabase auth session remains.
- Static hosting provides /hotelcare-release.json. New clients poll it every
  5 minutes without any database calls. A new release shows a refresh control;
  after a 5-minute grace window, the old tree is suspended. Inactive/hidden
  clients suspend immediately if an update is detected.
- **No client-side change can stop already-running legacy JS bundles.** The
  disabled-by-default server gate is the necessary remote enforcement layer.

## Deployment sequence (must not be skipped)

1. Merge the PR once CI passes, and publish the updated frontend at
   https://my.hotelcare.app. Check that /hotelcare-release.json returns JSON
   with the published buildId (not HTML) and does not remain cached. Check the
   build script includes a hotelcare/<timestamp> marker in the existing x-client-info\n   header on Data API requests.
2. Deploy migration 20261020093000_hotelcare_stale_browser_gate.sql to the
   HotelCare Supabase project (pcmszqqklkolvvlabohq). The setting
   enforce_stale_clients is initially FALSE; applying the migration **must
   not revoke access**.
3. Test with one current manager browser at Gozsdu and Memories:
   room board, housekeeping approval, room service type, RTC, PMS refresh,
   rate editor and notices. Leave an isolated test tab idle for 30 minutes
   and verify its room/PMS queries and Realtime subscriptions stop.
4. As super admin, navigate to /rdhotels/admin/session-protection.
   Confirm the current build timestamp, and only then choose
   **Enable outdated-browser cutoff**. Old HotelCare browsers identified by
   my.hotelcare.app Referer that still access the expensive rooms/PMS metadata
   Data API endpoints will receive HTTP 428 until refreshed.
5. Compare 5-minute API logs for /rest/v1/rooms, /rest/v1/pms_accounts,
   /rest/v1/pms_configurations, and corresponding pg_stat_statements query ID
   7439767971855970069. Check overall CPU, error rate, and any new warnings.
   Use a full business day of monitoring, including overnight.

## Administrators: rollback

At /rdhotels/admin/session-protection click **Disable cutoff immediately**.
The 30-minute browser idle protection remains independent.

If admin UI is unreachable, a database administrator can run:

```sql
UPDATE public.hotelcare_client_policy
SET enforce_stale_clients = false, updated_at = now()
WHERE id = 'hotelcare';
```

For a complete server hook rollback:

```sql
ALTER ROLE authenticator RESET pgrst.db_pre_request;
NOTIFY pgrst, 'reload config';
```

## Boundaries

The PostgREST pre-request hook is limited to signed-in GETs on the three
identified expensive tables originating from https://my.hotelcare.app.
It does not intercept database-to-database operations, server-driven
PMS/revenue automation, authenticated writes, public guest forms, Auth,
Realtime or Storage. Session version headers are not security credentials;
real authorization stays enforced through existing JWTs and RLS.

The admin cutoff is not a per-user revocation UI. It enforces a
minimum browser build for all matching requests, preventing stale
frontend bundles from performing high-volume room/PMS reads. The version
minimum can be raised on future deployments using
**Require this newer version**.

## QA checklist

- [ ] New manager remains functional for 29 minutes without interaction.
- [ ] At 30 minutes, room board disappears and refresh-only dialog appears.
- [ ] Moving the cursor or auto-received Realtime events cannot unpause it.
- [ ] Refreshed browser returns to the same hotel/route and retains login.
- [ ] Active users see release notice and 5-minute grace before cutoff.
- [ ] Offline release discovery does not lock out a functioning session.
- [ ] Server cutoff disabled by default; ordinary old-client access works.
- [ ] Enabling the gate denies stale matching GETs with 428, not current ones.
- [ ] Immediately disabling the gate restores old-client REST reads.
- [ ] Scheduled server-side PMS sync and rates continue unaffected.
