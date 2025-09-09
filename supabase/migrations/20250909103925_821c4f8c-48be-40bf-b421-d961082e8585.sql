-- Create break_requests table for special break approvals
CREATE TABLE public.break_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  break_type_id UUID NOT NULL REFERENCES public.break_types(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add RLS policies for break_requests
ALTER TABLE public.break_requests ENABLE ROW LEVEL SECURITY;

-- Users can view their own break requests and managers/admins can view all
CREATE POLICY "Users can view own break requests"
ON public.break_requests
FOR SELECT
USING (user_id = auth.uid() OR requested_by = auth.uid() OR get_user_role(auth.uid()) = ANY(ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role]));

-- Users can create break requests for themselves
CREATE POLICY "Users can create own break requests"
ON public.break_requests
FOR INSERT
WITH CHECK (requested_by = auth.uid());

-- Managers and admins can update break requests (approve/reject)
CREATE POLICY "Managers can update break requests"
ON public.break_requests
FOR UPDATE
USING (get_user_role(auth.uid()) = ANY(ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role]));

-- Add language preference to profiles
ALTER TABLE public.profiles ADD COLUMN preferred_language TEXT DEFAULT 'en';

-- Add notification preferences table
CREATE TABLE public.notification_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  browser_notifications_enabled BOOLEAN DEFAULT false,
  sound_notifications_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Add RLS policies for notification preferences
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own notification preferences"
ON public.notification_preferences
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Create trigger to update updated_at column
CREATE TRIGGER update_break_requests_updated_at
BEFORE UPDATE ON public.break_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_notification_preferences_updated_at
BEFORE UPDATE ON public.notification_preferences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();