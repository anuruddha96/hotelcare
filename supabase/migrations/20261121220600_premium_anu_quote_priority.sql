-- Preserve the existing claim_welcome_quote RPC signature and permanent no-repeat history.
-- Only the signed-in Anu_000 profile receives Steve Jobs-first ordering.
-- The caller may not provide a nickname, role, or another user's identifier.
create or replace function public.claim_welcome_quote(p_seen_keys text[] default '{}'::text[])
returns table (quote_key text, quote_text text, author text)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_role text;
  v_is_premium boolean := false;
  v_audience text;
  v_key text;
  v_text text;
  v_author text;
begin
  if v_user is null then return; end if;
  select p.role::text, lower(btrim(coalesce(p.nickname::text, ''))) = 'anu_000'
    into v_role, v_is_premium
  from public.profiles p
  where p.id = v_user and p.deleted_at is null;
  if not found then return; end if;

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
    else 'hospitality'
  end;

  -- The original advisory lock and unique impression key make repeated claims
  -- across concurrent sessions/devices atomic and impossible to double-award.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 19091221));

  insert into public.welcome_quote_impressions(user_id, quote_key)
  select v_user, q.quote_key
  from public.welcome_quote_catalog q
  where q.quote_key = any(coalesce(p_seen_keys[1:500], '{}'::text[]))
  on conflict do nothing;

  select q.quote_key, q.quote_text, q.author
    into v_key, v_text, v_author
  from public.welcome_quote_catalog q
  where q.is_active
    and (v_audience = any(q.audiences) or 'hospitality' = any(q.audiences))
    and not exists (
      select 1 from public.welcome_quote_impressions s
      where s.user_id = v_user and s.quote_key = q.quote_key
    )
  order by
    case when v_is_premium and q.author = 'Steve Jobs' then 0 else 1 end,
    q.quality_rank desc,
    md5(q.quote_key || v_user::text)
  limit 1;

  if v_key is null then return; end if; -- Never recycle exhausted quotes.
  insert into public.welcome_quote_impressions(user_id, quote_key)
  values (v_user, v_key);
  return query select v_key, v_text, v_author;
end;
$$;
revoke all on function public.claim_welcome_quote(text[]) from public, anon;
grant execute on function public.claim_welcome_quote(text[]) to authenticated;
comment on function public.claim_welcome_quote(text[]) is
  'Atomically serve exactly one unseen quote per user, with verified Steve Jobs preference for Anu_000; preserve role restrictions and lifetime no-repeat history.';
