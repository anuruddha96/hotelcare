-- Extra photo angles are optional; preserve the existing five-category proof,
-- DND workflow, towel-only service, supervisor approvals and historical URLs.
-- This RPC only appends a verified new object to an active assigned room.
CREATE OR REPLACE FUNCTION public.append_housekeeping_photo_angle(
  p_assignment_id uuid,
  p_path text,
  p_photo_url text
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  a public.room_assignments%ROWTYPE;
  r public.rooms%ROWTYPE;
  result text[];
  expected_prefix text;
  expected_url text;
  filename text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to add room photos';
  END IF;

  -- Lock the assignment before appending, ensuring concurrent captures do not
  -- overwrite one another or drop an existing category/skip proof image.
  SELECT * INTO a FROM public.room_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND OR a.assigned_to IS DISTINCT FROM auth.uid()
     OR a.status::text NOT IN ('assigned', 'in_progress') THEN
    RAISE EXCEPTION 'This room is not an active assignment for the housekeeper';
  END IF;
  SELECT * INTO r FROM public.rooms WHERE id = a.room_id;
  IF NOT FOUND OR r.organization_slug IS DISTINCT FROM public.get_user_organization_slug(auth.uid())
     OR coalesce(a.organization_slug, r.organization_slug) IS DISTINCT FROM r.organization_slug THEN
    RAISE EXCEPTION 'Room organization mismatch';
  END IF;

  expected_prefix := auth.uid()::text || '/' || regexp_replace(r.room_number, '[^a-zA-Z0-9_-]', '_', 'g') || '/';
  filename := substring(p_path FROM '[^/]+$');
  expected_url := 'https://pcmszqqklkolvvlabohq.supabase.co/storage/v1/object/public/room-photos/' || p_path;
  IF p_path IS NULL OR left(p_path, length(expected_prefix)) <> expected_prefix
     OR filename IS NULL
     OR filename !~ '^(bed|bathroom|trash_bin|minibar|tea_coffee_table)_photo_angle_[0-9]+_[a-z0-9]+\.(jpg|png|webp)$'
     OR p_photo_url IS DISTINCT FROM expected_url THEN
    RAISE EXCEPTION 'Invalid room photo location';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'room-photos' AND o.name = p_path) THEN
    RAISE EXCEPTION 'Uploaded photo was not found';
  END IF;

  -- Repeated delivery of the same URL is idempotent. Never delete a real photo,
  -- replace another user's evidence or change any cleaning/PMS state here.
  result := coalesce(a.completion_photos, ARRAY[]::text[]);
  IF NOT p_photo_url = ANY(result) THEN
    UPDATE public.room_assignments
       SET completion_photos = array_append(coalesce(completion_photos, ARRAY[]::text[]), p_photo_url)
     WHERE id = p_assignment_id
     RETURNING completion_photos INTO result;
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.append_housekeeping_photo_angle(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_housekeeping_photo_angle(uuid, text, text) TO authenticated;
