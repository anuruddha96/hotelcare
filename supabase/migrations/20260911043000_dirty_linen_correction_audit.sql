-- Durable audit trail for dirty-linen corrections.
-- The trigger records inserts, updates and removals made by housekeepers,
-- managers, top management or service processes without changing the
-- existing dirty_linen_counts workflow.

create table if not exists public.dirty_linen_correction_audit (
  id uuid primary key default gen_random_uuid(),
  source_row_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  housekeeper_id uuid not null references public.profiles(id) on delete restrict,
  room_id uuid not null references public.rooms(id) on delete restrict,
  assignment_id uuid references public.room_assignments(id) on delete set null,
  linen_item_id uuid not null references public.dirty_linen_items(id) on delete restrict,
  work_date date not null,
  old_count integer,
  new_count integer,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_by_name text,
  organization_slug text,
  hotel text,
  room_number text,
  linen_item_name text,
  created_at timestamptz not null default now()
);

create index if not exists dirty_linen_correction_audit_housekeeper_date_idx
  on public.dirty_linen_correction_audit (housekeeper_id, work_date desc, created_at desc);

create index if not exists dirty_linen_correction_audit_room_date_idx
  on public.dirty_linen_correction_audit (room_id, work_date desc, created_at desc);

alter table public.dirty_linen_correction_audit enable row level security;

drop policy if exists "Managers can view dirty linen correction audit" on public.dirty_linen_correction_audit;
create policy "Managers can view dirty linen correction audit"
  on public.dirty_linen_correction_audit
  for select
  to authenticated
  using (
    public.is_super_admin(auth.uid())
    or (
      public.is_top_management(auth.uid())
      and (organization_slug is null or organization_slug = public.get_user_organization_slug(auth.uid()))
    )
    or (
      public.get_user_role(auth.uid()) in ('manager'::public.user_role, 'housekeeping_manager'::public.user_role, 'admin'::public.user_role)
      and (organization_slug is null or organization_slug = public.get_user_organization_slug(auth.uid()))
      and (
        hotel = public.get_user_assigned_hotel(auth.uid())
        or hotel = (
          select hc.hotel_name
          from public.hotel_configurations hc
          where hc.hotel_id = public.get_user_assigned_hotel(auth.uid())
          limit 1
        )
      )
    )
  );

grant select on public.dirty_linen_correction_audit to authenticated;

create or replace function public.audit_dirty_linen_count_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.dirty_linen_counts%rowtype;
  v_changed_by uuid := auth.uid();
  v_changed_by_name text;
  v_hotel text;
  v_room_number text;
  v_linen_name text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  select coalesce(p.nickname, p.full_name, p.email)
    into v_changed_by_name
    from public.profiles p
   where p.id = v_changed_by;

  select r.hotel, r.room_number
    into v_hotel, v_room_number
    from public.rooms r
   where r.id = v_row.room_id;

  select i.display_name
    into v_linen_name
    from public.dirty_linen_items i
   where i.id = v_row.linen_item_id;

  insert into public.dirty_linen_correction_audit (
    source_row_id,
    action,
    housekeeper_id,
    room_id,
    assignment_id,
    linen_item_id,
    work_date,
    old_count,
    new_count,
    changed_by,
    changed_by_name,
    organization_slug,
    hotel,
    room_number,
    linen_item_name
  ) values (
    v_row.id,
    tg_op,
    v_row.housekeeper_id,
    v_row.room_id,
    v_row.assignment_id,
    v_row.linen_item_id,
    v_row.work_date,
    case when tg_op in ('UPDATE', 'DELETE') then old.count else null end,
    case when tg_op in ('INSERT', 'UPDATE') then new.count else null end,
    v_changed_by,
    coalesce(v_changed_by_name, case when v_changed_by is null then 'System' else 'User' end),
    coalesce(v_row.organization_slug, (select p.organization_slug from public.profiles p where p.id = v_row.housekeeper_id)),
    v_hotel,
    v_room_number,
    v_linen_name
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_dirty_linen_count_change_trigger on public.dirty_linen_counts;
create trigger audit_dirty_linen_count_change_trigger
  after insert or update of count or delete
  on public.dirty_linen_counts
  for each row
  execute function public.audit_dirty_linen_count_change();
