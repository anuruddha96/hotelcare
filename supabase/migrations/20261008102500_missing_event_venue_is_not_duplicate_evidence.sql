-- Missing venue data is unknown, not proof that two events share a venue.
-- This prevents similarly named no-venue events from being collapsed.
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
  if aa = '' or bb = '' then return 0; end if;
  if aa = bb or position(aa in bb) > 0 or position(bb in aa) > 0 then return 1; end if;
  return greatest(
    extensions.similarity(aa, bb),
    extensions.word_similarity(aa, bb),
    extensions.word_similarity(bb, aa)
  );
end
$$;

comment on function public.demand_event_venue_similarity(text,text) is
  'Venue evidence for semantic event deduplication. Missing venue values return 0 (unknown), never 1 (matching).';
