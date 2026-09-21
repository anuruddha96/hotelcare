-- Optimize RM published-payload window reads without changing output.
-- Applied to production on 2026-09-21 as optimize_revenue_window_json_trimming.
-- Replaces array expansion + aggregation with PostgreSQL JSONPath filtering,
-- preserving the original array order and handling missing/null stay_date.
CREATE OR REPLACE FUNCTION public.revenue_trim_by_stay_date(_arr jsonb, _cutoff text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _cutoff IS NULL THEN '[]'::jsonb
    ELSE jsonb_path_query_array(
      COALESCE(_arr, '[]'::jsonb),
      '$[*] ? (!exists(@.stay_date) || @.stay_date == null || @.stay_date <= $cutoff)'::jsonpath,
      jsonb_build_object('cutoff', _cutoff)
    )
  END
$function$;
