-- Canonicalize duplicate demand events and prevent duplicate approved rows.
-- Duplicate identity is intentionally semantic enough to catch punctuation/year
-- variants while still keeping genuinely separate dates as separate events.

create or replace function public.demand_event_title_key(p_title text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        lower(unaccent(coalesce(p_title, ''))),
        '\m(19|20)[0-9]{2}\M',
        '',
        'g'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  )
$$;

-- Known spelling variants that should share one identity.
create or replace function public.demand_event_identity_title_key(p_title text)
returns text
language sql
immutable
parallel safe
as $$
  select case public.demand_event_title_key(p_title)
    when 'labor day' then 'labour day'
    when 'berlioz symphonie fantastique concert' then 'berlioz symphonie fantastique'
    when 'mefistofele opera performances' then 'mefistofele'
    else public.demand_event_title_key(p_title)
  end
$$;

-- First remove legacy rows that can no longer be displayed safely.
update public.demand_events
set approved = false, updated_at = now()
where approved = true
  and (url is null or btrim(url) = '' or url !~* '^https?://');

-- Collapse exact/safe semantic duplicates. Prefer official/verified/manual
-- sources, then stronger confidence, then the most recently maintained row.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        organization_slug,
        lower(trim(country)),
        lower(trim(city)),
        event_date,
        coalesce(end_date, event_date),
        public.demand_event_identity_title_key(title)
      order by
        case
          when source = 'verified_official' then 0
          when source = 'manual' then 1
          when url ~* '(formula1|uefa|mupa|opera|hungexpo|budapestinfo|durerkert|mvm-dome)' then 2
          when source = 'ai_auto' then 3
          else 4
        end,
        confidence desc nulls last,
        updated_at desc,
        created_at desc,
        id
    ) as rn
  from public.demand_events
  where approved = true
)
update public.demand_events d
set approved = false, updated_at = now()
from ranked r
where d.id = r.id and r.rn > 1;

-- A partial unique index keeps historical/unapproved rows for audit while
-- making it impossible for the live calendar to accumulate duplicates again.
drop index if exists public.demand_events_approved_identity_unique;
create unique index demand_events_approved_identity_unique
on public.demand_events (
  organization_slug,
  lower(trim(country)),
  lower(trim(city)),
  event_date,
  coalesce(end_date, event_date),
  public.demand_event_identity_title_key(title)
)
where approved = true;

comment on index public.demand_events_approved_identity_unique is
  'Prevents duplicate approved demand events after title/date normalization.';
