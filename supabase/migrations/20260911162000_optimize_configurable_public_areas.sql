-- Follow-up performance hardening for venue-scoped public areas.
-- Keep the auth user id as an initplan value inside RLS and cover the
-- created_by foreign key used for audit lookups.

create index if not exists hotel_public_areas_created_by_idx
  on public.hotel_public_areas (created_by);

drop policy if exists "Hotel staff view public areas" on public.hotel_public_areas;
create policy "Hotel staff view public areas"
on public.hotel_public_areas for select to authenticated
using (
  public.user_can_access_hotel((select auth.uid()), hotel_name)
);

drop policy if exists "Eligible managers create public areas" on public.hotel_public_areas;
create policy "Eligible managers create public areas"
on public.hotel_public_areas for insert to authenticated
with check (
  (
    public.is_super_admin((select auth.uid()))
    or public.get_user_role((select auth.uid()))::text in (
      'admin', 'top_management', 'top_management_manager', 'manager',
      'housekeeping_manager', 'supervisor', 'reception_manager',
      'back_office_manager'
    )
  )
  and public.user_can_access_hotel((select auth.uid()), hotel_name)
  and created_by = (select auth.uid())
);

drop policy if exists "Eligible managers update public areas" on public.hotel_public_areas;
create policy "Eligible managers update public areas"
on public.hotel_public_areas for update to authenticated
using (
  (
    public.is_super_admin((select auth.uid()))
    or public.get_user_role((select auth.uid()))::text in (
      'admin', 'top_management', 'top_management_manager', 'manager',
      'housekeeping_manager', 'supervisor', 'reception_manager',
      'back_office_manager'
    )
  )
  and public.user_can_access_hotel((select auth.uid()), hotel_name)
)
with check (
  (
    public.is_super_admin((select auth.uid()))
    or public.get_user_role((select auth.uid()))::text in (
      'admin', 'top_management', 'top_management_manager', 'manager',
      'housekeeping_manager', 'supervisor', 'reception_manager',
      'back_office_manager'
    )
  )
  and public.user_can_access_hotel((select auth.uid()), hotel_name)
);
