-- Ottofiori only: an independent, bounded API review above the fast engine.
-- Monthly ADR remains an objective; the explicit absolute room-price floor is €80.
update public.revenue_price_floors
set min_price=80, notes='Ottofiori absolute lockstep safety floor EUR 80; ceiling EUR 500. Winter sales review 6 Nov 2026.', updated_at=now()
where hotel_id='ottofiori' and organization_slug='rdhotels' and is_global_safety_max=true;

update public.revenue_pickup_automation_rules
set window_rules='[
 {"id":"w0_2","min_days_out":0,"max_days_out":3,"max_daily_decrease":24,"max_daily_increase":12,"no_pickup_wait_hours":2,"min_hours_between_decreases":2,"require_above_anchor":false},
 {"id":"w3_7","min_days_out":4,"max_days_out":7,"max_daily_decrease":18,"max_daily_increase":15,"no_pickup_wait_hours":3,"min_hours_between_decreases":3,"require_above_anchor":false},
 {"id":"w8_30","min_days_out":8,"max_days_out":30,"max_daily_decrease":12,"max_daily_increase":20,"no_pickup_wait_hours":4,"min_hours_between_decreases":4,"require_above_anchor":false},
 {"id":"w31_90","min_days_out":31,"max_days_out":120,"max_daily_decrease":12,"max_daily_increase":22,"no_pickup_wait_hours":6,"min_hours_between_decreases":4,"require_above_anchor":false}
]'::jsonb,max_markdowns_per_day=6,max_daily_decrease_per_date=24,updated_at=now()
where hotel_id='ottofiori' and organization_slug='rdhotels';

create table public.ottofiori_ai_review_runs (
 id uuid primary key default gen_random_uuid(), slot bigint not null unique,
 status text not null default 'running' check(status in ('running','completed','failed','budget_skipped','no_candidates','dry_run')),
 model text, estimated_cost_usd numeric not null default 0,
 started_at timestamptz not null default now(), finished_at timestamptz, pms_refreshed_at timestamptz,
 summary text, decisions jsonb, outcomes jsonb, error text
);
alter table public.ottofiori_ai_review_runs enable row level security;
revoke all on public.ottofiori_ai_review_runs from public,anon,authenticated;
grant select,insert,update on public.ottofiori_ai_review_runs to service_role;

create table public.ottofiori_ai_price_policies (
 stay_date date primary key, hotel_id text not null default 'ottofiori' check(hotel_id='ottofiori'),
 organization_slug text not null default 'rdhotels' check(organization_slug='rdhotels'),
 review_id uuid not null references public.ottofiori_ai_review_runs(id),
 decision_id uuid references public.revenue_date_decisions(id),
 delta_eur integer not null, reason text not null,
 created_at timestamptz not null default now(), valid_until timestamptz not null,
 check(valid_until>created_at and valid_until<=created_at+interval '4 hours')
);
alter table public.ottofiori_ai_price_policies enable row level security;
revoke all on public.ottofiori_ai_price_policies from public,anon,authenticated;
grant select,insert,update on public.ottofiori_ai_price_policies to service_role;
create policy service_review_only on public.ottofiori_ai_review_runs to service_role using(true) with check(true);
create policy service_policy_only on public.ottofiori_ai_price_policies to service_role using(true) with check(true);

