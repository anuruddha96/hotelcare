-- Shared helpers are operational collaboration, not a manager correction of the
-- algorithm's primary assignment. Exclude them from both model samples and
-- correction evidence, and validate manager-correction metadata before insert.

create or replace function public.validate_next_day_learning_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_changed boolean := false;
  v_suggested uuid;
begin
  v_role := coalesce(
    nullif(new.recommendation_context ->> 'assignment_role',''),
    case when new.source = 'shared' then 'shared' else 'primary' end
  );

  begin
    v_changed := coalesce((new.recommendation_context ->> 'manager_changed')::boolean, false);
  exception when others then
    raise exception 'manager_changed must be boolean';
  end;

  if v_role = 'shared' then
    if new.source <> 'shared' or v_changed then
      raise exception 'Shared helper rows cannot be manager-correction learning evidence';
    end if;
    return new;
  end if;

  if v_changed and new.source <> 'manager' then
    raise exception 'Only explicit manager reassignment rows may set manager_changed';
  end if;

  if new.source = 'manager' and v_changed then
    begin
      v_suggested := nullif(new.recommendation_context ->> 'suggested_staff_id','')::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid suggested housekeeper id';
    end;

    if v_suggested is null or v_suggested = new.assigned_to then
      raise exception 'A manager correction requires a different original suggested housekeeper';
    end if;

    if not exists (
      select 1
      from public.next_day_housekeeping_plan_staff staff
      where staff.plan_id = new.plan_id
        and staff.user_id = v_suggested
        and staff.selected = true
    ) then
      raise exception 'The original suggested housekeeper must belong to the selected plan staff';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_next_day_learning_metadata() from public;

drop trigger if exists zz_validate_next_day_learning_metadata_trigger
  on public.next_day_housekeeping_plan_items;
create trigger zz_validate_next_day_learning_metadata_trigger
before insert or update of source, assigned_to, recommendation_context
on public.next_day_housekeeping_plan_items
for each row execute function public.validate_next_day_learning_metadata();

create or replace function public.refresh_housekeeping_assignment_learning_profile(
  p_organization_slug text,
  p_hotel_id text
)
returns public.housekeeping_assignment_learning_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sample_count integer := 0;
  v_correction_count integer := 0;
  v_confidence numeric(5,4) := 0;
  v_preferences jsonb := '{}'::jsonb;
  v_diagnostics jsonb := '{}'::jsonb;
  v_last_correction timestamptz;
  v_result public.housekeeping_assignment_learning_profiles;
