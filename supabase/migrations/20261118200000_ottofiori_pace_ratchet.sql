-- Pace ratchet pricing policy — database side.
--
-- Additive only: one new settings column, four small tables, two functions
-- and two scheduled jobs. Nothing here changes a price or an existing rule.
-- The policy stays OFF until revenue_pace_policy_set_mode() is called.
--
-- Applied to production through the Supabase MCP on 2026-11-18 and recorded
-- here so the repository stays the source of truth.

-- 1. Policy settings live on the hotel's existing automation rule. Defaults and
--    safe ranges are in supabase/functions/_shared/engineV2PaceRatchet.ts; an
--    empty object means "off, all defaults".
alter table public.revenue_pickup_automation_rules
  add column if not exists pace_policy jsonb not null default '{}'::jsonb;

comment on column public.revenue_pickup_automation_rules.pace_policy is
  'Pace ratchet policy: mode (off|shadow|live), sister_hotels, supervised_until and numeric settings. Read through resolvePaceSettings(), which clamps every value.';

-- 2. Date tiers: a manager's tag, or a Peak candidate waiting for review.
create table if not exists public.revenue_date_tiers (
  hotel_id text not null,
  organization_slug text not null default '',
  stay_date date not null,
  tier text not null check (tier in ('normal', 'high', 'peak')),
  source text not null default 'manual' check (source in ('manual', 'event', 'sister_prices')),
  status text not null default 'confirmed' check (status in ('confirmed', 'needs_review', 'dismissed')),
  reason text,
  event_title text,
  ceiling_eur numeric check (ceiling_eur is null or (ceiling_eur >= 100 and ceiling_eur <= 3000)),
  created_by uuid,
  created_by_name text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (hotel_id, stay_date)
);
create index if not exists revenue_date_tiers_review_idx
  on public.revenue_date_tiers (hotel_id, status, stay_date);

-- 3. Seasonal base: what the date is worth in list-price terms, derived from
--    the sister hotels' published prices scaled to this hotel's level.
create table if not exists public.revenue_seasonal_base (
  hotel_id text not null,
  stay_date date not null,
  base_eur numeric not null check (base_eur > 0),
  special_ratio numeric,
  sister_count integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (hotel_id, stay_date)
);

-- 4. The list price at which a stay date last took a booking.
create table if not exists public.revenue_converting_prices (
  hotel_id text not null,
  stay_date date not null,
  price_eur numeric not null check (price_eur > 0),
  converted_at timestamptz not null,
  bookings integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (hotel_id, stay_date)
);

-- 5. What the policy decided (shadow) or did (live), next to the live engine.
create table if not exists public.revenue_pace_policy_log (
  id bigint generated always as identity primary key,
  run_id uuid,
  hotel_id text not null,
  stay_date date not null,
  days_out integer not null,
  mode text not null check (mode in ('shadow', 'live')),
  tier text,
  tier_source text,
  zone text,
  current_price integer,
  base_price integer,
  converting_price integer,
  occupancy_pct numeric,
  rooms_remaining integer,
  expected_pct numeric,
  pace_gap numeric,
  pressure numeric,
  floor_ref integer,
  ceiling_ref integer,
  live_direction text,
  live_movement integer,
  live_reason text,
  policy_direction text not null,
  policy_movement integer not null default 0,
  policy_target integer,
  policy_reason text,
  policy_intent text,
  policy_raw integer,
  policy_detail text,
  cells integer,
  created_at timestamptz not null default now()
);
create index if not exists revenue_pace_policy_log_hotel_created_idx
  on public.revenue_pace_policy_log (hotel_id, created_at desc);
create index if not exists revenue_pace_policy_log_hotel_date_idx
  on public.revenue_pace_policy_log (hotel_id, stay_date, created_at desc);

-- Row level security: revenue users read their own hotels; only the server writes.
alter table public.revenue_date_tiers enable row level security;
alter table public.revenue_seasonal_base enable row level security;
alter table public.revenue_converting_prices enable row level security;
alter table public.revenue_pace_policy_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['revenue_date_tiers', 'revenue_seasonal_base', 'revenue_converting_prices', 'revenue_pace_policy_log'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_revenue_user((select auth.uid())) and public.user_can_access_hotel((select auth.uid()), hotel_id))',
      t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 6. Seasonal base refresh.
