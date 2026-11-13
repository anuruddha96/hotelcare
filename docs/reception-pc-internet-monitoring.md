# HotelCare — Reception PC Internet Monitoring (RD Hotels pilot)

## What it does

An authorized hotel manager opens **Internet Monitoring** on the HotelCare dashboard, selects the property and enables monitoring on that browser/computer. A 256-bit random device credential is stored locally in that browser. Heartbeats go to the `network-monitor` Supabase Edge Function every **30 seconds**, even when reception signs out or a different employee signs in (provided the HotelCare page stays open).

The cloud watchdog checks every **30 seconds**. Once a registered monitor has been silent for **120 seconds**, it records a *Possible Internet Outage / Device Unreachable* incident and emails **anu@rdhotels.hu**. A new heartbeat closes the incident and sends a recovery email.

Notifications are **email-only**. No receptionist popups, and no AI, SMS, router API or extra equipment. All network requests and incident calculations run on HotelCare's existing Supabase infrastructure.

**Limits:** A browser cannot tell a loss of internet from a sleeping/turned-off PC, a closed HotelCare tab or throttled background activity. A successful heartbeat proves the PC can reach the HotelCare cloud, but not that every guest Wi-Fi access point works. These are **possible** outages, never confirmed ISP outages. Monitoring stops when HotelCare is closed.

## Files

- `src/components/dashboard/InternetMonitoringPanel.tsx` — manager setup, list, enable/disable and history
- `src/components/system/NetworkMonitorHeartbeat.tsx` — background client heartbeat, mounted outside the authenticated operational shell
- `src/lib/networkMonitorClient.ts` — local device credential and connectivity calls
- `supabase/functions/network-monitor/index.ts` — token-protected heartbeat; authenticated, scoped manager actions
- `supabase/functions/network-monitor-worker/index.ts` — cloud incident lifecycle and email delivery/retry
- `supabase/migrations/20261113104500_reception_internet_monitoring.sql` — tables, RLS, worker-only functions, 30-second cron job

## Deployment steps (not performed by opening this PR)

1. Review and merge the PR after CI and a security review. Confirm migration order and that `pg_cron`, `pg_net` and Supabase Vault are available.
2. Apply the migration to the intended HotelCare Supabase project `pcmszqqklkolvvlabohq`. It creates the cron job, but the job makes **no request** until its Vault secret exists.
3. Deploy `network-monitor` and `network-monitor-worker` Edge Functions with `verify_jwt = false`; both enforce their own authentication. Never expose `SUPABASE_SERVICE_ROLE_KEY` to a browser.
4. Generate a fresh high-entropy string and configure **the same value** in two protected places:
   - Supabase Edge secret `NETWORK_MONITOR_WORKER_SECRET`
   - Supabase Vault secret named `network_monitor_worker_secret` (via Vault dashboard or privileged `vault.create_secret`). Do not commit the secret, include it in screenshots, or expose it in client code.
5. Confirm Resend's `RESEND_API_KEY`, a verified sender domain, and enabled transactional email in RD Hotels Email Settings. Test a **real** message reaching `anu@rdhotels.hu`.
6. Open HotelCare as an RD Hotels manager on the reception PC, go to **Internet Monitoring**, choose the correct hotel, give the computer a distinct name, then enable monitoring.
7. Verify the timestamp updates after 30 seconds and the cron job runs. Test real disconnection, recovery and the generated emails from an isolated pilot PC.

### Operational verification SQL

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'hotelcare-network-monitor-watchdog';

select id, organization_slug, hotel_id, device_label, enabled, last_heartbeat_at
from public.network_monitors order by created_at desc limit 20;

select m.hotel_id, m.device_label, i.detected_at, i.recovered_at,
       a.kind, a.status, a.attempts, a.last_error, a.sent_at
from public.network_monitor_alerts a
join public.network_monitor_incidents i on i.id = a.incident_id
join public.network_monitors m on m.id = i.monitor_id
order by a.created_at desc limit 20;
```

Queries above require appropriate service/admin database access. Never expose token hashes in the manager UI.

## Security boundaries

- Pilot is **RD Hotels only** and the recipient is fixed at `anu@rdhotels.hu`. Never send another tenant's incidents to this address.
- Backend checks the Supabase Auth JWT and manager role for register/list/disable; an ordinary employee cannot register or disable monitors.
- Backend verifies the selected canonical hotel and its organization. Non-executive managers are restricted to their assigned hotel.
- Heartbeat credentials are limited to updating the **single** registered device's last contact time. A credential cannot list, enroll or disable monitors.
- Device credentials are randomly generated and SHA-256 hashes are stored server-side. Client localStorage holds the raw device credential. This cannot protect against malicious same-origin script injection; preserve existing XSS protections.
- All monitoring tables have RLS enabled and no direct anon/authenticated access. Worker RPCs are execute-only for service_role (not PUBLIC), using SECURITY INVOKER.
- Status emails use the existing HotelCare email service and the organization's transactional-email setting.
- Concurrent workers claim alert jobs using row locks; transient mail failures retry after two minutes. Email delivery is *at least once* on rare failures between send and database confirmation.

## Test checklist

- [ ] RD Hotels manager can enroll one reception browser; manager at another hotel cannot register this hotel's monitor.
- [ ] Non-manager cannot register, list or disable; other organizations are denied.
- [ ] Heartbeats continue when switching reception users and on sign-in page, but **not** after the browser closes.
- [ ] Registered PC loses Wi-Fi entirely: watchdog emails admin after approximately 120–150 seconds.
- [ ] PC keeps Wi-Fi but upstream internet goes down: same result.
- [ ] A closed tab or sleeping PC generates **possible outage / device unavailable**, not a confirmed Wi-Fi failure.
- [ ] Reconnecting results in one recovery incident and email, with timestamps in Budapest time.
- [ ] Disabling a monitor stops new incident and email creation.
- [ ] Repeated watchdog ticks do not send one new email per tick.
- [ ] Failing Resend delivery records error and retries without losing the incident.
- [ ] Cross-tenant monitor data cannot be read or emailed to RD Hotels.

## Known limitations and future enhancement

Browser timers may be throttled when hidden; a dedicated native agent or router integration would improve accuracy without changing the cloud alert design. The currently configured computer's browser profile must persist (do not clear site storage); a private/incognito window is not appropriate. If a workstation is fully powered off, the alert is a device-unreachable warning, not a positive diagnosis of hotel connectivity.
