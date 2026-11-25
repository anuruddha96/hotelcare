-- Mirror Previo's native calendar availability ("rooms for sale") per room type/date.
-- Reservations remain the occupancy source; this table preserves manual PMS
-- closures/availability changes that cannot be inferred from bookings alone.

create table if not exists public.revenue_room_type_availability (
  hotel_id text not null,
  organization_slug text not null,
  pms_hotel_id text not null,
  stay_date date not null,
  obk_id text not null,
  availability integer not null check (availability >= 0),
  source text not null default 'previo_calendar_availability',
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (hotel_id, pms_hotel_id, stay_date, obk_id)
);

create index if not exists revenue_room_type_availability_hotel_date_idx
  on public.revenue_room_type_availability (hotel_id, stay_date, obk_id);

alter table public.revenue_room_type_availability enable row level security;

drop policy if exists revenue_room_type_availability_select on public.revenue_room_type_availability;
create policy revenue_room_type_availability_select
  on public.revenue_room_type_availability
  for select
  to authenticated
  using (
    auth.uid() is not null
    and public.user_can_access_hotel(auth.uid(), hotel_id)
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (
          coalesce(p.is_super_admin, false)
          or p.organization_slug = revenue_room_type_availability.organization_slug
        )
    )
  );

grant select on public.revenue_room_type_availability to authenticated;
