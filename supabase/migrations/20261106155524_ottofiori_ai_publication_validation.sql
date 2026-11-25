-- Identical measured-pickup publication rules for both pricing layers.
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
  if exists(select 1 from public.revenue_date_decisions where hotel_id='ottofiori' and stay_date=p_stay_date and decision_reason='event_demand_protected' and created_at>=now()-interval '1 hour') and not ((v_date->>'occ')::numeric<70 and (v_date->>'left')::int>=5 and (v_date->>'pickup_6h')::int=0 and (coalesce((v_date->>'quiet_hours')::numeric>=24,false) or (v_date->>'occ')::numeric=0) and abs(p_delta)<=2) then raise exception 'A verified high-impact event protects this date'; end if;
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
       and v_movement <= case when v_days_out <= 7 then 1 else 2 end
       and new.old_price is not null
       and new.target_price - new.old_price = v_movement
     ) then
    new.status := 'failed';
    new.error := 'Safety blocked: one net booking with soft occupancy is not enough to increase price.';
    new.claimed_at := null;
    return new;
  end if;

  return new;
end;
$function$
;
