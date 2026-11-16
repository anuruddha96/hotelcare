-- Ottofiori sell-out-late policy — database side (applied to production on
-- 2026-11-14/15 through the Supabase MCP; recorded here so the repo stays the
-- source of truth). Companion code: PRs #847, #848, #861 and this PR.
--
-- 1. revenue_rule_backups: snapshot table used before policy changes.
-- 2. enforce_ottofiori_push_direction_integrity: single-booking rises may be
--    the full ladder step (<= EUR 80) from the planner or the AI supervisor.
-- 3. ottofiori_ai_apply: AI authority 15% of the reference <= 14 days, 25%
--    beyond (EUR 10-80); rises on pickup / scarcity / occupancy / verified
--    event; never cut >= 85% occupancy or <= 3 rooms; floor/ceiling from rule.
-- 4. ottofiori_ai_context: floor, ceiling, policy, pace targets and the Price
--    Signal per date.
--
-- Configuration applied with the same change (not repeated here; see
-- revenue_rule_backups for the previous values): revenue_pace_targets
-- (95/90/82/70/55/40/10/5/3), revenue_price_floors (60/70/85/100, ceiling
-- 550), revenue_pickup_automation_rules v64 (ladders, window caps,
-- min_movement_eur 3, markdown_max_occupancy_pct 80, fill 14 d / 15%).

create table if not exists public.revenue_rule_backups (
  id uuid primary key default gen_random_uuid(),
  hotel_id text not null,
  taken_at timestamptz not null default now(),
  note text,
  rule jsonb not null,
  pace_targets jsonb,
  price_floors jsonb
);
alter table public.revenue_rule_backups enable row level security;
revoke all on public.revenue_rule_backups from anon, authenticated;

CREATE OR REPLACE FUNCTION public.ottofiori_ai_context(p_stay_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
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
), holds as (
 select stay_date,max(case when hold_kind='hard' then hold_until else hold_until+interval '4 hours' end) manager_hold_until
 from public.revenue_manual_hold_state('ottofiori',now()-interval '4 hours',array['cell-edit','cell-selection','day-tool','bulk','bulk-edit','manual','quick-adjust']) group by stay_date
), sig as (
 -- Price Signal: the same demand score the calendar shows managers.
 select stay_date, score, band, action from public.revenue_price_signals('ottofiori',
   (now() at time zone 'Europe/Budapest')::date, (now() at time zone 'Europe/Budapest')::date+120)
 where p_stay_date is null or stay_date=p_stay_date
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
 'signal',case when g.score is null then null else jsonb_build_object('score',g.score,'band',g.band,'action',g.action) end,
 'manager_hold_until',h.manager_hold_until,'engine_reason',e.decision_reason,'pace',e.pace_target_pct) fact
 from dates d left join priced p using(stay_date) left join bookings b using(stay_date) left join movement m using(stay_date) left join holds h using(stay_date)
 left join sig g using(stay_date)
 left join lateral(select rooms_sold,rooms_available,occupancy_pct from public.revenue_daily_snapshots
 where hotel_id='ottofiori' and stay_date=d.stay_date order by captured_at desc limit 1) s on true
 left join public.revenue_competitor_market_daily c on c.hotel_id='ottofiori' and c.stay_date=d.stay_date
 left join lateral(select decision_reason,pace_target_pct from public.revenue_date_decisions
 where hotel_id='ottofiori' and stay_date=d.stay_date order by created_at desc limit 1) e on true
)
select jsonb_build_object('dates',(select jsonb_agg(fact) from facts),
 'rule',(select jsonb_build_object('windows',window_rules,
   'floor',coalesce(minimum_adr,60),
   'ceiling',coalesce((select max(max_price) from public.revenue_price_floors where hotel_id='ottofiori'),550),
   'policy','Sell out late at the highest ADR. AI authority per review: 15% of the reference inside 14 days, 25% beyond (EUR 10-80). Never cut >=85% occupancy or <=3 rooms left. signal = Price Signal 0-100 (surge>=80 strong>=60 on_pace>=40 soft>=20 weak) with the recommended direction; it is built from the same facts as this context.',
   'max_markdowns',max_markdowns_per_day,'monthly_adr_targets',monthly_adr_targets,
   'pace_targets',(select jsonb_agg(jsonb_build_object('min_days_out',min_days_out,'max_days_out',max_days_out,'target_occupancy_pct',target_occupancy_pct) order by min_days_out) from public.revenue_pace_targets where hotel_id='ottofiori'))
 from public.revenue_pickup_automation_rules where hotel_id='ottofiori' and organization_slug='rdhotels' limit 1),
 'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from (select title,event_date,end_date,expected_impact,approved,confidence,url,source from public.demand_events
 where hotel_id='ottofiori' and coalesce(end_date,event_date)>=(now() at time zone 'Europe/Budapest')::date
 and event_date<=(now() at time zone 'Europe/Budapest')::date+120 and approved=true order by (expected_impact='high') desc,event_date limit 150) e),
 'history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) from (select distinct on(stay_date) stay_date,occupancy_pct,adr_eur,revpar_eur
 from public.revenue_historical_daily where p_stay_date is null and hotel_id='ottofiori' and stay_date between (now() at time zone 'Europe/Budapest')::date-interval '1 year'
 and (now() at time zone 'Europe/Budapest')::date+120-interval '1 year' order by stay_date,observed_date desc limit 121) h))
