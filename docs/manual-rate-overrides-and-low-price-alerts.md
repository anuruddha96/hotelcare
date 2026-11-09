# Permanent manual occupancy rates and low-price notifications

## Scope

This change is **staged only**. Do not merge/deploy the frontend, edge workers,
or migration separately. All three layers are required for durable protection.
Any existing `41 prices not applied` queue discrepancy is a separate Previo
diagnostic and is not proven fixed by this branch.

### Guest pricing

- Staff-entered exact prices, including first-time room initialization, have a minimum **€1** increase between consecutive
  guest counts. Examples: €100 → €101 allowed, €100 → €100 rejected.
  No configured €10 occupancy supplement is imposed on staff's explicit prices.
- Automatic repricing continues to use the configured per-hotel supplement.
- For SLNT (HUF), the manual editor and first-price setup show HUF (never an
  ambiguously labeled EUR amount), and the minimum step uses the configured EUR-to-HUF
  conversion rate. At the currently configured 365 HUF/EUR, the minimum is
  **365 HUF per additional guest**, not 1 HUF.
- A manager-authored price is recorded **after Previo confirms it** in
  `revenue_manual_rate_overrides` and protected per hotel, date, room ID and
  guest count until another manager explicitly changes it.
- The database blocks later automatic drafts targeting protected cells.
  The final EQC writer must read protected prices before writing Previo's entire
  occupancy ladder. If the outgoing ladder conflicts, it refuses that group
  rather than modifying any protected cell. Never rewrite a protected price to
  make an automated ladder look correct.
- Automatically generated sibling prices are not classified as manager-entered
  cells, even when they were filled to keep a manager's new rate valid.
- Existing confirmed manager rates for future dates are backfilled on migration.
  Staff edits that fail or never confirm in Previo do not become permanent locks.
- This protects HotelCare-origin manager edits against **HotelCare automation**,
  not against a person manually altering the rates in Previo itself.

### Email thresholds

- RD Hotels properties: any published rate below **€40**, and existing extreme
  price anomalies, to `info@rdhotels.hu`, `anu@rdhotels.hu`, and eligible
  property/organization administrators.
- SLNT: published rate **strictly below €15**, to `zsolt@slnt.hu`,
  `csaba@slnt.hu`, and `anuruddha.dharmasena@gmail.com`.
  Those addresses were confirmed via connected Contacts because the HotelCare
  profile for Csaba uses a non-deliverable `.local` placeholder.
- SLNT stored rates are HUF. At the live 365 HUF/EUR setting, **below
  5,475 HUF** triggers the low-price email; equality does not.
- Safety alerts are never price edits. No auto-increase/repair follows a
  low-price alert. Retry unnotified rows when email delivery fails. The worker
  requires a private header and a configured Resend sender.

## Controlled rollout checklist

1. **Review and run tests** for first-time initialization, price safety,
   whole-occupancy Previo writes, and alert worker. Run the project's existing
   frontend and edge-function CI plus SQL migration checks.
2. **Apply** `20261109082500_durable_staff_rate_overrides.sql` on a staging
   database, verify backfill and check for pending/manual-automated race cases.
3. **Provision the same random high-entropy secret** in both Supabase Edge
   environment as `REVENUE_RATE_ALERT_WORKER_SECRET` and Supabase Vault as
   `hotelcare_revenue_rate_alert_worker_secret`. Never commit its value.
   Verify `RESEND_API_KEY` and the organization email settings are enabled,
   with a verified sending domain.
4. Deploy `revenue-enqueue-rates`, `revenue-push-drafts`, and
   `revenue-rate-alerts`, with matching `supabase/config.toml`.
5. Only after those steps, configure the 30-minute backup pg_cron job using
   the SQL below. This is **not currently active**.
6. Send a manual one-time authenticated call using the worker secret to
   `/functions/v1/revenue-rate-alerts` and check the result's `summary`.
   Confirm actual inbox delivery to all required recipients before declaring
   the notifications live. For a full end-to-end rate test, use an isolated
   staging hotel/Previo test rate plan; do not change production prices merely
   to test alerts.
7. Verify one manager €100/€101 test ladder, a subsequent automated job, a
   later auto-heal pass, and the confirmed Previo read-back. Then repeat for
   an HUF room. Inspect protected rate cells and queue conflict messages.

### Schedule SQL (run only after provisioning secret, deployment and testing)

```sql
select cron.schedule(
  'hotelcare-revenue-rate-alerts-30m',
  '*/30 * * * *',
  $task$
    select net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/revenue-rate-alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'hotelcare_revenue_rate_alert_worker_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $task$
);
```

Monitor `cron.job_run_details`, function logs, `revenue_rate_alerts.notified_at`,
and real Resend deliverability. If a scheduled job already has that name,
review and reschedule instead of silently creating a duplicate. The backend
scanner covers the coming 365 days; historical stay dates are read-only.

## Release gates

Do not declare success until rate validation tests, migration checks, Previo
reconciliation, alert job deployment, and verified inbox delivery pass.
