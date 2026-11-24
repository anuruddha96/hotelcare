-- Return only room-level names from the latest applied revision, never the
-- stored OTA payload. Read-only hints are not identity records or VIZA evidence.
CREATE OR REPLACE FUNCTION public.pms_express_channel_guest_hints(_reservation_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $hints$
DECLARE
  r public.reservations%ROWTYPE;
  revision_payload jsonb;
  room_guests jsonb;
  result jsonb;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=_reservation_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT COALESCE(public.can_access_pms_hotel(auth.uid(),r.hotel_id,r.organization_slug),false) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  IF r.channex_booking_id IS NULL OR r.channex_room_index IS NULL OR r.channex_room_index<0 THEN RETURN '[]'::jsonb; END IF;
  -- Exact reservation membership and room index, not a fuzzy match on booker name.
  -- Do not fall back to old payloads after the latest payload has been purged.
  SELECT b.payload INTO revision_payload FROM public.channex_booking_revisions b
    WHERE b.hotel_id::text=r.hotel_id::text AND b.channex_booking_id::text=r.channex_booking_id::text
      AND r.id::text=ANY(b.reservation_ids::text[]) AND b.state='applied'
    ORDER BY b.created_at DESC,b.id DESC LIMIT 1;
  IF jsonb_typeof(revision_payload->'rooms') IS DISTINCT FROM 'array' THEN RETURN '[]'::jsonb; END IF;
  room_guests := revision_payload->'rooms'->r.channex_room_index->'guests';
  IF jsonb_typeof(room_guests) IS DISTINCT FROM 'array' THEN RETURN '[]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('first_name',first_name,'last_name',last_name) ORDER BY ord),'[]'::jsonb)
    INTO result FROM (
      SELECT left(btrim(CASE WHEN jsonb_typeof(item->'name')='string' THEN item->>'name' ELSE '' END),200) AS first_name,
             left(btrim(CASE WHEN jsonb_typeof(item->'surname')='string' THEN item->>'surname' ELSE '' END),200) AS last_name, ord
      FROM jsonb_array_elements(room_guests) WITH ORDINALITY AS x(item,ord)
      WHERE jsonb_typeof(item)='object' AND ord<=100
    ) names WHERE first_name<>'' OR last_name<>'';
  RETURN result;
END;
$hints$;
REVOKE ALL ON FUNCTION public.pms_express_channel_guest_hints(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pms_express_channel_guest_hints(uuid) TO authenticated;
