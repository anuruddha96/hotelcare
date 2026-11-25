-- Allow Hotel Memories managers to introduce additional laundry types without
-- changing other venues' shared or fixed catalogues. Existing historical item IDs
-- and the eight approved Memories categories are intentionally left untouched.
create unique index if not exists memories_custom_linen_name_unique
  on public.dirty_linen_items (hotel_scope, name)
  where hotel_scope = 'memories-budapest' and name like 'memories_custom_%';

do $policies$
begin
  if not exists (select 1 from pg_policies
    where schemaname = 'public' and tablename = 'dirty_linen_items'
    and policyname = 'Hotel Memories managers can insert custom linen types') then
    create policy "Hotel Memories managers can insert custom linen types"
      on public.dirty_linen_items
      for insert to authenticated
      with check (
        hotel_scope = 'memories-budapest'
        and name like 'memories_custom_%'
        and get_user_assigned_hotel((select auth.uid())) in ('memories-budapest', 'Hotel Memories Budapest')
        and get_user_organization_slug((select auth.uid())) = 'rdhotels'
        and (
          get_user_role((select auth.uid())) in ('housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role)
          or is_top_management((select auth.uid()))
        )
      );
  end if;

  if not exists (select 1 from pg_policies
    where schemaname = 'public' and tablename = 'dirty_linen_items'
    and policyname = 'Hotel Memories managers can update custom linen types') then
    create policy "Hotel Memories managers can update custom linen types"
      on public.dirty_linen_items
      for update to authenticated
      using (
        hotel_scope = 'memories-budapest'
        and name like 'memories_custom_%'
        and get_user_assigned_hotel((select auth.uid())) in ('memories-budapest', 'Hotel Memories Budapest')
        and get_user_organization_slug((select auth.uid())) = 'rdhotels'
        and (
          get_user_role((select auth.uid())) in ('housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role)
          or is_top_management((select auth.uid()))
        )
      )
      with check (
        hotel_scope = 'memories-budapest'
        and name like 'memories_custom_%'
        and get_user_assigned_hotel((select auth.uid())) in ('memories-budapest', 'Hotel Memories Budapest')
        and get_user_organization_slug((select auth.uid())) = 'rdhotels'
        and (
          get_user_role((select auth.uid())) in ('housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role)
          or is_top_management((select auth.uid()))
        )
      );
  end if;
end;
$policies$;
