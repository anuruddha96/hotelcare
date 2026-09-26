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
      and (p.role in ('top_management', 'top_management_manager') or coalesce(p.is_super_admin, false))
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

-- New maintenance tickets receive an SLA deadline centrally, so tickets created
-- from Housekeeping, Reception or the main Maintenance module all behave identically.
create or replace function public.apply_maintenance_sla_deadline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_setting public.maintenance_escalation_settings%rowtype;
  v_hours integer;
begin
  if new.department is distinct from 'maintenance' or new.sla_due_date is not null then
    return new;
  end if;

  select s.* into v_setting
  from public.maintenance_escalation_settings s
  where s.organization_slug = new.organization_slug
    and (
      lower(s.hotel) = lower(new.hotel)
      or exists (
        select 1
        from public.hotel_configurations hc
        where (lower(hc.hotel_id) = lower(s.hotel) or lower(hc.hotel_name) = lower(s.hotel))
          and (lower(hc.hotel_id) = lower(new.hotel) or lower(hc.hotel_name) = lower(new.hotel))
      )
    )
  order by case when lower(s.hotel) = lower(new.hotel) then 0 else 1 end
  limit 1;

  v_hours := case new.priority
    when 'urgent' then coalesce(v_setting.urgent_sla_hours, 4)
    when 'high' then coalesce(v_setting.high_sla_hours, 12)
    when 'low' then coalesce(v_setting.low_sla_hours, 48)
    else coalesce(v_setting.medium_sla_hours, 24)
  end;
  new.sla_due_date := coalesce(new.created_at, now()) + make_interval(hours => v_hours);
  return new;
end;
$$;

drop trigger if exists maintenance_ticket_sla_deadline on public.tickets;
create trigger maintenance_ticket_sla_deadline
before insert on public.tickets
for each row execute function public.apply_maintenance_sla_deadline();

-- Atomic claim: the unique ticket/level key guarantees one sender. Failed claims
-- can retry after five minutes; abandoned claims can be reclaimed after 15 minutes.
create or replace function public.claim_maintenance_escalation_event(
  p_ticket_id uuid,
  p_organization_slug text,
  p_hotel text,
  p_escalation_level smallint,
  p_threshold_at timestamptz,
  p_recipient_emails text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.maintenance_escalation_events (
    ticket_id, organization_slug, hotel, escalation_level, threshold_at,
    recipient_emails, status, attempt_count, error_message
  ) values (
    p_ticket_id, p_organization_slug, p_hotel, p_escalation_level, p_threshold_at,
    p_recipient_emails, 'claimed', 1, null
  )
  on conflict (ticket_id, escalation_level) do update
    set status = 'claimed',
        threshold_at = excluded.threshold_at,
        recipient_emails = excluded.recipient_emails,
        attempt_count = public.maintenance_escalation_events.attempt_count + 1,
        error_message = null,
        updated_at = now()
    where public.maintenance_escalation_events.attempt_count < 5
      and (
        (public.maintenance_escalation_events.status = 'failed' and public.maintenance_escalation_events.updated_at < now() - interval '5 minutes')
        or (public.maintenance_escalation_events.status = 'claimed' and public.maintenance_escalation_events.updated_at < now() - interval '15 minutes')
      )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.claim_maintenance_escalation_event(uuid, text, text, smallint, timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.claim_maintenance_escalation_event(uuid, text, text, smallint, timestamptz, text[]) to service_role;
