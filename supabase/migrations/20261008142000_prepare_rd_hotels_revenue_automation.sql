-- Prepare RD Hotels properties with the exact current Ottofiori revenue configuration.
-- Safety invariant: all target properties remain master-disabled after this migration.
-- Turning the existing hotel-level Automation switch on is the only action that
-- makes the preloaded live/publish sub-settings eligible to run.

do $$
declare
  v_target text;
  v_copy_columns text;
  v_source_columns text;
  v_update_columns text;
  v_inventory integer;
begin
  if not exists (
    select 1 from public.revenue_pickup_automation_rules
    where hotel_id = 'ottofiori' and name = 'Pickup pricing'
  ) then
    raise exception 'Ottofiori Pickup pricing rule is required before preparing RD Hotels automation';
  end if;

  -- Copy configuration fields dynamically so the prepared hotels stay aligned
  -- with the Ottofiori rule schema without copying identity, runtime state, or
  -- property-specific inventory. This also picks up optional same-day settings
  -- when that migration is present.
  select
    string_agg(format('%I', column_name), ', ' order by ordinal_position),
    string_agg(format('src.%I', column_name), ', ' order by ordinal_position),
    string_agg(format('%1$I = excluded.%1$I', column_name), ', ' order by ordinal_position)
  into v_copy_columns, v_source_columns, v_update_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'revenue_pickup_automation_rules'
    and is_generated = 'NEVER'
    and column_name <> all (array[
      'id','hotel_id','name','is_enabled','expected_sellable_rooms','version',
      'created_by','updated_by','created_at','updated_at',
      'last_run_at','next_run_at','last_evaluated_at','last_successful_evaluation_at',
      'last_evaluation_status','last_evaluation_error',
      'shadow_started_at','gate_results','auto_pause_reason','live_activated_at',
      'min_stay_shadow_started_at','min_stay_live_activated_at',
      'same_day_last_checked_at','same_day_handover_date','same_day_floor_alerted_at',
      'same_day_last_status','same_day_last_error'
    ]);

  foreach v_target in array array['gozsdu-court','mika-downtown','memories-budapest']
  loop
    select s.rooms_available::integer
      into v_inventory
      from public.revenue_daily_snapshots s
     where s.hotel_id = v_target
       and s.rooms_available is not null
       and s.rooms_available > 0
     order by s.captured_at desc nulls last, s.stay_date asc
     limit 1;

    if v_inventory is null then
      raise exception 'Cannot prepare %: no sellable inventory snapshot is available', v_target;
    end if;

    execute format(
      $sql$
      insert into public.revenue_pickup_automation_rules (
        id, hotel_id, name, is_enabled, expected_sellable_rooms, created_at, updated_at, %s
      )
      select
        gen_random_uuid(), %L, src.name, false, %s, now(), now(), %s
      from public.revenue_pickup_automation_rules src
      where src.hotel_id = 'ottofiori' and src.name = 'Pickup pricing'
      on conflict (hotel_id, name) do update set
        is_enabled = false,
        expected_sellable_rooms = excluded.expected_sellable_rooms,
        updated_at = now(),
        next_run_at = null,
        last_run_at = null,
        last_evaluated_at = null,
        last_successful_evaluation_at = null,
        last_evaluation_status = null,
        last_evaluation_error = null,
        shadow_started_at = null,
        gate_results = null,
        auto_pause_reason = null,
        live_activated_at = null,
        min_stay_shadow_started_at = null,
        min_stay_live_activated_at = null,
        %s
      $sql$,
      v_copy_columns,
      v_target,
      v_inventory,
      v_source_columns,
      v_update_columns
    );

    -- Engine V2's lockstep bounds come from revenue_price_floors, not only
    -- from the main rule row. Clone Ottofiori's exact safety/floor rows so a
    -- prepared hotel never falls back to the generic EUR 1 safety minimum.
    delete from public.revenue_price_floors where hotel_id = v_target;
    insert into public.revenue_price_floors (
      hotel_id, organization_slug, room_type_name, occupancy, min_price, max_price,
      occupancy_supplement, is_global_safety_max, notes, created_at, updated_at
    )
    select
      v_target, organization_slug, room_type_name, occupancy, min_price, max_price,
      occupancy_supplement, is_global_safety_max,
      concat('RD Hotels Ottofiori baseline · ', coalesce(notes, 'Revenue safety floor')),
      now(), now()
    from public.revenue_price_floors
    where hotel_id = 'ottofiori';

    -- Pace bands are part of the Engine V2 decision input. Keep the target
    -- properties on the same D+ occupancy curve as the live Ottofiori engine.
    delete from public.revenue_pace_targets where hotel_id = v_target;
    insert into public.revenue_pace_targets (
      hotel_id, organization_slug, min_days_out, max_days_out,
      target_occupancy_pct, month, weekday, created_at, updated_at
    )
    select
      v_target, organization_slug, min_days_out, max_days_out,
      target_occupancy_pct, month, weekday, now(), now()
    from public.revenue_pace_targets
    where hotel_id = 'ottofiori';
  end loop;

  -- Defense in depth: assert the migration itself never activates a target.
  if exists (
    select 1
    from public.revenue_pickup_automation_rules
    where hotel_id = any(array['gozsdu-court','mika-downtown','memories-budapest'])
      and name = 'Pickup pricing'
      and is_enabled is true
  ) then
    raise exception 'Safety check failed: a prepared target hotel was activated';
  end if;
end
$$;
