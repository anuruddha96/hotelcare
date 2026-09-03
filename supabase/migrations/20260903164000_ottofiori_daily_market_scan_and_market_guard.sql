-- Hotel Ottofiori: make every configured competitor a daily near-term market source.
update public.competitor_properties
set scan_tier = 1
where hotel_id = 'ottofiori'
  and active = true;

-- Use market evidence as a guardrail rather than blindly copying the market.
-- Two fresh comparables are enough to create a signal; soft dates may not be
-- raised materially above market, while strong/high-occupancy dates retain a
-- reasonable event/scarcity premium. One pickup alone must not trigger a rise.
update public.revenue_pickup_automation_rules
set raise_on_any_pickup = false,
    market_ceiling_multiple = 1.15,
    market_validation = coalesce(market_validation, '{}'::jsonb)
      || jsonb_build_object(
           'min_competitors', 2,
           'max_age_hours', 30,
           'median_cap_low_occ_pct', 110,
           'median_cap_high_occ_pct', 125
         )
where hotel_id = 'ottofiori';

-- Dedicated 06:00 Europe/Budapest rolling market scan. pg_cron itself is GMT,
-- so run at both possible UTC offsets and let the local-time predicate execute
-- only the occurrence that is exactly 06:00 in Budapest (DST-safe).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ottofiori-competitor-rate-scan-6am') then
    perform cron.unschedule('ottofiori-competitor-rate-scan-6am');
  end if;
end $$;

select cron.schedule(
  'ottofiori-competitor-rate-scan-6am',
  '0 4,5 * * *',
  $cron$
    select net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/competitor-rate-scan',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{"scheduled":true,"hotelId":"ottofiori","days":30}'::jsonb
    )
    where extract(hour from timezone('Europe/Budapest', now())) = 6;
  $cron$
);