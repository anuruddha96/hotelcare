-- Conservative semantic deduplication for the shared demand-event calendar.
--
-- Goals:
--   1. Clean existing duplicate signals without deleting audit history.
--   2. Keep unrelated events even when they came from the same monthly listing.
--   3. Prevent future typo/translation/source variants from consuming extra
--      Rate & Pickup event lanes.
--   4. Prefer manual / cleaner / higher-confidence records when choosing which
--      duplicate remains approved.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.demand_event_norm_text(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            translate(
              lower(coalesce(p_value, '')),
              'áéíóöőúüű',
              'aeiooouuu'
            ),
            '[''’]s\M',
            's',
            'g'
          ),
          '\m(19|20)[0-9]{2}\M',
          ' ',
          'g'
        ),
        '[^a-z0-9]+',
        ' ',
        'g'
      ),
      '\s+',
      ' ',
      'g'
    )
  )
$$;

create or replace function public.demand_event_title_identity_key(p_title text)
returns text
language plpgsql
immutable
parallel safe
set search_path = public, extensions
as $$
declare
  v text;
  result text;
begin
  v := public.demand_event_norm_text(p_title);
  v := regexp_replace(v, '\m(unnep|dcnnep)\M', 'festival', 'g');

  if v ~ '^liszt\M' and v ~ '\m(festival|fest)\M' then
    return 'liszt';
  end if;
  if v ~ '^spar budapest marathon\M' then
    return 'budapest marathon spar';
  end if;
  if v ~ '^all saints day\M' then
    return 'all saints day';
  end if;
  if v ~ '^boxing day\M' then
    return 'boxing day';
  end if;
  if v ~ '^st nicholas day\M' then
    return 'nicholas saint day';
  end if;
  if v ~ '^new year s eve celebrations?\M' or v ~ '^new years eve celebrations?\M' then
    return 'celebrations eve new years';
  end if;

  select coalesce(string_agg(token, ' ' order by token), '')
    into result
  from (
    select distinct token
    from regexp_split_to_table(v, '\s+') as token
    where token <> ''
      and token not in (
        'concert','concerts','event','events','performance','performances',
        'festival','fest','international','cultural','show','shows',
        'vs','versus','and','the','at','in','of'
      )
  ) q;

  return coalesce(result, '');
end
$$;

create or replace function public.demand_event_source_key(p_url text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          coalesce(p_url, ''),
          '^https?://(www\.)?',
          '',
          'i'
        ),
        '[?#].*$',
        ''
      ),
      '/+$',
      ''
    )
  )
$$;

create or replace function public.demand_event_venue_similarity(a text, b text)
returns real
language plpgsql
immutable
parallel safe
set search_path = public, extensions
as $$
declare
  aa text := public.demand_event_norm_text(a);
  bb text := public.demand_event_norm_text(b);
begin
  if aa = '' and bb = '' then return 1; end if;
  if aa = '' or bb = '' then return 0; end if;
  if aa = bb or position(aa in bb) > 0 or position(bb in aa) > 0 then return 1; end if;
  return greatest(
    extensions.similarity(aa, bb),
    extensions.word_similarity(aa, bb),
    extensions.word_similarity(bb, aa)
  );
end
$$;

create or replace function public.demand_event_title_similarity(a text, b text)
returns real
language plpgsql
immutable
parallel safe
set search_path = public, extensions
as $$
declare
  aa text := public.demand_event_norm_text(a);
  bb text := public.demand_event_norm_text(b);
  ak text := public.demand_event_title_identity_key(a);
  bk text := public.demand_event_title_identity_key(b);
begin
  if ak <> '' and ak = bk then return 1; end if;
  if aa = '' or bb = '' then return 0; end if;
  return greatest(
    extensions.similarity(aa, bb),
    extensions.similarity(ak, bk),
    extensions.word_similarity(aa, bb),
    extensions.word_similarity(bb, aa)
  );
end
$$;

create or replace function public.demand_event_same(
  a_title text,
  a_start date,
  a_end date,
  a_venue text,
  a_url text,
  a_category text,
  b_title text,
  b_start date,
  b_end date,
  b_venue text,
  b_url text,
  b_category text
)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = public, extensions
as $$
declare
  ae date := coalesce(a_end, a_start);
  be date := coalesce(b_end, b_start);
  ak text := public.demand_event_title_identity_key(a_title);
  bk text := public.demand_event_title_identity_key(b_title);
  title_sim real := public.demand_event_title_similarity(a_title, b_title);
  venue_sim real := public.demand_event_venue_similarity(a_venue, b_venue);
  source_same boolean := (
    public.demand_event_source_key(a_url) <> ''
    and public.demand_event_source_key(a_url) = public.demand_event_source_key(b_url)
  );
  exact_range boolean := (a_start = b_start and ae = be);
  category_same boolean := lower(coalesce(a_category, '')) = lower(coalesce(b_category, ''));
  special_key boolean := ak = any(array[
    'liszt',
    'budapest marathon spar',
    'all saints day',
    'boxing day',
    'nicholas saint day',
    'celebrations eve new years'
  ]);
