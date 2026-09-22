-- Keep sourced quotations and new HotelCare-original thoughts clearly distinguishable.
-- Never erase impressions or silently recycle quote keys.
alter table public.welcome_quote_catalog
  add column if not exists provenance text not null default 'verified_external';
alter table public.welcome_quote_catalog
  drop constraint if exists welcome_quote_catalog_provenance_check;
alter table public.welcome_quote_catalog
  add constraint welcome_quote_catalog_provenance_check
  check (provenance in ('verified_external', 'ai_original'));

create table if not exists public.welcome_quote_refill_state (
  id boolean primary key default true check (id),
  status text not null default 'idle' check (status in ('idle','running','paused')),
  lease_until timestamptz,
  cooldown_until timestamptz,
  last_refill_at timestamptz,
  last_error text,
  generated_total integer not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.welcome_quote_refill_state(id) values (true) on conflict do nothing;
alter table public.welcome_quote_refill_state enable row level security;
revoke all on public.welcome_quote_refill_state from public, anon, authenticated;

-- Vault secret is generated in the database, not embedded in the repository or
-- sent to browsers. The Edge Function verifies it through a service-only RPC.
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'welcome_quote_refill_worker_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'welcome_quote_refill_worker_secret',
      'Authenticates the database scheduler for the welcome quote refill worker'
    );
  end if;
end $$;

create or replace function public.verify_welcome_quote_worker_secret(p_secret text)
returns boolean language sql security definer set search_path = '' as $$
  select coalesce(length(p_secret) = 64 and exists (
    select 1 from vault.decrypted_secrets v
    where v.name = 'welcome_quote_refill_worker_secret'
      and extensions.digest(v.decrypted_secret, 'sha256') = extensions.digest(p_secret, 'sha256')
  ), false);
$$;
revoke all on function public.verify_welcome_quote_worker_secret(text) from public, anon, authenticated;
grant execute on function public.verify_welcome_quote_worker_secret(text) to service_role;

