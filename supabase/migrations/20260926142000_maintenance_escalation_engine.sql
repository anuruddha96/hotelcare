-- Maintenance SLA escalation configuration and delivery audit.
-- This migration is intentionally source controlled; merging it does not by itself
-- deploy it to a Supabase project. Apply through the normal production migration flow.

create table if not exists public.maintenance_escalation_settings (
  id uuid primary key default gen_random_uuid(),
  organization_slug text not null,
  hotel text not null,
  email_enabled boolean not null default true,
  urgent_sla_hours integer not null default 4 check (urgent_sla_hours between 1 and 720),
  high_sla_hours integer not null default 12 check (high_sla_hours between 1 and 720),
  medium_sla_hours integer not null default 24 check (medium_sla_hours between 1 and 720),
  low_sla_hours integer not null default 48 check (low_sla_hours between 1 and 720),
  l1_emails text[] not null default '{}'::text[],
  l2_emails text[] not null default '{}'::text[],
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_slug, hotel)
);

create table if not exists public.maintenance_escalation_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  organization_slug text not null,
  hotel text not null,
  escalation_level smallint not null check (escalation_level in (1, 2)),
  threshold_at timestamptz not null,
  recipient_emails text[] not null default '{}'::text[],
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 1 check (attempt_count >= 0),
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticket_id, escalation_level)
);

create index if not exists maintenance_escalation_settings_scope_idx
  on public.maintenance_escalation_settings (organization_slug, hotel);
create index if not exists maintenance_escalation_events_scope_idx
  on public.maintenance_escalation_events (organization_slug, hotel, created_at desc);
create index if not exists maintenance_escalation_events_retry_idx
  on public.maintenance_escalation_events (status, updated_at)
  where status in ('claimed', 'failed');

alter table public.maintenance_escalation_settings enable row level security;
alter table public.maintenance_escalation_events enable row level security;

create or replace function public.can_manage_maintenance_escalation(p_organization_slug text, p_hotel text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.organization_slug = p_organization_slug
      and (p.role in ('admin', 'top_management', 'top_management_manager') or coalesce(p.is_super_admin, false))
      and (
        coalesce(p.is_super_admin, false)
        or p.assigned_hotel = p_hotel
        or exists (
          select 1
          from public.hotel_configurations hc
          where (hc.hotel_id = p.assigned_hotel or hc.hotel_name = p.assigned_hotel)
            and (hc.hotel_id = p_hotel or hc.hotel_name = p_hotel)
        )
      )
  );
$$;

grant execute on function public.can_manage_maintenance_escalation(text, text) to authenticated;

DROP POLICY IF EXISTS "Top management reads maintenance escalation settings" ON public.maintenance_escalation_settings;
create policy "Top management reads maintenance escalation settings"
  on public.maintenance_escalation_settings for select
  to authenticated
  using (public.can_manage_maintenance_escalation(organization_slug, hotel));

DROP POLICY IF EXISTS "Top management creates maintenance escalation settings" ON public.maintenance_escalation_settings;
create policy "Top management creates maintenance escalation settings"
  on public.maintenance_escalation_settings for insert
  to authenticated
  with check (public.can_manage_maintenance_escalation(organization_slug, hotel));

DROP POLICY IF EXISTS "Top management updates maintenance escalation settings" ON public.maintenance_escalation_settings;
create policy "Top management updates maintenance escalation settings"
  on public.maintenance_escalation_settings for update
  to authenticated
  using (public.can_manage_maintenance_escalation(organization_slug, hotel))
  with check (public.can_manage_maintenance_escalation(organization_slug, hotel));

DROP POLICY IF EXISTS "Top management deletes maintenance escalation settings" ON public.maintenance_escalation_settings;
create policy "Top management deletes maintenance escalation settings"
  on public.maintenance_escalation_settings for delete
  to authenticated
  using (public.can_manage_maintenance_escalation(organization_slug, hotel));

DROP POLICY IF EXISTS "Top management reads maintenance escalation audit" ON public.maintenance_escalation_events;
create policy "Top management reads maintenance escalation audit"
  on public.maintenance_escalation_events for select
  to authenticated
  using (public.can_manage_maintenance_escalation(organization_slug, hotel));

-- Service-role edge workers bypass RLS. No authenticated client policy may insert
-- or modify audit rows, preventing users from fabricating delivery records.

create or replace function public.touch_maintenance_escalation_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists maintenance_escalation_settings_touch on public.maintenance_escalation_settings;
create trigger maintenance_escalation_settings_touch
before update on public.maintenance_escalation_settings
for each row execute function public.touch_maintenance_escalation_updated_at();

drop trigger if exists maintenance_escalation_events_touch on public.maintenance_escalation_events;
create trigger maintenance_escalation_events_touch
before update on public.maintenance_escalation_events
for each row execute function public.touch_maintenance_escalation_updated_at();