begin
  if a_start is null or b_start is null then return false; end if;
  if not (a_start <= be and b_start <= ae) then return false; end if;
  if ak = '' or bk = '' then return false; end if;

  if ak = bk then
    if special_key then return true; end if;
    if source_same or venue_sim >= 0.45 then return true; end if;
    if exact_range and lower(coalesce(a_category, '')) = any(array['holiday','sport','sports']) then
      return true;
    end if;
  end if;

  if title_sim >= 0.84 and (source_same or venue_sim >= 0.45 or category_same) then
    return true;
  end if;

  -- A shared source page by itself is not enough: many legitimate events come
  -- from the same monthly listing. The title must still resemble the same event
  -- and the venue/date must agree.
  if exact_range and source_same and venue_sim >= 0.55 and title_sim >= 0.42 then
    return true;
  end if;

  if exact_range and venue_sim >= 0.78 and title_sim >= 0.68 then
    return true;
  end if;

  return false;
end
$$;

create or replace function public.demand_event_quality_score(
  p_source text,
  p_confidence numeric,
  p_title text,
  p_url text
)
returns numeric
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select
    case lower(coalesce(p_source, ''))
      when 'manual' then 1000
      when 'verified_official' then 900
      when 'ai_auto' then 20
      else 0
    end
    + least(10, greatest(0, coalesce(p_confidence, 0) * 10))
    + case when coalesce(p_url, '') ~* '^https?://' then 5 else 0 end
    + case when coalesce(p_title, '') ~* '[[:alpha:]][0-9]|[0-9][[:alpha:]]' then -20 else 15 end
$$;

-- Clean the current live pool conservatively. We keep every loser row for
-- auditability and only flip approved=false.
do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.demand_events'::regclass
      and tgname = 'trg_sync_shared_market_demand_event'
      and not tgisinternal
  ) then
    execute 'alter table public.demand_events disable trigger trg_sync_shared_market_demand_event';
  end if;
end
$$;

with duplicate_losers as (
  select d.id
  from public.demand_events d
  where d.approved = true
    and exists (
      select 1
      from public.demand_events k
      where k.approved = true
        and k.id <> d.id
        and k.organization_slug = d.organization_slug
        and lower(trim(k.city)) = lower(trim(d.city))
        and lower(trim(k.country)) = lower(trim(d.country))
        and public.demand_event_same(
          d.title, d.event_date, d.end_date, d.venue, d.url, d.category,
          k.title, k.event_date, k.end_date, k.venue, k.url, k.category
        )
        and (
          public.demand_event_quality_score(k.source, k.confidence, k.title, k.url)
            > public.demand_event_quality_score(d.source, d.confidence, d.title, d.url)
          or (
            public.demand_event_quality_score(k.source, k.confidence, k.title, k.url)
              = public.demand_event_quality_score(d.source, d.confidence, d.title, d.url)
            and (k.created_at < d.created_at or (k.created_at = d.created_at and k.id::text < d.id::text))
          )
        )
    )
)
update public.demand_events d
set approved = false,
    updated_at = now()
where d.id in (select id from duplicate_losers);

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.demand_events'::regclass
      and tgname = 'trg_sync_shared_market_demand_event'
      and not tgisinternal
  ) then
    execute 'alter table public.demand_events enable trigger trg_sync_shared_market_demand_event';
  end if;
end
$$;

-- Future-write guard. Manual records win over an automatic duplicate; otherwise
-- the incoming duplicate is retained only as an unapproved audit row.
create or replace function public.dedupe_approved_demand_event()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  existing_id uuid;
  existing_source text;
begin
  if new.approved is not true then
    return new;
  end if;

  select e.id, e.source
    into existing_id, existing_source
  from public.demand_events e
  where e.id <> new.id
    and e.approved = true
    and e.organization_slug = new.organization_slug
    and lower(trim(e.city)) = lower(trim(new.city))
    and lower(trim(e.country)) = lower(trim(new.country))
    and public.demand_event_same(
      e.title, e.event_date, e.end_date, e.venue, e.url, e.category,
      new.title, new.event_date, new.end_date, new.venue, new.url, new.category
    )
  order by
    public.demand_event_quality_score(e.source, e.confidence, e.title, e.url) desc,
    e.created_at asc,
    e.id
  limit 1;

  if existing_id is null then
    return new;
  end if;

  if lower(coalesce(new.source, '')) = 'manual'
     and lower(coalesce(existing_source, '')) <> 'manual' then
    update public.demand_events
       set approved = false,
           updated_at = now()
     where id = existing_id;
    return new;
  end if;

  new.approved := false;
  return new;
end
$$;

drop trigger if exists trg_dedupe_approved_demand_event on public.demand_events;
create trigger trg_dedupe_approved_demand_event
before insert or update of
  approved,
  organization_slug,
  city,
  country,
  title,
  category,
  venue,
  event_date,
  end_date,
  url,
  source,
  confidence
on public.demand_events
for each row
execute function public.dedupe_approved_demand_event();

-- Exact-title backstop. Semantic variants are handled by the trigger above.
drop index if exists public.demand_events_approved_exact_unique;
create unique index demand_events_approved_exact_unique
on public.demand_events (
  organization_slug,
  lower(trim(city)),
  lower(trim(country)),
  event_date,
  coalesce(end_date, event_date),
  lower(trim(title))
)
where approved = true;

comment on function public.demand_event_same(
  text,date,date,text,text,text,text,date,date,text,text,text
) is
  'Conservative semantic identity check for demand events. Requires overlapping dates and meaningful title similarity; a shared source URL alone never makes two rows duplicates.';

comment on trigger trg_dedupe_approved_demand_event on public.demand_events is
  'Prevents future semantic duplicate pricing signals while preserving duplicate discovery rows as approved=false audit history.';