--    level(h)    = this hotel's realised ADR ÷ sister h's realised ADR over the
--                  nights both sold in the last 90 days (clamped 0.6–1.4);
--    offer(h, d) = sister h's cheapest published two-guest price for date d;
--    base(d)     = median over sisters of offer(h, d) × level(h);
--    special(d)  = median over sisters of offer(h, d) ÷ that sister's median
--                  offer for the same month and weekend/weekday.
--    A date needs at least two sisters; otherwise it gets no base.
create or replace function public.revenue_refresh_seasonal_base(
  p_hotel_id text,
  p_sisters text[],
  p_days integer default 370
) returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '90s'
as $function$
declare
  v_today date := (now() at time zone 'Europe/Budapest')::date;
  v_rows integer := 0;
begin
  if p_hotel_id is null or p_sisters is null or cardinality(p_sisters) = 0 then
    return 0;
  end if;

  with latest as (
    select distinct on (d.hotel_id, d.stay_date) d.hotel_id, d.stay_date, d.rooms_sold, d.revenue_eur
      from public.revenue_daily_snapshots d
     where d.hotel_id = any(p_sisters || p_hotel_id)
       and d.stay_date between v_today - 90 and v_today - 1
       and d.rooms_sold > 0 and d.revenue_eur > 0
     order by d.hotel_id, d.stay_date, d.captured_at desc
  ),
  own as (select stay_date, rooms_sold, revenue_eur from latest where hotel_id = p_hotel_id),
  level as (
    select s.hotel_id,
           least(1.4, greatest(0.6,
             (sum(o.revenue_eur) / nullif(sum(o.rooms_sold), 0))
             / nullif(sum(s.revenue_eur) / nullif(sum(s.rooms_sold), 0), 0))) as ratio,
           count(*) as nights
      from latest s
      join own o on o.stay_date = s.stay_date
     where s.hotel_id <> p_hotel_id
     group by s.hotel_id
    having count(*) >= 30
  ),
  cells as (
    select distinct on (r.hotel_id, r.stay_date, r.obk_id) r.hotel_id, r.stay_date, r.obk_id, r.price
      from public.revenue_room_type_rates r
      join public.previo_rate_plan_mapping pm
        on pm.hotel_id = r.hotel_id
       and pm.previo_room_type_id = r.obk_id
       and pm.previo_rate_plan_id = r.rate_plan_id
     where r.hotel_id = any(p_sisters)
       and r.stay_date between v_today and v_today + greatest(30, least(400, coalesce(p_days, 370)))
       and r.occupancy = 2 and r.price > 0 and r.currency = 'EUR'
     order by r.hotel_id, r.stay_date, r.obk_id, r.captured_at desc
  ),
  offer as (
    select c.hotel_id, c.stay_date, min(c.price) as ref
      from cells c
      join level l on l.hotel_id = c.hotel_id
     group by c.hotel_id, c.stay_date
  ),
  normal as (
    select hotel_id, date_trunc('month', stay_date)::date as m,
           (extract(isodow from stay_date) in (5, 6)) as weekend,
           percentile_cont(0.5) within group (order by ref) as med
      from offer
     group by 1, 2, 3
  ),
  scored as (
    select o.stay_date, o.hotel_id, o.ref, o.ref * l.ratio as scaled, o.ref / nullif(n.med, 0) as special
      from offer o
      join level l on l.hotel_id = o.hotel_id
      join normal n on n.hotel_id = o.hotel_id
       and n.m = date_trunc('month', o.stay_date)::date
       and n.weekend = (extract(isodow from o.stay_date) in (5, 6))
  ),
  agg as (
    select stay_date,
           round((percentile_cont(0.5) within group (order by scaled))::numeric) as base_eur,
           round((percentile_cont(0.5) within group (order by special))::numeric, 2) as special_ratio,
           count(*)::int as sister_count,
           jsonb_object_agg(hotel_id, jsonb_build_object('offer', round(ref), 'scaled', round(scaled))) as detail
      from scored
     group by stay_date
    having count(*) >= 2
  ),
  upserted as (
    insert into public.revenue_seasonal_base as b
      (hotel_id, stay_date, base_eur, special_ratio, sister_count, detail, computed_at)
    select p_hotel_id, stay_date, base_eur, special_ratio, sister_count, detail, now()
      from agg
     where base_eur > 0
    on conflict (hotel_id, stay_date) do update
       set base_eur = excluded.base_eur,
           special_ratio = excluded.special_ratio,
           sister_count = excluded.sister_count,
           detail = excluded.detail,
           computed_at = excluded.computed_at
    returning 1
  )
  select count(*) into v_rows from upserted;

  delete from public.revenue_seasonal_base where hotel_id = p_hotel_id and stay_date < v_today;
  -- A date that lost its second sister is no longer supported by evidence.
  delete from public.revenue_seasonal_base
   where hotel_id = p_hotel_id and computed_at < now() - interval '36 hours';
  return v_rows;
