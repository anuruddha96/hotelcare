-- HotelCare AI workspace: projects, pinned chats, rich answers (charts and
-- generated images) and a more detailed audit trail.
--
-- Everything here is additive. The edge functions fall back to the previous
-- columns when this migration has not been applied yet, so the deploy order
-- of database and functions does not matter.

-- 1. Projects -------------------------------------------------------------
-- A project groups a user's conversations and carries standing instructions
-- ("always answer for Hotel Memories, in Hungarian, with a chart"). Projects
-- are private to their owner inside the owner's own organization.
CREATE TABLE IF NOT EXISTS public.assistant_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_slug text DEFAULT public.pi_user_org(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  instructions text NOT NULL DEFAULT '' CHECK (char_length(instructions) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_projects_owner_idx
  ON public.assistant_projects (user_id, organization_slug, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_projects TO authenticated;
GRANT ALL ON public.assistant_projects TO service_role;
ALTER TABLE public.assistant_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own organization projects" ON public.assistant_projects;
CREATE POLICY "own organization projects"
ON public.assistant_projects
FOR ALL
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND organization_slug IS NOT DISTINCT FROM public.pi_user_org()
)
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND organization_slug IS NOT DISTINCT FROM public.pi_user_org()
);

DROP TRIGGER IF EXISTS assistant_projects_updated_at ON public.assistant_projects;
CREATE TRIGGER assistant_projects_updated_at BEFORE UPDATE ON public.assistant_projects
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Threads: pin and project ---------------------------------------------
ALTER TABLE public.assistant_threads
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.assistant_projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS assistant_threads_project_idx
  ON public.assistant_threads (project_id) WHERE project_id IS NOT NULL;

-- A conversation may only be filed under a project of the same owner. RLS
-- already limits which threads a user can update; this closes the gap of
-- pointing an own thread at somebody else's project id.
CREATE OR REPLACE FUNCTION public.assistant_thread_project_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.assistant_projects p
    WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Project does not belong to this conversation owner'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assistant_thread_project_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS assistant_threads_project_guard ON public.assistant_threads;
CREATE TRIGGER assistant_threads_project_guard
BEFORE INSERT OR UPDATE OF project_id ON public.assistant_threads
FOR EACH ROW EXECUTE FUNCTION public.assistant_thread_project_guard();

-- 3. Messages: charts and images survive a reload ---------------------------
-- Only the edge functions (service role) write messages; users keep SELECT.
ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.assistant_messages.attachments IS
  'Rendered extras of an assistant answer: [{kind:"chart",...}] or [{kind:"image",path,...}].';

-- 4. Audit: which conversation, how expensive, how long ---------------------
ALTER TABLE public.assistant_audit_log
  ADD COLUMN IF NOT EXISTS thread_id uuid,
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS workflow text;

CREATE INDEX IF NOT EXISTS assistant_audit_log_user_idx
  ON public.assistant_audit_log (user_id, created_at DESC);

-- 5. Generated images -------------------------------------------------------
-- Private bucket. Path: <owner auth uid>/<file>. Only the edge function
-- (service role) uploads; the owner may read their own files.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'assistant-media',
  'assistant-media',
  false,
  8388608,
  ARRAY['image/png','image/jpeg','image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Assistant media readable by owner" ON storage.objects;
CREATE POLICY "Assistant media readable by owner" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'assistant-media'
  AND split_part(name, '/', 1) = (SELECT auth.uid())::text
);
