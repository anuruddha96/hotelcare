-- Ottofiori: protect authoritative external Previo price edits for the ordinary
-- manager hold window. Ordinary unchanged PMS refreshes do not create
-- previo_external audit rows, so they remain outside this guard.
create or replace function public.revenue_manual_hold_state(
  p_hotel_id text,
  p_since timestamptz,
  p_sources text[]
)
returns table(stay_date date, hold_until timestamptz, hold_kind text)
language sql
stable
security definer
set search_path to 'public'
set statement_timeout to '20s'
as $function$
  select l.stay_date, l.locked_until, 'hard'::text
  from public.revenue_manual_locks l
  where l.hotel_id = p_hotel_id and l.locked_until > now()
  union all
  select a.stay_date, max(a.performed_at), 'soft'::text
  from public.rate_change_audit a
  where a.hotel_id = p_hotel_id
    and a.performed_at >= p_since
    and a.stay_date >= current_date
    and (
      a.source = any(p_sources)
      or (p_hotel_id = 'ottofiori' and a.source = 'previo_external')
    )
  group by a.stay_date
  union all
  select d.stay_date, max(d.created_at), 'soft'::text
  from public.revenue_rate_drafts d
  where p_hotel_id = 'ottofiori'
    and d.hotel_id = p_hotel_id
    and d.organization_slug = 'rdhotels'
    and d.stay_date >= current_date
    and d.created_at >= greatest(p_since, now() - interval '24 hours')
    and d.intent_source = 'manual'
    and coalesce(d.decision_reason, '') !~ '^ai_'
    and d.status not in ('failed','superseded')
  group by d.stay_date
$function$;

comment on function public.revenue_manual_hold_state(text,timestamptz,text[]) is
  'Returns hard locks and ordinary manual price holds. For Ottofiori, a previo_external audit event is an authoritative external PMS edit and receives the same soft hold; unchanged PMS refreshes do not create such an event.';