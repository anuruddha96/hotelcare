create table if not exists public.assistant_unlimited_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.assistant_unlimited_users enable row level security;
revoke all on table public.assistant_unlimited_users from anon, authenticated;
grant all on table public.assistant_unlimited_users to service_role;

insert into public.assistant_unlimited_users (user_id, enabled, reason)
values ('5d310c7f-1192-4543-8c2c-bb18f69fdd43', true, 'Unlimited HotelCare Assistant usage for Anu_000')
on conflict (user_id) do update
set enabled = excluded.enabled,
    reason = excluded.reason,
    updated_at = now();

alter table public.assistant_premium_usage
  drop constraint if exists assistant_premium_usage_source_check;

alter table public.assistant_premium_usage
  add constraint assistant_premium_usage_source_check
  check (source = any (array['included'::text, 'credit'::text, 'unlimited'::text]));

create or replace function public.reserve_assistant_premium_question(
  _user_id uuid,
  _organization_slug text,
  _thread_id uuid,
  _model text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_day date := (now() at time zone 'Europe/Budapest')::date;
  v_used integer := 0;
  v_balance integer := 0;
  v_usage_id uuid;
  v_stale record;
  v_unlimited boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext(_user_id::text));

  select coalesce(enabled, false) into v_unlimited
  from public.assistant_unlimited_users
  where user_id = _user_id;
  v_unlimited := coalesce(v_unlimited, false);

  for v_stale in
    select id, source
    from public.assistant_premium_usage
    where user_id = _user_id
      and status = 'reserved'
      and created_at < now() - interval '15 minutes'
    for update
  loop
    update public.assistant_premium_usage
    set status = 'refunded', completed_at = now()
    where id = v_stale.id;

    if v_stale.source = 'credit' then
      insert into public.assistant_premium_wallets(user_id, organization_slug, credits)
      values (_user_id, _organization_slug, 1)
      on conflict (user_id) do update
      set credits = public.assistant_premium_wallets.credits + 1,
          updated_at = now();
    end if;
  end loop;

  select credits into v_balance
  from public.assistant_premium_wallets
  where user_id = _user_id;
  v_balance := coalesce(v_balance, 0);

  if v_unlimited then
    insert into public.assistant_premium_usage(
      user_id, organization_slug, thread_id, usage_day, source, model
    )
    values (_user_id, _organization_slug, _thread_id, v_day, 'unlimited', _model)
    returning id into v_usage_id;

    return jsonb_build_object(
      'allowed', true,
      'usage_id', v_usage_id,
      'source', 'unlimited',
      'unlimited', true,
      'included_daily', null,
      'included_used', null,
      'included_remaining', null,
      'paid_balance', v_balance,
      'usage_day', v_day
    );
  end if;

  select count(*)::integer into v_used
  from public.assistant_premium_usage
  where user_id = _user_id
    and usage_day = v_day
    and source = 'included'
    and status in ('reserved', 'completed');

  if v_used < 5 then
    insert into public.assistant_premium_usage(
      user_id, organization_slug, thread_id, usage_day, source, model
    )
    values (_user_id, _organization_slug, _thread_id, v_day, 'included', _model)
    returning id into v_usage_id;

    return jsonb_build_object(
      'allowed', true,
      'usage_id', v_usage_id,
      'source', 'included',
      'included_daily', 5,
      'included_used', v_used + 1,
      'included_remaining', 5 - (v_used + 1),
      'paid_balance', v_balance,
      'usage_day', v_day
    );
  end if;

  update public.assistant_premium_wallets
  set credits = credits - 1, updated_at = now()
  where user_id = _user_id and credits > 0
  returning credits into v_balance;

  if found then
    insert into public.assistant_premium_usage(
      user_id, organization_slug, thread_id, usage_day, source, model
    )
    values (_user_id, _organization_slug, _thread_id, v_day, 'credit', _model)
    returning id into v_usage_id;

    return jsonb_build_object(
      'allowed', true,
      'usage_id', v_usage_id,
      'source', 'credit',
      'included_daily', 5,
      'included_used', v_used,
      'included_remaining', 0,
      'paid_balance', v_balance,
      'usage_day', v_day
    );
  end if;

  return jsonb_build_object(
    'allowed', false,
    'source', null,
    'included_daily', 5,
    'included_used', v_used,
    'included_remaining', 0,
    'paid_balance', 0,
    'usage_day', v_day
  );
end;
$function$;

revoke all on function public.reserve_assistant_premium_question(uuid, text, uuid, text)
from public, anon, authenticated;

grant execute on function public.reserve_assistant_premium_question(uuid, text, uuid, text)
to service_role;
