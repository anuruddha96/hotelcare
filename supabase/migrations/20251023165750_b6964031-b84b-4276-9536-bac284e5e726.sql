-- Create early sign-out requests table for tracking early check-outs that need approval
CREATE TABLE IF NOT EXISTS public.early_signout_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attendance_id UUID NOT NULL REFERENCES public.staff_attendance(id) ON DELETE CASCADE,
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  organization_slug TEXT DEFAULT 'rdhotels'
);

-- Enable RLS on early_signout_requests
ALTER TABLE public.early_signout_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own requests
CREATE POLICY "Users can view their own early signout requests"
  ON public.early_signout_requests
  FOR SELECT
  USING (user_id = auth.uid() OR get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role]));

-- Policy: Users can create their own requests
CREATE POLICY "Users can create early signout requests"
  ON public.early_signout_requests
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Policy: Managers can update requests
CREATE POLICY "Managers can update early signout requests"
  ON public.early_signout_requests
  FOR UPDATE
  USING (get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role]));

-- Add index for faster queries
CREATE INDEX idx_early_signout_requests_status ON public.early_signout_requests(status);
CREATE INDEX idx_early_signout_requests_user_id ON public.early_signout_requests(user_id);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.early_signout_requests;