create or replace function public.ottofiori_ai_context(p_stay_date date default null) returns jsonb
language sql security invoker set search_path=public as $fn$
with dates as (
 select d::date stay_date from generate_series((now() at time zone 'Europe/Budapest')::date,
 (now() at time zone 'Europe/Budapest')::date+120,interval '1 day') d where p_stay_date is null or d::date=p_stay_date
), cells as (
 select distinct on(r.stay_date,r.obk_id,r.occupancy) r.stay_date,r.obk_id,r.occupancy,
 round(r.price)::int price,r.captured_at
 from public.revenue_room_type_rates r join public.previo_rate_plan_mapping m
 on m.hotel_id=r.hotel_id and m.previo_room_type_id=r.obk_id and m.previo_rate_plan_id=r.rate_plan_id
 where r.hotel_id='ottofiori' and r.organization_slug='rdhotels'
 and r.stay_date between (now() at time zone 'Europe/Budapest')::date and (now() at time zone 'Europe/Budapest')::date+120
 and (p_stay_date is null or r.stay_date=p_stay_date) and r.price>0 and r.currency='EUR'
 order by r.stay_date,r.obk_id,r.occupancy,r.captured_at desc
), priced as (
 select c.stay_date,min(c.price) min_price,max(c.price) max_price,min(c.captured_at) captured_at,
 min(c.price) filter(where c.occupancy=2 and coalesce(a.availability,1)>0) reference,
 jsonb_agg(jsonb_build_object('obk_id',c.obk_id,'occupancy',c.occupancy,'price',c.price) order by c.obk_id,c.occupancy) cells
 from cells c left join public.revenue_room_type_availability a
 on a.hotel_id='ottofiori' and a.stay_date=c.stay_date and a.obk_id=c.obk_id group by c.stay_date
), bookings as (
 select stay_date,max(created_at_pms) last_pickup,
 count(distinct res_id) filter(where created_at_pms>=now()-interval '1 hour') pickup_1h,
 count(distinct res_id) filter(where created_at_pms>=now()-interval '6 hours') pickup_6h,
 count(distinct res_id) filter(where created_at_pms>=now()-interval '24 hours') pickup_24h,
 count(distinct res_id) filter(where created_at_pms>=now()-interval '48 hours') pickup_48h,
 count(distinct res_id) filter(where created_at_pms>=now()-interval '7 days') pickup_7d
 from public.revenue_booking_nights where hotel_id='ottofiori' and organization_slug='rdhotels'
 and stay_date between (now() at time zone 'Europe/Budapest')::date and (now() at time zone 'Europe/Budapest')::date+120 and (p_stay_date is null or stay_date=p_stay_date) group by stay_date
), movement as (
 select stay_date,sum(abs(movement)) filter(where direction='decrease') down_today,
 sum(abs(movement)) filter(where direction='increase') up_today,
 count(*) filter(where direction='decrease') markdowns_today,max(created_at) last_move_at
 from public.revenue_date_decisions where hotel_id='ottofiori' and (p_stay_date is null or stay_date=p_stay_date) and direction<>'hold'
 and status in ('queued','accepted','confirmed','published','partial')
 and created_at>=(((now() at time zone 'Europe/Budapest')::date)::timestamp at time zone 'Europe/Budapest') group by stay_date
), facts as (
 select jsonb_build_object('date',d.stay_date,'lead',d.stay_date-(now() at time zone 'Europe/Budapest')::date,
 'occ',s.occupancy_pct,'left',greatest(0,s.rooms_available-s.rooms_sold),
 'reference',p.reference,'min_price',p.min_price,'max_price',p.max_price,'cells',coalesce(p.cells,'[]'::jsonb),'captured_at',coalesce((select max(pms_refreshed_at) from public.ottofiori_ai_review_runs where status='running' and pms_refreshed_at>=now()-interval '8 minutes'),p.captured_at),
 'pickup_1h',coalesce(b.pickup_1h,0),'pickup_6h',coalesce(b.pickup_6h,0),'pickup_24h',coalesce(b.pickup_24h,0),
 'pickup_48h',coalesce(b.pickup_48h,0),'pickup_7d',coalesce(b.pickup_7d,0),
 'quiet_hours',case when b.last_pickup is null then null else round(extract(epoch from now()-b.last_pickup)/3600,1) end,
 'cancellations_24h',(select count(*) from public.revenue_cancelled_nights n where n.hotel_id='ottofiori' and n.stay_date=d.stay_date and n.cancelled_at>=now()-interval '24 hours'),
 'down_today',coalesce(m.down_today,0),'up_today',coalesce(m.up_today,0),'markdowns_today',coalesce(m.markdowns_today,0),'last_move_at',m.last_move_at,
 'market',jsonb_build_object('median',c.median_rate_eur,'count',coalesce(c.validated_competitor_count,0),'age_hours',extract(epoch from now()-c.freshest_captured_at)/3600),
 'engine_reason',e.decision_reason,'pace',e.pace_target_pct) fact
 from dates d left join priced p using(stay_date) left join bookings b using(stay_date) left join movement m using(stay_date)
 left join lateral(select rooms_sold,rooms_available,occupancy_pct from public.revenue_daily_snapshots
 where hotel_id='ottofiori' and stay_date=d.stay_date order by captured_at desc limit 1) s on true
 left join public.revenue_competitor_market_daily c on c.hotel_id='ottofiori' and c.stay_date=d.stay_date
 left join lateral(select decision_reason,pace_target_pct from public.revenue_date_decisions
 where hotel_id='ottofiori' and stay_date=d.stay_date order by created_at desc limit 1) e on true
)
select jsonb_build_object('dates',(select jsonb_agg(fact) from facts),
 'rule',(select jsonb_build_object('windows',window_rules,'floor',80,'daily_movement_cap',40,'max_markdowns',max_markdowns_per_day,'monthly_adr_targets',monthly_adr_targets)
 from public.revenue_pickup_automation_rules where hotel_id='ottofiori' and organization_slug='rdhotels' limit 1),
 'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from (select title,event_date,end_date,expected_impact,approved,confidence,url,source from public.demand_events
 where hotel_id='ottofiori' and coalesce(end_date,event_date)>=(now() at time zone 'Europe/Budapest')::date
 and event_date<=(now() at time zone 'Europe/Budapest')::date+120 and approved=true order by event_date limit 150) e),
 'history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) from (select distinct on(stay_date) stay_date,occupancy_pct,adr_eur,revpar_eur
 from public.revenue_historical_daily where p_stay_date is null and hotel_id='ottofiori' and stay_date between (now() at time zone 'Europe/Budapest')::date-interval '1 year'
 and (now() at time zone 'Europe/Budapest')::date+120-interval '1 year' order by stay_date,observed_date desc limit 121) h))
