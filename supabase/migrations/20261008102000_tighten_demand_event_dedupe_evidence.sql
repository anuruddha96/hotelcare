-- Tighten fuzzy event identity: category alone is not evidence that two
-- similarly named events are the same. Require shared source or venue support.
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

  if title_sim >= 0.84 and (source_same or venue_sim >= 0.45) then
    return true;
  end if;

  if exact_range and source_same and venue_sim >= 0.55 and title_sim >= 0.42 then
    return true;
  end if;

  if exact_range and venue_sim >= 0.78 and title_sim >= 0.68 then
    return true;
  end if;

  return false;
end
$$;

comment on function public.demand_event_same(
  text,date,date,text,text,text,text,date,date,text,text,text
) is
  'Conservative semantic identity check for demand events. Requires overlapping dates and meaningful title similarity; fuzzy title similarity requires source or venue evidence, never category alone.';