$function$;

CREATE OR REPLACE FUNCTION public.enforce_ottofiori_push_direction_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_direction text;
  v_movement numeric;
  v_pickup24 integer;
  v_cancellations24 integer;
  v_occupancy numeric;
  v_pace_target numeric;
  v_rooms_remaining integer;
  v_days_out integer;
  v_reason text;
  v_draft_old numeric;
  v_draft_target numeric;
begin
  if new.hotel_id <> 'ottofiori' or new.decision_id is null then
    return new;
  end if;

  if new.draft_id is not null then
    select d.old_price, d.new_price
      into v_draft_old, v_draft_target
      from public.revenue_rate_drafts d
     where d.id = new.draft_id;
    if found then
      if v_draft_old is not null then new.old_price := v_draft_old; end if;
      if v_draft_target is not null then new.target_price := v_draft_target; end if;
    end if;
  end if;

  select d.direction, d.movement, d.pickup_24h, d.cancellations_24h,
         d.occupancy_pct, d.pace_target_pct, d.rooms_remaining,
         d.days_out, d.decision_reason
    into v_direction, v_movement, v_pickup24, v_cancellations24,
         v_occupancy, v_pace_target, v_rooms_remaining,
         v_days_out, v_reason
    from public.revenue_date_decisions d
   where d.id = new.decision_id;

  if not found then return new; end if;

  if v_direction = 'hold' or coalesce(v_movement, 0) = 0 then
    new.status := 'failed';
    new.error := 'Safety blocked: a HOLD date decision cannot publish a price movement.';
    new.claimed_at := null;
    return new;
  end if;

  if new.old_price is not null then
    if v_direction = 'increase' and new.target_price <= new.old_price then
      new.status := 'failed';
      new.error := 'Safety blocked: an INCREASE date decision produced a non-increasing child cell.';
      new.claimed_at := null;
      return new;
    end if;
    if v_direction = 'decrease' and new.target_price >= new.old_price then
      new.status := 'failed';
      new.error := 'Safety blocked: a DECREASE date decision produced a non-decreasing child cell.';
      new.claimed_at := null;
      return new;
    end if;
  end if;

  -- One net booking on a soft date: the rise must come from the planner or
  -- the AI supervisor, be bounded, and move this cell by exactly the decision.
  if v_direction = 'increase'
     and greatest(0, coalesce(v_pickup24, 0) - coalesce(v_cancellations24, 0)) = 1
     and not (
       coalesce(v_occupancy, 0) >= 85
       or (
         coalesce(v_occupancy, 0) >= 50
         and v_pace_target is not null
         and v_occupancy >= v_pace_target + 10
       )
     )
     and coalesce(v_rooms_remaining, 99) > 2
     and not (
       v_reason in ('revenue_director_yield','ai_supervisor')
       and v_movement > 0
       and v_movement <= 80
       and new.old_price is not null
       and new.target_price - new.old_price = v_movement
     ) then
    new.status := 'failed';
    new.error := 'Safety blocked: a single-booking rise must come from the planner or AI supervisor and stay within the EUR 80 ladder limit.';
    new.claimed_at := null;
    return new;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ottofiori_ai_apply(p_review_id uuid, p_stay_date date, p_delta integer, p_expected_cells jsonb, p_reason text, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_context jsonb; v_date jsonb; v_rule record; v_window jsonb; v_current jsonb;
 v_cap numeric; v_spent numeric; v_last timestamptz; v_days int; v_result jsonb; v_peak numeric;
 v_ref numeric; v_occ numeric; v_left int; v_limit int; v_floor numeric; v_ceiling numeric; v_high_event boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('ottofiori-ai-'||p_stay_date::text,0));
 if not exists(select 1 from public.ottofiori_ai_review_runs where id=p_review_id and status='running' and started_at>=now()-interval '8 minutes' and pms_refreshed_at>=now()-interval '8 minutes') then
 raise exception 'A current supervisor review is required'; end if;
 if not exists(select 1 from public.revenue_engine_config where id='global' and automation_enabled and not dry_run
 and automation_lock_hotel='ottofiori' and automation_lock_at>=now()-interval '8 minutes') then
 raise exception 'Shared automation lease is required and global automation must be live'; end if;
 select * into strict v_rule from public.revenue_pickup_automation_rules where hotel_id='ottofiori' and organization_slug='rdhotels' and is_enabled and mode='live' limit 1;
 v_days:=p_stay_date-(now() at time zone 'Europe/Budapest')::date;
 if v_days<0 or v_days>120 or p_delta is null or length(btrim(p_reason))<20 then
 raise exception 'Invalid AI date, whole-euro step, or rationale'; end if;
 select public.ottofiori_ai_context(p_stay_date) into v_context;
 select value into v_date from jsonb_array_elements(v_context->'dates') where value->>'date'=p_stay_date::text;
 if v_date is null or v_date->>'occ' is null or v_date->>'reference' is null or (v_date->>'left')::int<=0
 or jsonb_array_length(v_date->'cells')<>13 or (v_date->>'captured_at')::timestamptz<now()-interval '30 minutes' then
 raise exception 'Fresh complete mapped prices and sellable occupancy are required'; end if;
 v_ref:=(v_date->>'reference')::numeric; v_occ:=(v_date->>'occ')::numeric; v_left:=(v_date->>'left')::int;
 v_floor:=coalesce((v_context->'rule'->>'floor')::numeric,60); v_ceiling:=coalesce((v_context->'rule'->>'ceiling')::numeric,550);
 -- Authority per review: 15% of the reference inside 14 days, 25% beyond, EUR 10-80 (mirrors aiMoveLimit in code).
 v_limit:=least(80,greatest(10,round(v_ref*(case when v_days<=14 then 0.15 else 0.25 end))));
 if abs(p_delta)>v_limit then raise exception 'AI step % exceeds the % EUR authority for this date', p_delta, v_limit; end if;
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
 v_high_event:=exists(select 1 from jsonb_array_elements(coalesce(v_context->'events','[]'::jsonb)) e
   where lower(e->>'expected_impact')='high' and (e->>'approved')::boolean and coalesce((e->>'confidence')::numeric,0)>=0.8
   and p_stay_date between (e->>'event_date')::date and coalesce((e->>'end_date')::date,(e->>'event_date')::date));
 if p_delta<0 then
  if (v_date->>'min_price')::numeric+p_delta < v_floor then raise exception 'The cheapest cell would fall below the EUR % floor', v_floor; end if;
  if (v_date->>'pickup_6h')::int>=2 or coalesce((v_date->>'quiet_hours')::numeric,10000)<coalesce((v_window->>'no_pickup_wait_hours')::numeric,6) then raise exception 'Recent genuine demand protects this offer'; end if;
  if v_occ>=85 then raise exception 'Strong occupancy (>=85%%) is never discounted'; end if;
  if v_left<=3 then raise exception 'Scarce inventory (<=3 rooms) is never discounted'; end if;
  if v_high_event and not (v_occ<70 and v_left>=5 and (v_date->>'pickup_6h')::int=0 and (coalesce((v_date->>'quiet_hours')::numeric>=24,false) or v_occ=0) and abs(p_delta)<=greatest(5,round(v_ref*0.08))) then raise exception 'A verified high-impact event protects this date'; end if;
  if exists(select 1 from public.revenue_cancelled_nights where hotel_id='ottofiori' and stay_date=p_stay_date and cancelled_at>=now()-interval '1 hour') then raise exception 'Cancellation cooldown is active'; end if;
  v_cap:=(v_window->>'max_daily_decrease')::numeric; v_spent:=(v_date->>'down_today')::numeric;
  if v_cap is null or v_cap<=0 or v_spent+abs(p_delta)>v_cap or (v_date->>'markdowns_today')::int>=v_rule.max_markdowns_per_day then raise exception 'Shared daily markdown allowance is exhausted'; end if;
  select max(greatest(current_price,target_price)) into v_peak from public.revenue_date_decisions where hotel_id='ottofiori' and stay_date=p_stay_date and created_at>=now()-interval '96 hours';
  if v_ref+p_delta < coalesce(v_peak,v_ref)*(1-coalesce(v_rule.markdown_depth_pct,15)/100) then raise exception 'Campaign markdown depth is protected'; end if;
 elsif p_delta>0 then
  if (v_date->>'max_price')::numeric+p_delta > v_ceiling then raise exception 'The highest cell would exceed the EUR % ceiling', v_ceiling; end if;
  -- Demand evidence for a rise: fresh pickup, scarcity, strong occupancy or a verified high-impact event.
  if not ((v_date->>'pickup_6h')::int>=1 or (v_date->>'pickup_48h')::int>=1 or v_left<=5 or v_occ>=70 or v_high_event) then
   raise exception 'No demand evidence (pickup, scarcity, occupancy or verified event) supports a rise'; end if;
  v_cap:=(v_window->>'max_daily_increase')::numeric;v_spent:=(v_date->>'up_today')::numeric;
  if v_cap is null or v_spent+p_delta>v_cap then raise exception 'Shared daily increase allowance is exhausted'; end if;
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
end $function$;