begin
  if auth.uid() is not null
     and not public.can_manage_next_day_housekeeping_plan(p_organization_slug, p_hotel_id) then
    raise exception 'Not allowed to refresh housekeeping learning for this hotel';
  end if;

  select count(*)::integer
  into v_sample_count
  from public.next_day_housekeeping_plan_items i
  join public.next_day_housekeeping_plans p on p.id = i.plan_id
  where p.organization_slug = p_organization_slug
    and p.hotel_id = p_hotel_id
    and p.status in ('approved','released')
    and p.plan_date >= current_date - 120
    and coalesce(
      nullif(i.recommendation_context ->> 'assignment_role',''),
      case when i.source = 'shared' then 'shared' else 'primary' end
    ) = 'primary';

  select count(*)::integer, max(e.created_at)
  into v_correction_count, v_last_correction
  from public.housekeeping_assignment_learning_events e
  join public.next_day_housekeeping_plans p on p.id = e.plan_id
  join public.next_day_housekeeping_plan_items i on i.id = e.plan_item_id
  where e.organization_slug = p_organization_slug
    and e.hotel_id = p_hotel_id
    and p.status in ('approved','released')
    and e.plan_date >= current_date - 120
    and coalesce(
      nullif(i.recommendation_context ->> 'assignment_role',''),
      case when i.source = 'shared' then 'shared' else 'primary' end
    ) = 'primary';

  v_confidence := least(
    0.9500::numeric,
    round((v_correction_count::numeric / (v_correction_count + 8.0)), 4)
  );

  with eligible_events as (
    select e.*
    from public.housekeeping_assignment_learning_events e
    join public.next_day_housekeeping_plans p on p.id = e.plan_id
    join public.next_day_housekeeping_plan_items i on i.id = e.plan_item_id
    where e.organization_slug = p_organization_slug
      and e.hotel_id = p_hotel_id
      and p.status in ('approved','released')
      and e.plan_date >= current_date - 120
      and coalesce(
        nullif(i.recommendation_context ->> 'assignment_role',''),
        case when i.source = 'shared' then 'shared' else 'primary' end
      ) = 'primary'
  ), tokens as (
    select e.id, e.final_staff_id, e.suggested_staff_id, token
    from eligible_events e
    cross join lateral (
      values
        (case when e.housekeeping_section_id is not null then 'section-' || e.housekeeping_section_id::text end),
        (case when e.floor_number is not null then e.floor_number::text end),
        (nullif(e.wing, ''))
    ) as t(token)
    where token is not null
  ), evidence as (
    select final_staff_id as staff_id, token, 1 as weight from tokens
    union all
    select suggested_staff_id as staff_id, token, -1 as weight from tokens
  ), scored as (
    select
      staff_id,
      token,
      sum(case when weight > 0 then 1 else 0 end)::integer as positive_count,
      sum(case when weight < 0 then 1 else 0 end)::integer as negative_count,
      sum(weight)::integer as net_score
    from evidence
    group by staff_id, token
  ), strong as (
    select *,
      row_number() over (
        partition by staff_id
        order by net_score desc, positive_count desc, token
      ) as preference_rank
    from scored
    where positive_count >= 2
      and net_score >= 1
      and (positive_count - negative_count)::numeric / greatest(1, positive_count + negative_count) >= 0.35
  ), per_staff as (
    select
      staff_id,
      jsonb_agg(token order by net_score desc, positive_count desc, token) as preferences
    from strong
    where preference_rank <= 10
    group by staff_id
  )
  select coalesce(jsonb_object_agg(staff_id::text, preferences), '{}'::jsonb)
  into v_preferences
  from per_staff;

  with eligible_events as (
    select e.*
    from public.housekeeping_assignment_learning_events e
    join public.next_day_housekeeping_plans p on p.id = e.plan_id
    join public.next_day_housekeeping_plan_items i on i.id = e.plan_item_id
    where e.organization_slug = p_organization_slug
      and e.hotel_id = p_hotel_id
      and p.status in ('approved','released')
      and e.plan_date >= current_date - 120
      and coalesce(
        nullif(i.recommendation_context ->> 'assignment_role',''),
        case when i.source = 'shared' then 'shared' else 'primary' end
      ) = 'primary'
  )
  select jsonb_build_object(
    'window_days', 120,
    'explicit_manager_changes_only', true,
    'shared_helpers_excluded', true,
    'correction_rate', case when v_sample_count > 0 then round(v_correction_count::numeric / v_sample_count, 4) else 0 end,
    'staff_with_preferences', jsonb_array_length(coalesce((select jsonb_agg(key) from jsonb_object_keys(v_preferences) key), '[]'::jsonb)),
    'checkout_corrections', count(*) filter (where room_kind = 'checkout'),
    'daily_corrections', count(*) filter (where room_kind = 'daily')
  )
  into v_diagnostics
  from eligible_events;

  insert into public.housekeeping_assignment_learning_profiles (
    organization_slug,
    hotel_id,
    model_version,
    sample_count,
    correction_count,
    confidence_score,
    staff_preferences,
    diagnostics,
    last_correction_at,
    refreshed_at
  ) values (
    p_organization_slug,
    p_hotel_id,
    'manager-correction-v2-shared-safe',
    v_sample_count,
    v_correction_count,
    v_confidence,
    coalesce(v_preferences, '{}'::jsonb),
    coalesce(v_diagnostics, '{}'::jsonb),
    v_last_correction,
    now()
  )
  on conflict (organization_slug, hotel_id) do update set
    model_version = excluded.model_version,
    sample_count = excluded.sample_count,
    correction_count = excluded.correction_count,
    confidence_score = excluded.confidence_score,
    staff_preferences = excluded.staff_preferences,
    diagnostics = excluded.diagnostics,
    last_correction_at = excluded.last_correction_at,
    refreshed_at = excluded.refreshed_at,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.refresh_housekeeping_assignment_learning_profile(text,text) from public;
grant execute on function public.refresh_housekeeping_assignment_learning_profile(text,text) to authenticated;