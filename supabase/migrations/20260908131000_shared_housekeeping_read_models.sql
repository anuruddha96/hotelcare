-- Read helpers for shared housekeeping UI.

create or replace function public.get_shared_housekeeping_summary(
  user_id uuid,
  target_date date default current_date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'total_assigned', count(*) filter (where status <> 'cancelled'),
    'completed', count(*) filter (where status = 'completed'),
    'in_progress', count(*) filter (where status = 'in_progress'),
    'pending', count(*) filter (where status in ('assigned', 'dnd_pending_retry'))
  )
  from public.room_assignments
  where assignment_date = target_date
    and (assigned_to = user_id or shared_with = user_id);
$$;

grant execute on function public.get_shared_housekeeping_summary(uuid, date) to authenticated;

-- Return non-sensitive display labels for housekeeping actors. This avoids
-- duplicating names on every assignment while still letting both cleaners see
-- who they share with / who started / who confirmed the room.
create or replace function public.get_housekeeping_actor_labels(p_user_ids uuid[])
returns table(user_id uuid, display_name text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id,
         coalesce(
           nullif(u.raw_user_meta_data ->> 'full_name', ''),
           nullif(u.raw_user_meta_data ->> 'name', ''),
           nullif(u.raw_user_meta_data ->> 'display_name', ''),
           nullif(u.raw_user_meta_data ->> 'username', ''),
           split_part(coalesce(u.email, 'Housekeeper'), '@', 1)
         ) as display_name
    from auth.users u
   where u.id = any(coalesce(p_user_ids, array[]::uuid[]));
$$;

revoke all on function public.get_housekeeping_actor_labels(uuid[]) from public;
grant execute on function public.get_housekeeping_actor_labels(uuid[]) to authenticated;