$fn$;
revoke all on function public.ottofiori_ai_context(date) from public,anon,authenticated;
grant execute on function public.ottofiori_ai_context(date) to service_role;

-- Adds freshness, shared budgets, full-column compare-and-set and a four-hour
-- observation policy around the existing atomic queue/publisher contract.
create or replace function public.ottofiori_ai_apply(
 p_review_id uuid,p_stay_date date,p_delta integer,p_expected_cells jsonb,p_reason text,p_dry_run boolean default true
) returns jsonb language plpgsql security invoker set search_path=public as $fn$
declare v_context jsonb; v_date jsonb; v_rule record; v_window jsonb; v_current jsonb;
 v_cap numeric; v_spent numeric; v_last timestamptz; v_days int; v_result jsonb; v_peak numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended('ottofiori-ai-'||p_stay_date::text,0));
 if not exists(select 1 from public.ottofiori_ai_review_runs where id=p_review_id and status='running' and started_at>=now()-interval '8 minutes' and pms_refreshed_at>=now()-interval '8 minutes') then
 raise exception 'A current supervisor review is required'; end if;
 if not exists(select 1 from public.revenue_engine_config where id='global' and automation_enabled and not dry_run
 and automation_lock_hotel='ottofiori' and automation_lock_at>=now()-interval '8 minutes') then
 raise exception 'Shared automation lease is required and global automation must be live'; end if;
 select * into strict v_rule from public.revenue_pickup_automation_rules where hotel_id='ottofiori' and organization_slug='rdhotels' and is_enabled and mode='live' limit 1;
 v_days:=p_stay_date-(now() at time zone 'Europe/Budapest')::date;
 if v_days<0 or v_days>120 or p_delta is null or abs(p_delta)>(case when v_days<=3 then 12 else 6 end) or length(btrim(p_reason))<20 then
 raise exception 'Invalid AI date, whole-euro step, or rationale'; end if;
 select public.ottofiori_ai_context(p_stay_date) into v_context;
 select value into v_date from jsonb_array_elements(v_context->'dates') where value->>'date'=p_stay_date::text;
 if v_date is null or v_date->>'occ' is null or v_date->>'reference' is null or (v_date->>'left')::int<=0
 or jsonb_array_length(v_date->'cells')<>13 or (v_date->>'captured_at')::timestamptz<now()-interval '30 minutes' then
 raise exception 'Fresh complete mapped prices and sellable occupancy are required'; end if;
 v_current:=v_date->'cells';
 if p_expected_cells is null or jsonb_array_length(p_expected_cells)<>13 or not(v_current @> p_expected_cells and p_expected_cells @> v_current) then
 raise exception 'A price changed after AI analysis; review again rather than overwrite it'; end if;
 if exists(select 1 from public.revenue_manual_locks where hotel_id='ottofiori' and stay_date=p_stay_date and locked_until>now()) then raise exception 'Manager lock is active'; end if;
 if exists(select 1 from public.revenue_manual_hold_state('ottofiori',now()-make_interval(hours=>greatest(1,coalesce(v_rule.manual_hold_hours,4))),array['cell-edit','cell-selection','day-tool','bulk','bulk-edit','manual','quick-adjust']) h
 where h.stay_date=p_stay_date) then raise exception 'Manager edit is protected'; end if;
 if exists(select 1 from public.ottofiori_ai_price_policies where stay_date=p_stay_date and valid_until>now()) then raise exception 'An AI observation is already active'; end if;
 select w into v_window from jsonb_array_elements(v_rule.window_rules) w where v_days>=(w->>'min_days_out')::int and v_days<=(w->>'max_days_out')::int order by (w->>'min_days_out')::int desc limit 1;
 v_last:=(v_date->>'last_move_at')::timestamptz;
 if v_last>now()-interval '1 hour' then raise exception 'A current price move is still settling'; end if;
 if p_delta<0 then
  if (v_date->>'pickup_6h')::int>=2 or coalesce((v_date->>'quiet_hours')::numeric,10000)<coalesce((v_window->>'no_pickup_wait_hours')::numeric,6) then raise exception 'Recent genuine demand protects this offer'; end if;
  if (v_date->>'occ')::numeric>=85 and not(v_days<=3 and coalesce((v_date->>'quiet_hours')::numeric,10000)>=4 and (v_date->>'pickup_6h')::int=0) then raise exception 'Strong occupancy is protected'; end if;
  if (v_date->>'occ')::numeric>=85 and abs(p_delta)>2 then raise exception 'Close-in last-room rescue is limited to EUR 2 per review'; end if;
  if exists(select 1 from public.revenue_date_decisions where hotel_id='ottofiori' and stay_date=p_stay_date and decision_reason='event_demand_protected' and created_at>=now()-interval '1 hour') then raise exception 'A verified high-impact event protects this date'; end if;
  if exists(select 1 from public.revenue_cancelled_nights where hotel_id='ottofiori' and stay_date=p_stay_date and cancelled_at>=now()-interval '1 hour') then raise exception 'Cancellation cooldown is active'; end if;
  v_cap:=(v_window->>'max_daily_decrease')::numeric; v_spent:=(v_date->>'down_today')::numeric;
  if v_cap is null or v_cap<=0 or v_spent+abs(p_delta)>v_cap or (v_date->>'markdowns_today')::int>=v_rule.max_markdowns_per_day then raise exception 'Shared daily markdown allowance is exhausted'; end if;
  select max(greatest(current_price,target_price)) into v_peak from public.revenue_date_decisions where hotel_id='ottofiori' and stay_date=p_stay_date and created_at>=now()-interval '96 hours';
  if (v_date->>'reference')::numeric+p_delta < coalesce(v_peak,(v_date->>'reference')::numeric)*(1-coalesce(v_rule.markdown_depth_pct,25)/100) then raise exception 'Campaign markdown depth is protected'; end if;
 elsif p_delta>0 then
  if (v_date->>'pickup_6h')::int=0 then raise exception 'A fresh booking is required for a rise'; end if;
  if (v_date->>'pickup_6h')::int=1 and p_delta>(case when v_days<=7 then 1 else 2 end) then raise exception 'A single booking only permits a measured rise'; end if;
  v_cap:=(v_window->>'max_daily_increase')::numeric;v_spent:=(v_date->>'up_today')::numeric;
  if v_cap is null or v_spent+p_delta>v_cap then raise exception 'Shared daily increase allowance is exhausted'; end if;
  if not exists(select 1 from public.revenue_pickup_ledger where hotel_id='ottofiori' and stay_date=p_stay_date and cancelled_at is null and increase_spent_at is null and first_seen_at>=now()-interval '6 hours') then raise exception 'Booking increase was already consumed or has not been verified'; end if;
 end if;
 if p_delta=0 then v_result:=jsonb_build_object('ok',true,'dry_run',p_dry_run,'stay_date',p_stay_date,'delta_eur',0);
 else perform set_config('hotelcare.otto_ai_review',p_review_id::text,true); v_result:=public.hotelcare_ai_queue_ottofiori_column(p_stay_date,p_delta,'ai_supervisor',p_reason,p_dry_run); end if;
 if not p_dry_run and (v_result->>'ok')::boolean then
  insert into public.ottofiori_ai_price_policies(stay_date,review_id,decision_id,delta_eur,reason,created_at,valid_until)
  values(p_stay_date,p_review_id,(v_result->>'decision_id')::uuid,p_delta,p_reason,now(),now()+interval '4 hours')
  on conflict(stay_date) do update set review_id=excluded.review_id,decision_id=excluded.decision_id,delta_eur=excluded.delta_eur,reason=excluded.reason,created_at=excluded.created_at,valid_until=excluded.valid_until;
  if p_delta>0 then update public.revenue_pickup_ledger set increase_spent_at=now() where hotel_id='ottofiori' and stay_date=p_stay_date and increase_spent_at is null and cancelled_at is null and first_seen_at>=now()-interval '6 hours'; end if;
 end if;
 return v_result;
