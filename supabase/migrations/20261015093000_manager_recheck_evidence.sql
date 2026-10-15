-- Private manager evidence for returned housekeeping work.
-- The photos belong to the NEW assignment, not the housekeeper's completion photos.
ALTER TABLE public.room_assignments
  ADD COLUMN IF NOT EXISTS recheck_photos text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.room_assignments.recheck_photos IS
  'Private storage paths for supervisor findings shown to the assignee on a returned cleaning task.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'manager-recheck-evidence',
  'manager-recheck-evidence',
  false,
  8388608,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Paths: <uploader auth UID>/<new assignment UUID>/<photo name>.
-- A manager may upload evidence only under their own UID.
CREATE POLICY "Managers upload their recheck evidence" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'manager-recheck-evidence'
  AND split_part(name, '/', 1) = (SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = (SELECT auth.uid())
      AND p.role IN ('admin', 'top_management', 'top_management_manager',
                     'manager', 'housekeeping_manager', 'supervisor')
      AND p.organization_slug IS NOT NULL
  )
);

-- Keep photos tenant-private, but let the assigned housekeeper and managers
-- of the assignment's own organization view them. The uploader also needs
-- SELECT during upload and rollback.
CREATE POLICY "Recheck evidence visible to assigned staff" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'manager-recheck-evidence'
  AND (
    split_part(name, '/', 1) = (SELECT auth.uid())::text
    OR EXISTS (
      SELECT 1 FROM public.room_assignments a
      JOIN public.profiles p ON p.user_id = (SELECT auth.uid())
      WHERE a.id::text = split_part(name, '/', 2)
        AND a.organization_slug = p.organization_slug
        AND (
          a.assigned_to = p.id
          OR p.role IN ('admin', 'top_management', 'top_management_manager',
                        'manager', 'housekeeping_manager', 'supervisor')
        )
    )
  )
);

CREATE POLICY "Managers delete their pending recheck evidence" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'manager-recheck-evidence'
  AND split_part(name, '/', 1) = (SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = (SELECT auth.uid())
      AND p.role IN ('admin', 'top_management', 'top_management_manager',
                     'manager', 'housekeeping_manager', 'supervisor')
  )
);
