-- Maintenance images uploaded by ticket creators must be linked even when the
-- creator has INSERT but not UPDATE privileges on public.tickets.
-- This narrowly scoped RPC updates only attachment_urls on a ticket owned by
-- the caller. A photo must already exist in the private ticket-attachments bucket
-- under that ticket's UUID prefix.
CREATE OR REPLACE FUNCTION public.link_ticket_attachments(
  p_ticket_id uuid,
  p_paths text[]
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_created_by uuid;
  v_organization_slug text;
  v_paths text[];
  v_path text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT t.created_by, t.organization_slug, COALESCE(t.attachment_urls, ARRAY[]::text[])
    INTO v_created_by, v_organization_slug, v_paths
    FROM public.tickets AS t
    WHERE t.id = p_ticket_id
    FOR UPDATE;

  IF NOT FOUND OR v_created_by IS DISTINCT FROM auth.uid()
    OR v_organization_slug IS DISTINCT FROM public.get_user_organization_slug(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed to link attachments to this ticket' USING ERRCODE = '42501';
  END IF;

  IF p_paths IS NULL OR cardinality(p_paths) = 0 OR cardinality(p_paths) > 25 THEN
    RAISE EXCEPTION 'Provide between 1 and 25 uploaded attachment paths' USING ERRCODE = '22023';
  END IF;

  FOREACH v_path IN ARRAY p_paths LOOP
    IF v_path IS NULL
      OR left(v_path, length(p_ticket_id::text) + 1) <> p_ticket_id::text || '/'
      OR length(v_path) <= length(p_ticket_id::text) + 1
      OR position('..' IN v_path) > 0
      OR NOT EXISTS (
        SELECT 1 FROM storage.objects AS o
        WHERE o.bucket_id = 'ticket-attachments' AND o.name = v_path
      )
    THEN
      RAISE EXCEPTION 'Attachment is not stored under this ticket' USING ERRCODE = '22023';
    END IF;
    IF NOT (v_path = ANY(v_paths)) THEN
      v_paths := array_append(v_paths, v_path);
    END IF;
  END LOOP;

  UPDATE public.tickets SET attachment_urls = v_paths WHERE id = p_ticket_id;
  RETURN v_paths;
END;
$$;

REVOKE ALL ON FUNCTION public.link_ticket_attachments(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_ticket_attachments(uuid, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_ticket_attachments(uuid, text[]) TO authenticated;
