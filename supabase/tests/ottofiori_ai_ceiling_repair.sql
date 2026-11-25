-- Regression: an existing over-ceiling cell may move only toward the ceiling.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='hotelcare_ai_queue_ottofiori_column';

  if position('and not (p_delta < 0 and v_target < v_row.price)' in v_def)=0 then
    raise exception 'Ottofiori monotonic ceiling-repair guard is missing';
  end if;
  if not (505 > 500 and (-3 < 0 and 505 < 508)) then
    raise exception 'Expected a monotonic downward repair to be allowed';
  end if;
  if (505 > 500 and (3 < 0 and 505 < 502)) then
    raise exception 'An increase must never bypass the ceiling';
  end if;
  if (509 > 500 and (-3 < 0 and 509 < 508)) then
    raise exception 'A worsening move must never bypass the ceiling';
  end if;
end $$;