end;
$function$;

revoke all on function public.revenue_refresh_seasonal_base(text, text[], integer) from public, anon, authenticated;
grant execute on function public.revenue_refresh_seasonal_base(text, text[], integer) to service_role;

-- 7. One audited switch for the policy. Going live widens the daily euro caps
--    the database trigger enforces (the policy's own percentage caps do the
--    fine control), raises the cuts-per-day limit for arrival-day discovery,
--    starts a 48-hour half-step period and stops the four-hourly AI price
--    writer. Leaving live restores every one of those exactly.
create or replace function public.revenue_pace_policy_set_mode(
  p_hotel_id text,
  p_mode text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rule public.revenue_pickup_automation_rules%rowtype;
  v_policy jsonb;
  v_prev_mode text;
  v_windows jsonb;
  v_markdowns integer;
  v_ai_job bigint;
begin
  if p_mode not in ('off', 'shadow', 'live') then
    raise exception 'mode must be off, shadow or live';
  end if;
  select * into v_rule
    from public.revenue_pickup_automation_rules
   where hotel_id = p_hotel_id and is_enabled is true
   order by updated_at desc nulls last
   limit 1
   for update;
  if not found then
    raise exception 'No enabled automation rule for %', p_hotel_id;
  end if;
  if coalesce(v_rule.engine_version, 1) < 2 then
    raise exception 'The pace ratchet needs engine version 2';
  end if;

  v_policy := coalesce(v_rule.pace_policy, '{}'::jsonb);
  v_prev_mode := coalesce(v_policy->>'mode', 'off');
  if v_prev_mode = p_mode then
    return jsonb_build_object('ok', true, 'unchanged', true, 'mode', p_mode);
  end if;

  insert into public.revenue_rule_backups (hotel_id, note, rule, pace_targets, price_floors)
  values (
    p_hotel_id,
    format('pace policy %s -> %s%s', v_prev_mode, p_mode, coalesce(': ' || p_note, '')),
    to_jsonb(v_rule),
    (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.revenue_pace_targets t where t.hotel_id = p_hotel_id),
    (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from public.revenue_price_floors f where f.hotel_id = p_hotel_id)
  );

  v_windows := v_rule.window_rules;
  v_markdowns := v_rule.max_markdowns_per_day;

  if p_mode = 'live' then
    v_policy := v_policy || jsonb_build_object(
      'pre_live', jsonb_build_object(
        'window_rules', v_rule.window_rules,
        'max_markdowns_per_day', v_rule.max_markdowns_per_day),
      'supervised_until', to_char((now() + interval '48 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
    select coalesce(jsonb_agg(
             w || jsonb_build_object('max_daily_decrease', greatest(
               coalesce((w->>'max_daily_decrease')::numeric, 0),
               case
                 when coalesce((w->>'max_days_out')::int, 9999) <= 0 then 140
                 when coalesce((w->>'max_days_out')::int, 9999) <= 3 then 80
                 when coalesce((w->>'max_days_out')::int, 9999) <= 7 then 60
                 else 30
               end))
             order by coalesce((w->>'min_days_out')::int, 0)), '[]'::jsonb)
      into v_windows
      from jsonb_array_elements(coalesce(v_rule.window_rules, '[]'::jsonb)) w;
    v_markdowns := greatest(coalesce(v_rule.max_markdowns_per_day, 1), 8);
  elsif v_prev_mode = 'live' then
    if v_policy ? 'pre_live' then
      v_windows := coalesce(v_policy->'pre_live'->'window_rules', v_rule.window_rules);
      v_markdowns := coalesce((v_policy->'pre_live'->>'max_markdowns_per_day')::int, v_rule.max_markdowns_per_day);
    end if;
    v_policy := (v_policy - 'pre_live') || jsonb_build_object('supervised_until', null);
  end if;

  v_policy := v_policy || jsonb_build_object(
    'mode', p_mode,
    'mode_changed_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));

  update public.revenue_pickup_automation_rules
     set pace_policy = v_policy,
         window_rules = v_windows,
         max_markdowns_per_day = v_markdowns,
         version = coalesce(version, 1) + 1,
         updated_at = now()
   where id = v_rule.id;

  -- One price writer at a time: the AI supervisor publishes only while the
  -- pace ratchet is not live.
  select jobid into v_ai_job from cron.job where jobname = 'ottofiori-ai-supervisor-4h';
  if p_hotel_id = 'ottofiori' and v_ai_job is not null then
    perform cron.alter_job(v_ai_job, active := (p_mode <> 'live'));
  end if;

  return jsonb_build_object(
    'ok', true, 'hotel_id', p_hotel_id, 'from', v_prev_mode, 'to', p_mode,
    'window_rules', v_windows, 'max_markdowns_per_day', v_markdowns,
    'ai_price_writer_active', p_mode <> 'live');
end;
$function$;

revoke all on function public.revenue_pace_policy_set_mode(text, text, text) from public, anon, authenticated;
grant execute on function public.revenue_pace_policy_set_mode(text, text, text) to service_role;

-- 8. Converting prices for bookings of the last week, so the policy starts with
--    a memory instead of an empty table.
insert into public.revenue_converting_prices (hotel_id, stay_date, price_eur, converted_at, bookings)
select l.hotel_id, l.stay_date, d.current_price, l.last_seen, l.bookings
  from (
    select hotel_id, stay_date, max(first_seen_at) as last_seen, count(distinct reservation_id)::int as bookings
      from public.revenue_pickup_ledger
     where hotel_id = 'ottofiori' and cancelled_at is null
       and first_seen_at >= now() - interval '7 days'
       and stay_date >= (now() at time zone 'Europe/Budapest')::date
     group by hotel_id, stay_date
  ) l
  join lateral (
    select dd.current_price
      from public.revenue_date_decisions dd
     where dd.hotel_id = l.hotel_id and dd.stay_date = l.stay_date
       and dd.created_at <= l.last_seen and dd.created_at >= l.last_seen - interval '6 hours'
       and dd.current_price is not null and dd.current_price > 0
     order by dd.created_at desc
     limit 1
  ) d on true
on conflict (hotel_id, stay_date) do nothing;

-- 9. Scheduled jobs: refresh the seasonal base four times a day and keep two
--    weeks of policy log.
do $$
begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('revenue-seasonal-base-ottofiori-6h', 'revenue-pace-policy-log-purge');
  perform cron.schedule(
    'revenue-seasonal-base-ottofiori-6h', '23 */6 * * *',
    $job$select public.revenue_refresh_seasonal_base('ottofiori', array['gozsdu-court','mika-downtown','memories-budapest']);$job$);
  perform cron.schedule(
    'revenue-pace-policy-log-purge', '50 3 * * *',
    $job$delete from public.revenue_pace_policy_log where created_at < now() - interval '14 days';$job$);
end $$;

select public.revenue_refresh_seasonal_base('ottofiori', array['gozsdu-court','mika-downtown','memories-budapest']);
