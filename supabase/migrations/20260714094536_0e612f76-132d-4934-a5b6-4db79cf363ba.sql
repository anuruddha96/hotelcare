-- Expose the single boolean `hide_pms_upload_page` to non-admin users
-- (managers) without opening up the full pms_configurations table.
CREATE OR REPLACE FUNCTION public.get_pms_upload_hidden(hotel_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH keys AS (
    SELECT DISTINCT k FROM (
      SELECT hotel_key AS k
      UNION ALL
      SELECT hotel_id FROM public.hotel_configurations WHERE hotel_id = hotel_key OR hotel_name = hotel_key
      UNION ALL
      SELECT hotel_name FROM public.hotel_configurations WHERE hotel_id = hotel_key OR hotel_name = hotel_key
    ) t WHERE k IS NOT NULL
  )
  SELECT COALESCE(
    (SELECT c.hide_pms_upload_page
     FROM public.pms_configurations c
     WHERE c.hotel_id IN (SELECT k FROM keys)
       AND c.pms_type = 'previo'
     ORDER BY c.updated_at DESC NULLS LAST
     LIMIT 1),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.get_pms_upload_hidden(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pms_upload_hidden(text) TO authenticated, anon, service_role;