end $fn$;
revoke all on function public.ottofiori_ai_apply(uuid,date,integer,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.ottofiori_ai_apply(uuid,date,integer,jsonb,text,boolean) to service_role;

do $fn$ begin
 if not exists(select 1 from vault.secrets where name='hotelcare_otto_ai_worker_secret') then
 perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'hotelcare_otto_ai_worker_secret'); end if;
end $fn$;
create or replace function public.verify_otto_ai_worker(p_secret text) returns boolean
language sql security definer set search_path=public,vault as $fn$
 select p_secret is not null and exists(select 1 from vault.decrypted_secrets where name='hotelcare_otto_ai_worker_secret' and decrypted_secret=p_secret)
$fn$;
revoke all on function public.verify_otto_ai_worker(text) from public,anon,authenticated;
grant execute on function public.verify_otto_ai_worker(text) to service_role;

create or replace function public.invoke_ottofiori_ai_supervisor() returns bigint
language plpgsql security definer set search_path=public,net,vault as $fn$
declare v_secret text;v_id bigint;
begin
 select decrypted_secret into strict v_secret from vault.decrypted_secrets where name='hotelcare_otto_ai_worker_secret';
 select net.http_post(url:='https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/ottofiori-ai-supervisor',
 headers:=jsonb_build_object('Content-Type','application/json','x-otto-ai-worker',v_secret),body:='{}'::jsonb,timeout_milliseconds:=5000) into v_id;
 return v_id;