-- One model worker at a time, with a minimum delay for normal user requests.
-- A scheduler may bypass the cooldown only while initially building inventory.
create or replace function public.claim_welcome_quote_refill_lease(p_bootstrap boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_claimed integer;
begin
  update public.welcome_quote_refill_state
  set status = 'running', lease_until = now() + interval '4 minutes',
      cooldown_until = now() + interval '8 minutes', updated_at = now()
  where id = true and status <> 'paused'
    and (lease_until is null or lease_until < now())
    and (coalesce(cooldown_until, '-infinity'::timestamptz) < now()
         or (p_bootstrap and (select count(*) from public.welcome_quote_catalog
                              where is_active and 'hospitality' = any(audiences)) < 240));
  get diagnostics v_claimed = row_count;
  return v_claimed = 1;
end;
$$;
revoke all on function public.claim_welcome_quote_refill_lease(boolean) from public, anon, authenticated;
grant execute on function public.claim_welcome_quote_refill_lease(boolean) to service_role;

create or replace function public.finish_welcome_quote_refill(p_inserted integer, p_error text default null, p_pause boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.welcome_quote_refill_state
  set status = case when p_pause then 'paused' else 'idle' end,
      lease_until = null, last_error = left(p_error, 240),
      last_refill_at = case when p_inserted > 0 then now() else last_refill_at end,
      generated_total = generated_total + greatest(0, p_inserted), updated_at = now()
  where id = true;
end;
$$;
revoke all on function public.finish_welcome_quote_refill(integer,text,boolean) from public, anon, authenticated;
grant execute on function public.finish_welcome_quote_refill(integer,text,boolean) to service_role;

-- Only the server may insert original AI-authored thoughts. Every inserted
-- record explicitly names HotelCare; model output is NEVER attributed to a person.
create or replace function public.insert_welcome_original_thoughts(p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 45 then
    raise exception 'Invalid quote batch';
  end if;
  with entries as (
    select distinct on (lower(btrim(x.quote_text)))
      btrim(x.quote_text) as quote_text,
      btrim(x.practical_takeaway) as takeaway,
      x.audience as audience,
      x.tone as tone
    from jsonb_to_recordset(p_rows) as x(quote_text text, practical_takeaway text, audience text, tone text)
    where char_length(btrim(coalesce(x.quote_text, ''))) between 28 and 150
      and char_length(btrim(coalesce(x.practical_takeaway, ''))) between 12 and 120
      and x.audience = any(array['hospitality','housekeeping','housekeeping_leadership',
        'reception','reception_leadership','maintenance','maintenance_leadership',
        'breakfast','marketing','marketing_leadership','finance','finance_leadership',
        'hr','hotel_management','executive','admin','supervisor'])
      and x.tone = any(array['motivational','practical','humorous'])
    order by lower(btrim(x.quote_text)), x.audience
  ), added as (
    insert into public.welcome_quote_catalog
      (quote_key, quote_text, author, source_url, practical_takeaway, audiences,
       tone, quality_rank, verified_at, provenance, is_active)
    select 'hc-original-' || md5(lower(regexp_replace(e.quote_text, '\s+', ' ', 'g'))),
      e.quote_text, 'HotelCare', 'https://hotelcare.app/', e.takeaway,
      array[e.audience], e.tone, 3, now(), 'ai_original', true
    from entries e
    on conflict do nothing returning 1
  )
  select count(*) into v_count from added;
  return v_count;
end;
$$;
revoke all on function public.insert_welcome_original_thoughts(jsonb) from public, anon, authenticated;
grant execute on function public.insert_welcome_original_thoughts(jsonb) to service_role;

-- Cheap authenticated inventory check, scoped to the employee's actual profile.
-- Called after the quote appears, so it cannot delay workspace loading.
create or replace function public.welcome_quote_remaining()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_role text; v_audience text; v_count integer;
begin
  if (select auth.uid()) is null then return 0; end if;
  select role::text into v_role from public.profiles
  where id = (select auth.uid()) and deleted_at is null;
  if not found then return 0; end if;
  v_audience := case v_role
    when 'housekeeping' then 'housekeeping'
    when 'housekeeping_manager' then 'housekeeping_leadership'
    when 'reception' then 'reception'
    when 'front_office' then 'reception'
    when 'reception_manager' then 'reception_leadership'
    when 'maintenance' then 'maintenance'
    when 'maintenance_manager' then 'maintenance_leadership'
    when 'breakfast_staff' then 'breakfast'
    when 'marketing' then 'marketing'
    when 'marketing_manager' then 'marketing_leadership'
    when 'control_finance' then 'finance'
    when 'control_manager' then 'finance_leadership'
    when 'finance_manager' then 'finance_leadership'
    when 'hr' then 'hr'
    when 'manager' then 'hotel_management'
    when 'back_office_manager' then 'hotel_management'
    when 'top_management' then 'executive'
    when 'top_management_manager' then 'executive'
    when 'admin' then 'admin'
    when 'supervisor' then 'supervisor'
    else 'hospitality' end;
  select count(*) into v_count from public.welcome_quote_catalog q
  where q.is_active and (v_audience = any(q.audiences) or 'hospitality' = any(q.audiences))
    and not exists (select 1 from public.welcome_quote_impressions i
      where i.user_id = (select auth.uid()) and i.quote_key = q.quote_key);
  return v_count;
end;
$$;
revoke all on function public.welcome_quote_remaining() from public, anon;
grant execute on function public.welcome_quote_remaining() to authenticated;

-- Fully server-guarded cron: this secret is resolved only inside PostgreSQL;
-- no service-role key or OpenAI key is present in the cron job or frontend.
select cron.schedule('hotelcare-welcome-quote-refill', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/welcome-quote-refill',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets
                          where name = 'welcome_quote_refill_worker_secret' limit 1)
    ),
    body := '{"mode":"scheduled"}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);
