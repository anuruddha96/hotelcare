CREATE TABLE public.client_error_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  organization_slug TEXT,
  hotel TEXT,
  route TEXT,
  last_action TEXT,
  context TEXT,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  component_stack TEXT,
  user_agent TEXT,
  screen_size TEXT,
  device_memory TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT INSERT ON public.client_error_logs TO authenticated;
GRANT SELECT ON public.client_error_logs TO authenticated;
GRANT ALL ON public.client_error_logs TO service_role;

ALTER TABLE public.client_error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated devices can record crashes"
ON public.client_error_logs
FOR INSERT
TO authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Admins can read crash logs"
ON public.client_error_logs
FOR SELECT
TO authenticated
USING (public.get_user_role_safe(auth.uid()) IN ('admin', 'top_management'));

CREATE INDEX idx_client_error_logs_created_at ON public.client_error_logs (created_at DESC);