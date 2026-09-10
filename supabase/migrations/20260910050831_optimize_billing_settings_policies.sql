-- Keep billing settings access unchanged while evaluating auth helpers once per
-- statement. Split writes by operation so the admin policy no longer overlaps
-- the organization SELECT policy.

drop policy if exists billing_settings_admin_write on public.billing_settings;
drop policy if exists billing_settings_read_own_org on public.billing_settings;

create policy billing_settings_read_own_org
on public.billing_settings
for select
to authenticated
using (
  organization_slug = (select public.pi_user_org())
  or (select public.is_super_admin((select auth.uid())))
  or (select public.get_current_user_role()) = 'admin'::public.user_role
);

create policy billing_settings_admin_insert
on public.billing_settings
for insert
to authenticated
with check (
  (select public.is_super_admin((select auth.uid())))
  or (select public.get_current_user_role()) = 'admin'::public.user_role
);

create policy billing_settings_admin_update
on public.billing_settings
for update
to authenticated
using (
  (select public.is_super_admin((select auth.uid())))
  or (select public.get_current_user_role()) = 'admin'::public.user_role
)
with check (
  (select public.is_super_admin((select auth.uid())))
  or (select public.get_current_user_role()) = 'admin'::public.user_role
);

create policy billing_settings_admin_delete
on public.billing_settings
for delete
to authenticated
using (
  (select public.is_super_admin((select auth.uid())))
  or (select public.get_current_user_role()) = 'admin'::public.user_role
);
