-- Keep the durable push-item queue aligned with the draft recency guard.
-- A superseded draft must never leave its push item permanently queued.

create or replace function public.close_superseded_revenue_push_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.status = 'superseded' or new.superseded_at is not null)
     and (old.status is distinct from new.status or old.superseded_at is distinct from new.superseded_at) then
    update public.revenue_rate_push_items
       set status = 'failed',
           claimed_at = null,
           error = 'Superseded by a newer price intent before publish; no Previo write attempted.',
           updated_at = now()
     where draft_id = new.id
       and status in ('queued', 'processing');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_close_superseded_revenue_push_item on public.revenue_rate_drafts;
create trigger trg_close_superseded_revenue_push_item
after update of status, superseded_at on public.revenue_rate_drafts
for each row
execute function public.close_superseded_revenue_push_item();

-- Backfill only queue rows whose source draft is already proven superseded.
-- This is metadata repair only: it does not create or send any rate write.
update public.revenue_rate_push_items i
   set status = 'failed',
       claimed_at = null,
       error = 'Superseded by a newer price intent before publish; no Previo write attempted.',
       updated_at = now()
  from public.revenue_rate_drafts d
 where d.id = i.draft_id
   and i.status in ('queued', 'processing')
   and (d.status = 'superseded' or d.superseded_at is not null);

-- Reconcile recent Ottofiori push-run counters/status after the orphan cleanup.
with stats as (
  select r.id,
         count(i.id)::integer as total,
         count(i.id) filter (where i.status in ('accepted','confirmed','different'))::integer as accepted,
         count(i.id) filter (where i.status in ('failed','different'))::integer as failed,
         count(i.id) filter (where i.status in ('queued','processing'))::integer as pending
    from public.revenue_rate_push_runs r
    join public.revenue_rate_push_items i on i.run_id = r.id
   where r.hotel_id = 'ottofiori'
     and r.created_at >= now() - interval '30 days'
   group by r.id
)
update public.revenue_rate_push_runs r
   set processed_count = s.accepted + s.failed,
       accepted_count = s.accepted,
       failed_count = s.failed,
       status = case
         when s.pending > 0 then r.status
         when s.failed > 0 and s.accepted > 0 then 'partial'
         when s.failed > 0 and s.accepted = 0 then 'failed'
         else 'completed'
       end,
       finished_at = case when s.pending = 0 then coalesce(r.finished_at, now()) else r.finished_at end,
       updated_at = now(),
       last_error = case
         when s.failed > 0 then coalesce(r.last_error, 'One or more queued intents were superseded before publish.')
         else r.last_error
       end
  from stats s
 where r.id = s.id;