end $fn$;
revoke all on function public.invoke_ottofiori_ai_supervisor() from public,anon,authenticated;
grant execute on function public.invoke_ottofiori_ai_supervisor() to service_role;

-- Keep every AI caller on the same reviewed atomic queue contract.
CREATE OR REPLACE FUNCTION public.hotelcare_ai_queue_ottofiori_column(p_stay_date date, p_delta integer, p_decision_reason text, p_reason_detail text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hotel constant text := 'ottofiori';
  v_org constant text := 'rdhotels';
  v_today date := (now() at time zone 'Europe/Budapest')::date;
  v_day_start timestamptz := (((now() at time zone 'Europe/Budapest')::date)::timestamp at time zone 'Europe/Budapest');
  v_floor numeric;
  v_max_daily numeric;
  v_cell_count integer := 0;
  v_min_current numeric;
  v_max_current numeric;
  v_min_target numeric;
  v_max_target numeric;
  v_spent numeric := 0;
  v_rooms_sold integer;
  v_rooms_available integer;
  v_occ numeric;
  v_adr numeric;
  v_signal record;
  v_run_id uuid := gen_random_uuid();
  v_push_run_id uuid := gen_random_uuid();
  v_decision_id uuid := gen_random_uuid();
  v_direction text;
  v_anchor integer;
  v_inserted integer := 0;
  v_items integer := 0;
  v_row record;
  v_cell_floor numeric;
  v_cell_ceiling numeric;
  v_target integer;
  v_lockstep boolean;
  v_manual_hours integer;
begin
  if not exists(select 1 from public.ottofiori_ai_review_runs where id=nullif(current_setting('hotelcare.otto_ai_review',true),'')::uuid and status='running') then
    raise exception 'Use ottofiori_ai_apply with a current supervisor review';
  end if;
  select date_column_lockstep_enabled,coalesce(manual_hold_hours,4) into v_lockstep,v_manual_hours from public.revenue_pickup_automation_rules where hotel_id=v_hotel limit 1;
  if p_stay_date is null then
    raise exception 'stay_date is required';
  end if;
  if p_stay_date < v_today or p_stay_date > v_today + 120 then
    raise exception 'HotelCare AI may only change Ottofiori dates from today through the rolling 120-day horizon';
  end if;
  if p_delta is null or p_delta = 0 or p_delta <> round(p_delta) then
    raise exception 'HotelCare AI delta must be one non-zero whole EUR amount';
  end if;
  if p_decision_reason is null or lower(p_decision_reason) not like 'ai\_%' escape '\' then
    raise exception 'HotelCare AI decision_reason must start with ai_';
  end if;
  if p_reason_detail is null or length(btrim(p_reason_detail)) < 20 then
    raise exception 'HotelCare AI reason_detail is required and must contain the live RM rationale';
  end if;

  select coalesce(floor_price_eur, 0), coalesce(max_daily_change_eur, 40)
    into v_floor, v_max_daily
    from public.hotel_revenue_settings
   where hotel_id = v_hotel;
  if not found then
    raise exception 'Ottofiori revenue settings are missing';
  end if;
  if abs(p_delta) > greatest(1, v_max_daily) then
    raise exception 'Requested AI move % EUR exceeds Ottofiori max daily change % EUR', p_delta, v_max_daily;
  end if;

  if exists (
    select 1 from public.revenue_manual_locks
     where hotel_id = v_hotel and stay_date = p_stay_date and locked_until > now()
  ) then
    raise exception 'Manager lock is active for %', p_stay_date;
  end if;

  -- Human manager edits always win. AI-authored manager-priority drafts carry
  -- ai_* reasons and therefore do not masquerade as a human edit here.
  if exists (
    select 1 from public.revenue_rate_drafts
     where hotel_id = v_hotel
       and stay_date = p_stay_date
       and intent_source = 'manual'
       and coalesce(decision_reason, '') not like 'ai\_%' escape '\'
       and created_at >= now() - make_interval(hours=>v_manual_hours)
       and status not in ('failed','superseded')
  ) then
    raise exception 'A human manager price is protected for the configured edit window on %', p_stay_date;
  end if;

  -- Never stack on an unfinished delivery or an unattached active draft.
  if exists (
    select 1
      from public.revenue_rate_push_items i
      join public.revenue_rate_push_runs r on r.id = i.run_id
     where i.hotel_id = v_hotel
       and i.stay_date = p_stay_date
       and (i.status in ('queued','processing') and r.status in ('queued','processing'))
  ) or exists (
    select 1 from public.revenue_rate_drafts d
     where d.hotel_id = v_hotel and d.stay_date = p_stay_date
       and d.superseded_at is null and d.status in ('draft','failed')
  ) then
    raise exception 'An unfinished price publication already exists for %', p_stay_date;
  end if;

  -- Avoid hourly price bounce. A fresh accepted AI/automation/manager decision
  -- gets at least one full hour to settle before another supervisor move.
  if exists (
    select 1 from public.revenue_date_decisions d
     where d.hotel_id = v_hotel and d.stay_date = p_stay_date
       and d.created_at >= now() - interval '60 minutes'
       and d.status in ('queued','accepted','published','confirmed','verified','partial')
       and coalesce(d.movement,0) <> 0
  ) then
    raise exception 'A recent price decision is still inside the 60-minute anti-bounce window for %', p_stay_date;
  end if;

  select coalesce(sum(abs(d.movement)),0)
    into v_spent
    from public.revenue_date_decisions d
   where d.hotel_id = v_hotel and d.stay_date = p_stay_date
     and d.created_at >= v_day_start
     and d.status in ('queued','accepted','published','confirmed','verified','partial')
     and coalesce(d.movement,0) <> 0;
  if v_spent + abs(p_delta) > v_max_daily then
    raise exception 'Daily movement budget would be exceeded for %: spent %, requested %, cap %', p_stay_date, v_spent, abs(p_delta), v_max_daily;
  end if;

  select rooms_sold, rooms_available, occupancy_pct, adr_eur
    into v_rooms_sold, v_rooms_available, v_occ, v_adr
    from public.revenue_daily_snapshots
   where hotel_id = v_hotel and stay_date = p_stay_date
   order by captured_at desc nulls last, created_at desc
   limit 1;

  select d.pickup_1h,d.pickup_6h,d.pickup_24h,d.pickup_48h,d.pickup_7d,
         d.cancellations_24h,d.pace_target_pct,d.pace_gap_pct,d.event_signal,d.market_signal
    into v_signal
    from public.revenue_date_decisions d
   where d.hotel_id = v_hotel and d.stay_date = p_stay_date
   order by d.created_at desc
   limit 1;

  -- Build the authoritative current mapped column. Only the exact configured
  -- Previo rate plan for each room type is eligible; newest mirror row wins.
  with current_cells as (
    select distinct on (r.obk_id, r.room_type_name, r.occupancy)
           r.obk_id, r.room_type_name, r.occupancy, round(r.price)::integer as price,
           coalesce(r.currency,'EUR') as currency, r.rate_plan_id
      from public.revenue_room_type_rates r
      join public.previo_rate_plan_mapping m
        on m.hotel_id = r.hotel_id
       and m.previo_room_type_id = r.obk_id
       and m.previo_rate_plan_id = r.rate_plan_id
     where r.hotel_id = v_hotel and r.stay_date = p_stay_date
       and r.price is not null and r.price > 0
     order by r.obk_id, r.room_type_name, r.occupancy, r.updated_at desc nulls last, r.captured_at desc nulls last
  )
  select count(*)::integer, min(price), max(price), min(price + p_delta), max(price + p_delta)
    into v_cell_count, v_min_current, v_max_current, v_min_target, v_max_target
    from current_cells;

  if v_cell_count <> 13 then
    raise exception 'No complete mapped Ottofiori rate column is available for %', p_stay_date;
  end if;

  -- Validate every cell against hotel and cell-specific floor/ceiling rules.
  for v_row in
    with current_cells as (
      select distinct on (r.obk_id, r.room_type_name, r.occupancy)
             r.obk_id, r.room_type_name, r.occupancy, round(r.price)::integer as price,
             coalesce(r.currency,'EUR') as currency, r.rate_plan_id
        from public.revenue_room_type_rates r
        join public.previo_rate_plan_mapping m
          on m.hotel_id = r.hotel_id
         and m.previo_room_type_id = r.obk_id
         and m.previo_rate_plan_id = r.rate_plan_id
       where r.hotel_id = v_hotel and r.stay_date = p_stay_date
         and r.price is not null and r.price > 0
       order by r.obk_id, r.room_type_name, r.occupancy, r.updated_at desc nulls last, r.captured_at desc nulls last
    ) select * from current_cells
  loop
    select max(f.min_price), min(f.max_price)
      into v_cell_floor, v_cell_ceiling
      from public.revenue_price_floors f
     where f.hotel_id = v_hotel
       and ((v_lockstep and f.is_global_safety_max) or (not v_lockstep
       and (f.room_type_name is null or f.room_type_name = v_row.room_type_name)
       and (f.occupancy is null or f.occupancy = v_row.occupancy)));
    v_cell_floor := greatest(coalesce(v_cell_floor,0), coalesce(v_floor,0));
    v_target := v_row.price + p_delta;
    if v_target <= 0 or v_target < v_cell_floor then
      raise exception 'AI whole-column move would breach floor for % / % guests: target %, floor %', v_row.room_type_name, v_row.occupancy, v_target, v_cell_floor;
    end if;
    if v_cell_ceiling is not null and v_target > v_cell_ceiling then
      raise exception 'AI whole-column move would breach ceiling for % / % guests: target %, ceiling %', v_row.room_type_name, v_row.occupancy, v_target, v_cell_ceiling;
    end if;
  end loop;

  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dry_run', true, 'hotel_id', v_hotel, 'stay_date', p_stay_date,
      'delta_eur', p_delta, 'mapped_cells', v_cell_count,
      'min_current', v_min_current, 'max_current', v_max_current,
      'min_target', v_min_target, 'max_target', v_max_target,
      'occupancy_pct', v_occ, 'rooms_sold', v_rooms_sold,
      'rooms_remaining', case when v_rooms_available is null or v_rooms_sold is null then null else greatest(0,v_rooms_available-v_rooms_sold) end,
      'booked_adr_eur', v_adr, 'daily_movement_spent_eur', v_spent,
      'actor_name', 'HotelCare AI', 'decision_reason', p_decision_reason,
      'reason_detail', p_reason_detail
    );
  end if;

  v_direction := case when p_delta > 0 then 'increase' else 'decrease' end;
  select min(r.price)::integer into v_anchor from public.revenue_room_type_rates r
    join public.previo_rate_plan_mapping m on m.hotel_id=r.hotel_id and m.previo_room_type_id=r.obk_id and m.previo_rate_plan_id=r.rate_plan_id
    left join public.revenue_room_type_availability a on a.hotel_id=r.hotel_id and a.stay_date=r.stay_date and a.obk_id=r.obk_id
    where r.hotel_id=v_hotel and r.stay_date=p_stay_date and r.occupancy=2 and coalesce(a.availability,1)>0;
  if v_anchor is null then raise exception 'No mapped double offer is available'; end if;

  insert into public.revenue_automation_runs(
    id,hotel_id,organization_slug,mode,status,started_at,finished_at,duration_ms,
    dates_evaluated,dates_increased,dates_decreased,dates_held,dates_blocked,
    cells_queued,cells_published,cells_verified,cells_failed,skip_reasons,push_run_id
  ) values (
    v_run_id,v_hotel,v_org,'live','completed',now(),now(),0,
    1,case when p_delta>0 then 1 else 0 end,case when p_delta<0 then 1 else 0 end,0,0,
    v_cell_count,0,0,0,jsonb_build_object('hotelcare_ai_supervisor',true),v_push_run_id
  );

  insert into public.revenue_date_decisions(
    id,run_id,hotel_id,organization_slug,stay_date,days_out,
    occupancy_pct,rooms_sold,rooms_remaining,pickup_1h,pickup_6h,pickup_24h,pickup_48h,pickup_7d,cancellations_24h,
    pace_target_pct,pace_gap_pct,current_price,target_price,movement,direction,
    decision_reason,reason_detail,event_signal,market_signal,status,anchor_price,movement_requested,cells_simulated
  ) values (
    v_decision_id,v_run_id,v_hotel,v_org,p_stay_date,(p_stay_date-v_today),
    v_occ,v_rooms_sold,case when v_rooms_available is null or v_rooms_sold is null then null else greatest(0,v_rooms_available-v_rooms_sold) end,
    coalesce(v_signal.pickup_1h,0),coalesce(v_signal.pickup_6h,0),coalesce(v_signal.pickup_24h,0),coalesce(v_signal.pickup_48h,0),coalesce(v_signal.pickup_7d,0),coalesce(v_signal.cancellations_24h,0),
    v_signal.pace_target_pct,v_signal.pace_gap_pct,v_anchor,v_anchor+p_delta,p_delta,v_direction,
    p_decision_reason,p_reason_detail,v_signal.event_signal,v_signal.market_signal,'queued',v_anchor,p_delta,v_cell_count
  );

  insert into public.revenue_rate_push_runs(
    id,hotel_id,organization_slug,source,status,requested_count,processed_count,accepted_count,failed_count,
    priority,automation_run_id,date_manifest
  ) values (
    v_push_run_id,v_hotel,v_org,'manual','queued',v_cell_count,0,0,0,10,v_run_id,
    jsonb_build_object(p_stay_date::text,jsonb_build_object(
      'movement',p_delta,'movement_requested',p_delta,'decision_id',v_decision_id,'expected_cells',v_cell_count,
      'actor_name','HotelCare AI','decision_reason',p_decision_reason,'reason_detail',p_reason_detail
    ))
  );

  with current_cells as (
    select distinct on (r.obk_id, r.room_type_name, r.occupancy)
           r.obk_id, r.room_type_name, r.occupancy, round(r.price)::integer as price,
           coalesce(r.currency,'EUR') as currency, r.rate_plan_id
      from public.revenue_room_type_rates r
      join public.previo_rate_plan_mapping m
        on m.hotel_id = r.hotel_id
       and m.previo_room_type_id = r.obk_id
       and m.previo_rate_plan_id = r.rate_plan_id
     where r.hotel_id = v_hotel and r.stay_date = p_stay_date
       and r.price is not null and r.price > 0
     order by r.obk_id, r.room_type_name, r.occupancy, r.updated_at desc nulls last, r.captured_at desc nulls last
  )
  insert into public.revenue_rate_drafts(
    hotel_id,organization_slug,stay_date,obk_id,room_type_name,occupancy,
    old_price,new_price,currency,status,created_by,push_run_id,priority,intent_source,
    decision_id,decision_reason,reason_detail,confirmation_status
  )
  select v_hotel,v_org,p_stay_date,c.obk_id,c.room_type_name,c.occupancy,
         c.price,c.price+p_delta,c.currency,'draft',null,v_push_run_id,10,'manual',
         v_decision_id,p_decision_reason,p_reason_detail,'queued'
    from current_cells c;
  get diagnostics v_inserted = row_count;

  if v_inserted <> v_cell_count then
    raise exception 'Atomic AI queue aborted: expected % drafts but created %', v_cell_count, v_inserted;
  end if;
  if exists (
    select 1 from public.revenue_rate_drafts d
     where d.push_run_id = v_push_run_id and (d.status <> 'draft' or d.superseded_at is not null)
  ) then
    raise exception 'Atomic AI queue aborted: a database safety trigger rejected part of the stay-date column';
  end if;

  insert into public.revenue_rate_push_items(
    run_id,hotel_id,organization_slug,stay_date,obk_id,room_type_name,occupancy,
    old_price,target_price,currency,status,draft_id,decision_id
  )
  select v_push_run_id,v_hotel,v_org,d.stay_date,d.obk_id,d.room_type_name,d.occupancy,
         d.old_price,d.new_price,d.currency,'queued',d.id,v_decision_id
    from public.revenue_rate_drafts d
   where d.push_run_id = v_push_run_id and d.status='draft' and d.superseded_at is null;
  get diagnostics v_items = row_count;

  if v_items <> v_cell_count then
    raise exception 'Atomic AI queue aborted: expected % push items but created %', v_cell_count, v_items;
  end if;
  if exists (
    select 1 from public.revenue_rate_push_items i
     where i.run_id=v_push_run_id and i.status <> 'queued'
  ) then
    raise exception 'Atomic AI queue aborted: a push-item safety trigger rejected part of the stay-date column';
  end if;

  return jsonb_build_object(
    'ok',true,'dry_run',false,'hotel_id',v_hotel,'stay_date',p_stay_date,'delta_eur',p_delta,
    'mapped_cells',v_cell_count,'decision_id',v_decision_id,'automation_run_id',v_run_id,'push_run_id',v_push_run_id,
    'queue_priority',10,'actor_name','HotelCare AI','decision_reason',p_decision_reason,'reason_detail',p_reason_detail,
    'message','Whole Ottofiori stay-date column queued atomically; server-side publisher will deliver it.'
  );
end;
$function$

;
