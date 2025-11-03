-- Enable pg_cron extension if not already enabled (requires superuser)
-- This is usually done at the database level by Supabase

-- Create a function to call the cleanup edge function
CREATE OR REPLACE FUNCTION public.cleanup_old_photos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_two_weeks_ago timestamp with time zone;
BEGIN
  -- Calculate date 2 weeks ago
  v_two_weeks_ago := now() - interval '14 days';
  
  -- Log the cleanup operation
  RAISE NOTICE 'Starting cleanup of photos older than %', v_two_weeks_ago;
  
  -- Note: The actual file deletion from storage needs to be done via Edge Function
  -- This function just marks/cleans database records
  -- The Edge Function should be called via cron or manually
  
  -- Clean up old DND photos (database records only)
  -- File deletion handled by edge function
  DELETE FROM public.dnd_photos
  WHERE marked_at < v_two_weeks_ago;
  
  -- Clear old completion photos from room_assignments
  -- File deletion handled by edge function
  UPDATE public.room_assignments
  SET completion_photos = '{}',
      notes = CONCAT(COALESCE(notes, ''), ' [Photos auto-deleted after 2 weeks]')
  WHERE completed_at < v_two_weeks_ago
    AND completion_photos IS NOT NULL
    AND array_length(completion_photos, 1) > 0;
    
  RAISE NOTICE 'Cleanup completed successfully';
END;
$$;

-- Grant execute permission to authenticated users (admins can call this)
GRANT EXECUTE ON FUNCTION public.cleanup_old_photos() TO authenticated;

-- Create a manual trigger table for admins to initiate cleanup
CREATE TABLE IF NOT EXISTS public.photo_cleanup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cleanup_date timestamp with time zone NOT NULL DEFAULT now(),
  initiated_by uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending',
  deleted_dnd_photos integer DEFAULT 0,
  deleted_completion_photos integer DEFAULT 0,
  deleted_storage_files integer DEFAULT 0,
  storage_freed_mb numeric DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.photo_cleanup_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view cleanup logs
CREATE POLICY "Admins can view cleanup logs"
  ON public.photo_cleanup_log FOR SELECT
  USING (get_user_role(auth.uid()) = 'admin'::user_role);

-- Only admins can insert cleanup logs
CREATE POLICY "Admins can create cleanup logs"
  ON public.photo_cleanup_log FOR INSERT
  WITH CHECK (
    get_user_role(auth.uid()) = 'admin'::user_role AND
    initiated_by = auth.uid()
  );

COMMENT ON TABLE public.photo_cleanup_log IS 'Log of photo cleanup operations for auditing purposes';
COMMENT ON FUNCTION public.cleanup_old_photos() IS 'Cleans up DND photos and completion photos older than 2 weeks (database records only)';