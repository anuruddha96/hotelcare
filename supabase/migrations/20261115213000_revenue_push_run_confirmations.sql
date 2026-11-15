-- Readback visibility for the revenue notification panel: how many of a push
-- run's price cells Previo has confirmed (draft reconciliation), superseded,
-- or still has in flight. SECURITY INVOKER: the caller's RLS on
-- revenue_rate_drafts applies, so callers only see their own hotels.
create or replace function public.revenue_push_run_confirmations(p_run_ids uuid[])
returns table (
  push_run_id uuid,
  total_count integer,
  confirmed_count integer,
  superseded_count integer,
  pending_count integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select d.push_run_id,
         count(*)::int,
         count(*) filter (where d.confirmation_status = 'confirmed')::int,
         count(*) filter (where d.confirmation_status in ('superseded','settled_from_pms'))::int,
         count(*) filter (where d.confirmation_status in ('sending','sent','checking','pending','different'))::int
  from public.revenue_rate_drafts d
  where d.push_run_id = any(p_run_ids)
  group by d.push_run_id
$$;

revoke all on function public.revenue_push_run_confirmations(uuid[]) from public;
grant execute on function public.revenue_push_run_confirmations(uuid[]) to authenticated, service_role;
