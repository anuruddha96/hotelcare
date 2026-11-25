create or replace function public.hotelcare_ai_queue_ottofiori_column(
  p_stay_date date,
  p_delta integer,
  p_decision_reason text,
  p_reason_detail text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
begin
  if p_stay_date is null then
    raise exception 'stay_date is required';
  end if;
  if p_stay_date < v_today or p_stay_date > v_today + 90 then
    raise exception 'HotelCare AI may only change Ottofiori dates from today through the rolling 90-day horizon';
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

  if exists (
    select 1 from public.revenue_rate_drafts
     where hotel_id = v_hotel
       and stay_date = p_stay_date
       and intent_source = 'manual'
       and coalesce(decision_reason, '') not like 'ai\_%' escape '\'
       and created_at >= now() - interval '24 hours'
       and status not in ('failed','superseded')
  ) then
    raise exception 'A human manager price is protected for 24 hours on %', p_stay_date;
  end if;

  if exists (
    select 1
      from public.revenue_rate_push_items i
      join public.revenue_rate_push_runs r on r.id = i.run_id
     where i.hotel_id = v_hotel
       and i.stay_date = p_stay_date
       and (i.status in ('queued','processing') or r.status in ('queued','processing'))
  ) or exists (
    select 1 from public.revenue_rate_drafts d
     where d.hotel_id = v_hotel and d.stay_date = p_stay_date
       and d.superseded_at is null and d.status in ('draft','failed')
  ) then
    raise exception 'An unfinished price publication already exists for %', p_stay_date;
  end if;

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

  if v_cell_count <= 0 then
    raise exception 'No complete mapped Ottofiori rate column is available for %', p_stay_date;
  end if;

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
       and (f.room_type_name is null or f.room_type_name = v_row.room_type_name)
       and (f.occupancy is null or f.occupancy = v_row.occupancy);
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
  v_anchor := v_min_current::integer;

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
         v_decision_id,p_decision_reason,p_reason_detail,null
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
$$;

revoke all on function public.hotelcare_ai_queue_ottofiori_column(date,integer,text,text,boolean) from public;
revoke all on function public.hotelcare_ai_queue_ottofiori_column(date,integer,text,text,boolean) from anon;
revoke all on function public.hotelcare_ai_queue_ottofiori_column(date,integer,text,text,boolean) from authenticated;
grant execute on function public.hotelcare_ai_queue_ottofiori_column(date,integer,text,text,boolean) to service_role;
