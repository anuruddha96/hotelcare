create or replace function public.save_next_day_housekeeping_public_area_assignments(
  p_organization_slug text,
  p_hotel_id text,
  p_plan_date date,
  p_assignments jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item jsonb;
  v_count integer := 0;
  v_plan_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_manage_next_day_housekeeping_plan(p_organization_slug, p_hotel_id) then
    raise exception 'Not authorized to manage tomorrow public-area assignments for this hotel';
  end if;

  if p_plan_date < (now() at time zone 'Europe/Budapest')::date then
    raise exception 'Tomorrow public-area assignments cannot target a past date';
  end if;

  select plan.status
    into v_plan_status
  from public.next_day_housekeeping_plans plan
  where plan.organization_slug = p_organization_slug
    and plan.hotel_id = p_hotel_id
    and plan.plan_date = p_plan_date
  limit 1;

  if v_plan_status in ('releasing', 'released') then
    raise exception 'Tomorrow public-area assignments cannot change after release starts';
  end if;

  if p_assignments is null then
    p_assignments := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Assignments must be a JSON array';
  end if;

  delete from public.next_day_housekeeping_public_area_assignments
  where organization_slug = p_organization_slug
    and hotel_id = p_hotel_id
    and plan_date = p_plan_date;

  for v_item in select value from jsonb_array_elements(p_assignments)
  loop
    if nullif(v_item ->> 'public_area_id', '') is null
       or nullif(v_item ->> 'assigned_to', '') is null then
      raise exception 'Each public-area assignment requires public_area_id and assigned_to';
    end if;

    insert into public.next_day_housekeeping_public_area_assignments (
      organization_slug,
      hotel_id,
      plan_date,
      public_area_id,
      assigned_to,
      created_by,
      updated_by
    ) values (
      p_organization_slug,
      p_hotel_id,
      p_plan_date,
      (v_item ->> 'public_area_id')::uuid,
      (v_item ->> 'assigned_to')::uuid,
      auth.uid(),
      auth.uid()
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

grant execute on function public.save_next_day_housekeeping_public_area_assignments(text, text, date, jsonb)
  to authenticated;
