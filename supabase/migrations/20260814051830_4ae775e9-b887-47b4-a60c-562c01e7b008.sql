create or replace function public.rate_cell_markers(
  p_hotel_id text,
  p_from date,
  p_to date,
  p_since timestamptz
)
returns table(
  stay_date date,
  room_type_name text,
  occupancy int,
  source text,
  performed_at timestamptz,
  performed_by uuid,
  confirmation_status text,
  old_rate_eur numeric,
  new_rate_eur numeric,
  requested_price numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (a.stay_date, a.payload->>'room_type_name', (a.payload->>'occupancy')::int)
    a.stay_date,
    a.payload->>'room_type_name',
    (a.payload->>'occupancy')::int,
    a.source,
    a.performed_at,
    a.performed_by,
    a.payload->>'confirmation_status',
    a.old_rate_eur,
    a.new_rate_eur,
    (a.payload->>'requested_price')::numeric
  from public.rate_change_audit a
  where a.hotel_id = p_hotel_id
    and a.stay_date between p_from and p_to
    and a.performed_at >= p_since
    and a.payload ? 'room_type_name'
    and a.payload ? 'occupancy'
    and a.source = any (array[
      'previo_confirmed','previo_automation_confirmed','previo_bulk_confirmed',
      'previo_external','previo_different','push','push_automation',
      'day-tool','cell-edit','bulk-editor','demand','pickup-board','autopilot'
    ])
    and (a.source <> 'previo_different' or a.payload->>'resolved_at' is null)
  order by a.stay_date, a.payload->>'room_type_name', (a.payload->>'occupancy')::int, a.performed_at desc
$$;

create or replace function public.rate_cell_history(
  p_hotel_id text,
  p_stay_date date,
  p_since timestamptz,
  p_per_cell int default 8
)
returns table(
  id uuid,
  stay_date date,
  action text,
  source text,
  old_rate_eur numeric,
  new_rate_eur numeric,
  delta_eur numeric,
  notes text,
  performed_at timestamptz,
  performed_by uuid,
  payload jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select t.id, t.stay_date, t.action, t.source, t.old_rate_eur, t.new_rate_eur,
         t.delta_eur, t.notes, t.performed_at, t.performed_by, t.payload
  from (
    select a.*,
      row_number() over (
        partition by a.payload->>'room_type_name', (a.payload->>'occupancy')::int
        order by a.performed_at desc
      ) as rn
    from public.rate_change_audit a
    where a.hotel_id = p_hotel_id
      and a.stay_date = p_stay_date
      and a.performed_at >= p_since
      and a.payload ? 'room_type_name'
      and a.payload ? 'occupancy'
      and a.source = any (array[
        'previo_confirmed','previo_automation_confirmed','previo_bulk_confirmed',
        'previo_external','previo_different','push','push_automation',
        'day-tool','cell-edit','bulk-editor','demand','pickup-board','autopilot'
      ])
  ) t
  where t.rn <= greatest(1, least(p_per_cell, 20))
  order by t.performed_at desc
$$;

grant execute on function public.rate_cell_markers(text, date, date, timestamptz) to authenticated;
grant execute on function public.rate_cell_history(text, date, timestamptz, int) to authenticated;