-- Remove legacy implementation messages that were written into human
-- housekeeping notes when managers dragged Checkout <-> Daily. Structured
-- roomTypeChangeNotice metadata + pms_change_events now carry this audit data.
-- Preserve every human-authored line (Baby Bed, guest requests, etc.).

UPDATE public.rooms AS r
SET notes = (
  SELECT nullif(btrim(string_agg(line, E'\n' ORDER BY ord)), '')
  FROM unnest(regexp_split_to_array(coalesce(r.notes, ''), E'\r?\n'))
       WITH ORDINALITY AS t(line, ord)
  WHERE line !~ '^\s*\[ROOM TYPE [0-9]{4}-[0-9]{2}-[0-9]{2}\]'
)
WHERE coalesce(r.notes, '') ~ '(^|[\r\n])\s*\[ROOM TYPE [0-9]{4}-[0-9]{2}-[0-9]{2}\]';

UPDATE public.room_assignments AS a
SET notes = (
  SELECT nullif(btrim(string_agg(line, E'\n' ORDER BY ord)), '')
  FROM unnest(regexp_split_to_array(coalesce(a.notes, ''), E'\r?\n'))
       WITH ORDINALITY AS t(line, ord)
  WHERE line !~ '^\s*\[ROOM TYPE [0-9]{4}-[0-9]{2}-[0-9]{2}\]'
)
WHERE coalesce(a.notes, '') ~ '(^|[\r\n])\s*\[ROOM TYPE [0-9]{4}-[0-9]{2}-[0-9]{2}\]';
