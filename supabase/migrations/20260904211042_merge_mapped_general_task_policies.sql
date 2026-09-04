-- Extend the existing general-task policies for mapped section work without
-- adding a second permissive policy for the same action. Existing access is
-- preserved; top management and supervisors gain access only to mapped tasks
-- for a property they can access.

drop policy if exists "Eligible managers manage mapped section tasks"
  on public.general_tasks;
drop policy if exists "Staff can view their general tasks"
  on public.general_tasks;
drop policy if exists "Managers can create general tasks"
  on public.general_tasks;
drop policy if exists "Assigned staff and managers can update general tasks"
  on public.general_tasks;
drop policy if exists "Managers can delete general tasks"
  on public.general_tasks;

create policy "Staff can view their general tasks"
on public.general_tasks for select to authenticated
using (
  assigned_to = (select auth.uid())
  or assigned_by = (select auth.uid())
  or public.get_user_role((select auth.uid()))::text in (
    'housekeeping_manager', 'manager', 'admin'
  )
  or (
    housekeeping_section_task_id is not null
    and public.get_user_role((select auth.uid()))::text in (
      'top_management', 'top_management_manager', 'supervisor'
    )
    and public.user_can_access_hotel((select auth.uid()), hotel)
  )
);

create policy "Managers can create general tasks"
on public.general_tasks for insert to authenticated
with check (
  assigned_by = (select auth.uid())
  and (
    public.get_user_role((select auth.uid()))::text in (
      'housekeeping_manager', 'manager', 'admin'
    )
    or (
      housekeeping_section_task_id is not null
      and public.get_user_role((select auth.uid()))::text in (
        'top_management', 'top_management_manager', 'supervisor'
      )
      and public.user_can_access_hotel((select auth.uid()), hotel)
    )
  )
);

create policy "Assigned staff and managers can update general tasks"
on public.general_tasks for update to authenticated
using (
  assigned_to = (select auth.uid())
  or public.get_user_role((select auth.uid()))::text in (
    'housekeeping_manager', 'manager', 'admin'
  )
  or (
    housekeeping_section_task_id is not null
    and public.get_user_role((select auth.uid()))::text in (
      'top_management', 'top_management_manager', 'supervisor'
    )
    and public.user_can_access_hotel((select auth.uid()), hotel)
  )
);

create policy "Managers can delete general tasks"
on public.general_tasks for delete to authenticated
using (
  public.get_user_role((select auth.uid()))::text in (
    'housekeeping_manager', 'manager', 'admin'
  )
  or (
    housekeeping_section_task_id is not null
    and public.get_user_role((select auth.uid()))::text in (
      'top_management', 'top_management_manager', 'supervisor'
    )
    and public.user_can_access_hotel((select auth.uid()), hotel)
  )
);
