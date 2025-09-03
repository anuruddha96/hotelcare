-- Create table to control ticket creation permissions per role and per user
create table if not exists public.ticket_creation_config (
  id uuid primary key default gen_random_uuid(),
  role user_role null,
  user_id uuid null references auth.users(id) on delete cascade,
  can_create boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_creation_config_role_or_user check (role is not null or user_id is not null)
);

-- Unique partial indexes to avoid duplicates
create unique index if not exists uq_ticket_creation_role on public.ticket_creation_config(role) where role is not null;
create unique index if not exists uq_ticket_creation_user on public.ticket_creation_config(user_id) where user_id is not null;

-- Enable RLS and restrict management to admins
alter table public.ticket_creation_config enable row level security;

create policy "Admins manage ticket creation config"
  on public.ticket_creation_config
  as permissive
  for all
  to authenticated
  using (get_user_role(auth.uid()) = 'admin'::user_role)
  with check (get_user_role(auth.uid()) = 'admin'::user_role);

-- Trigger for the config table
create trigger set_ticket_creation_config_updated_at
before update on public.ticket_creation_config
for each row execute function public.update_updated_at_column();

-- Function to check if a user can create tickets
create or replace function public.has_ticket_creation_permission(_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_user_allowed boolean;
  v_role_allowed boolean;
begin
  select role into v_role from public.profiles where id = _user_id;

  select can_create into v_user_allowed 
  from public.ticket_creation_config 
  where user_id = _user_id;

  if v_user_allowed is not null then
    return v_user_allowed;
  end if;

  if v_role is not null then
    select can_create into v_role_allowed 
    from public.ticket_creation_config 
    where role = v_role;

    if v_role_allowed is not null then
      return v_role_allowed;
    end if;
  end if;

  return true; -- default allow if not configured
end;
$$;

-- Update tickets INSERT policy to include permission check
drop policy if exists "Secure ticket creation" on public.tickets;
create policy "Secure ticket creation"
  on public.tickets
  for insert
  to authenticated
  with check (
    (get_user_role(auth.uid()) = any (array['housekeeping'::user_role, 'reception'::user_role, 'maintenance'::user_role, 'manager'::user_role, 'admin'::user_role, 'marketing'::user_role, 'control_finance'::user_role, 'hr'::user_role, 'front_office'::user_role, 'top_management'::user_role]))
    and (created_by = auth.uid())
    and (
      (get_user_role(auth.uid()) = any (array['admin'::user_role, 'top_management'::user_role]))
      or (
        (select profiles.assigned_hotel from public.profiles where profiles.id = auth.uid()) = hotel
        or (select profiles.assigned_hotel from public.profiles where profiles.id = auth.uid()) = get_hotel_name_from_id(hotel)
      )
    )
    and public.has_ticket_creation_permission(auth.uid())
  );