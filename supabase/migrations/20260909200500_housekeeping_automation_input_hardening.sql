-- Input and ownership hardening for housekeeping automation settings/presence.
-- Prevent malformed timezones/recipient lists and arbitrary oversized heartbeat
-- metadata from reaching scheduler-owned tables.

create or replace function public.validate_housekeeping_automation_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_normalized text[];
  v_claim_role text := current_setting('request.jwt.claim.role', true);
begin
  if new.organization_slug is null or btrim(new.organization_slug) = '' then
    raise exception 'Organization is required';
  end if;
  if new.hotel_id is null or btrim(new.hotel_id) = '' then
    raise exception 'Hotel is required';
  end if;

  new.timezone := btrim(coalesce(new.timezone, 'Europe/Budapest'));
  if length(new.timezone) > 64 then
    raise exception 'Timezone is too long';
  end if;
  begin
    perform now() at time zone new.timezone;
  exception when invalid_parameter_value then
    raise exception 'Invalid IANA timezone: %', new.timezone;
  end;

  select coalesce(array_agg(email order by email), '{}'::text[])
  into v_normalized
  from (
    select distinct lower(btrim(raw_email)) as email
    from unnest(coalesce(new.alert_emails, '{}'::text[])) raw_email
    where btrim(raw_email) <> ''
  ) normalized;

  if cardinality(v_normalized) < 1 or cardinality(v_normalized) > 10 then
    raise exception 'Housekeeping alerts require between 1 and 10 recipients';
  end if;

  foreach v_email in array v_normalized loop
    if length(v_email) > 254
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Invalid housekeeping alert email address';
    end if;
  end loop;
  new.alert_emails := v_normalized;

  if tg_op = 'INSERT' then
    if auth.uid() is not null and v_claim_role <> 'service_role' then
      new.created_by := auth.uid();
      new.updated_by := auth.uid();
    end if;
  else
    if new.organization_slug is distinct from old.organization_slug
       or new.hotel_id is distinct from old.hotel_id
       or new.created_by is distinct from old.created_by then
      raise exception 'Housekeeping automation setting identity fields are immutable';
    end if;
    if auth.uid() is not null and v_claim_role <> 'service_role' then
      new.updated_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_housekeeping_automation_settings() from public;

drop trigger if exists validate_housekeeping_automation_settings_trigger
  on public.housekeeping_automation_settings;
create trigger validate_housekeeping_automation_settings_trigger
before insert or update on public.housekeeping_automation_settings
for each row execute function public.validate_housekeeping_automation_settings();

alter table public.housekeeping_daily_presence
  drop constraint if exists housekeeping_daily_presence_source_length_check;
alter table public.housekeeping_daily_presence
  add constraint housekeeping_daily_presence_source_length_check
  check (length(source) between 1 and 64);

create or replace function public.mark_housekeeping_presence(
  p_hotel_id text,
  p_source text default 'housekeeping_app',
  p_client_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.profiles%rowtype;
  v_org text;
  v_timezone text := 'Europe/Budapest';
  v_work_date date;
  v_now timestamptz := now();
  v_source text;
  v_context jsonb;
  v_last_seen timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_user from public.profiles where id = auth.uid();
  if not found or v_user.deleted_at is not null then
    raise exception 'Active profile not found';
  end if;

  if not (
    v_user.role in ('housekeeping'::public.user_role, 'housekeeping_manager'::public.user_role, 'supervisor'::public.user_role)
    or coalesce(v_user.acts_as_housekeeper, false)
  ) then
    return jsonb_build_object('recorded', false, 'reason', 'not_housekeeping_user');
  end if;

  v_org := v_user.organization_slug;
  if v_org is null then
    raise exception 'Organization is missing';
  end if;

  if p_hotel_id is null or btrim(p_hotel_id) = '' or length(p_hotel_id) > 128 then
    raise exception 'Invalid hotel identifier';
  end if;

  if not (
    v_user.assigned_hotel = p_hotel_id
    or v_user.hotel_id = p_hotel_id
    or exists (
      select 1
      from public.hotel_configurations hc
      where (hc.hotel_id = p_hotel_id or hc.hotel_name = p_hotel_id)
        and (
          v_user.assigned_hotel = hc.hotel_id
          or v_user.assigned_hotel = hc.hotel_name
          or v_user.hotel_id = hc.hotel_id
          or v_user.hotel_id = hc.hotel_name
        )
    )
  ) then
    raise exception 'Hotel access denied';
  end if;

  v_source := left(coalesce(nullif(btrim(p_source), ''), 'housekeeping_app'), 64);
  v_context := coalesce(p_client_context, '{}'::jsonb);
  if jsonb_typeof(v_context) <> 'object' then
    raise exception 'Presence context must be a JSON object';
  end if;
  if octet_length(v_context::text) > 2048 then
    raise exception 'Presence context is too large';
  end if;

  -- Only retain the operationally useful, non-sensitive keys. Unknown browser
  -- metadata is discarded so this table cannot become an arbitrary JSON store.
  v_context := jsonb_strip_nulls(jsonb_build_object(
    'reason', left(coalesce(v_context ->> 'reason', ''), 32),
    'visibility', left(coalesce(v_context ->> 'visibility', ''), 16),
    'path', left(coalesce(v_context ->> 'path', ''), 256)
  ));

  select coalesce(s.timezone, 'Europe/Budapest')
  into v_timezone
  from public.housekeeping_automation_settings s
  where s.organization_slug = v_org and s.hotel_id = p_hotel_id;
  v_timezone := coalesce(v_timezone, 'Europe/Budapest');

  begin
    perform v_now at time zone v_timezone;
  exception when invalid_parameter_value then
    v_timezone := 'Europe/Budapest';
  end;

  v_work_date := (v_now at time zone v_timezone)::date;

  select hp.last_seen_at
  into v_last_seen
  from public.housekeeping_daily_presence hp
  where hp.organization_slug = v_org
    and hp.hotel_id = p_hotel_id
    and hp.user_id = auth.uid()
    and hp.work_date = v_work_date;

  -- Client hooks already throttle to five minutes. This server-side floor keeps
  -- a malicious/retrying client from turning presence into a high-write endpoint.
  if v_last_seen is not null and v_last_seen > v_now - interval '30 seconds' then
    return jsonb_build_object(
      'recorded', true,
      'throttled', true,
      'work_date', v_work_date,
      'last_seen_at', v_last_seen,
      'timezone', v_timezone
    );
  end if;

  insert into public.housekeeping_daily_presence (
    organization_slug, hotel_id, user_id, work_date,
    first_seen_at, last_seen_at, source, client_context
  ) values (
    v_org, p_hotel_id, auth.uid(), v_work_date,
    v_now, v_now, v_source, v_context
  )
  on conflict (organization_slug, hotel_id, user_id, work_date)
  do update set
    last_seen_at = excluded.last_seen_at,
    source = excluded.source,
    client_context = public.housekeeping_daily_presence.client_context || excluded.client_context;

  return jsonb_build_object(
    'recorded', true,
    'throttled', false,
    'work_date', v_work_date,
    'last_seen_at', v_now,
    'timezone', v_timezone
  );
end;
$$;

revoke all on function public.mark_housekeeping_presence(text,text,jsonb) from public;
grant execute on function public.mark_housekeeping_presence(text,text,jsonb) to authenticated;

-- Alert rows are scheduler-owned. Explicitly keep mutation privileges out of
-- authenticated clients even if future broad table grants are introduced.
revoke insert, update, delete on public.housekeeping_automation_alerts from authenticated;
revoke insert, update, delete on public.housekeeping_daily_presence from authenticated;