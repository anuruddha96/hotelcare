
ALTER TABLE public.user_training_state
  ADD COLUMN IF NOT EXISTS last_active_step_key text,
  ADD COLUMN IF NOT EXISTS auto_start_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz;

CREATE OR REPLACE FUNCTION public.can_view_training_analytics(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND p.role::text IN ('admin','top_management','top_management_manager',
                     'manager','housekeeping_manager','maintenance_manager','reception_manager')
  );
$$;

CREATE OR REPLACE VIEW public.v_training_completion_by_role
WITH (security_invoker = true) AS
SELECT
  COALESCE(p.role::text,'unknown') AS role,
  utp.tour_key AS curriculum_slug,
  COUNT(*) FILTER (WHERE utp.status = 'completed') AS completed_users,
  COUNT(*) FILTER (WHERE utp.status = 'in_progress') AS in_progress_users,
  COUNT(*) AS total_users,
  ROUND(100.0 * COUNT(*) FILTER (WHERE utp.status = 'completed') / NULLIF(COUNT(*),0), 1) AS completion_pct
FROM public.user_tour_progress utp
LEFT JOIN public.profiles p ON p.id = utp.user_id
WHERE public.can_view_training_analytics(auth.uid())
GROUP BY p.role, utp.tour_key;

CREATE OR REPLACE VIEW public.v_training_step_funnel
WITH (security_invoker = true) AS
SELECT
  utp.tour_key AS curriculum_slug,
  COALESCE(p.role::text,'unknown') AS role,
  s.step_idx,
  COUNT(*) AS users_reached
FROM public.user_tour_progress utp
LEFT JOIN public.profiles p ON p.id = utp.user_id
CROSS JOIN LATERAL generate_series(0, GREATEST(utp.current_step,0)) AS s(step_idx)
WHERE public.can_view_training_analytics(auth.uid())
GROUP BY utp.tour_key, p.role, s.step_idx;

CREATE OR REPLACE VIEW public.v_training_dismissals
WITH (security_invoker = true) AS
SELECT
  COUNT(*) FILTER (WHERE dismissed_until > now()) AS dismissed_count,
  COUNT(*) FILTER (WHERE paused_at IS NOT NULL) AS paused_count
FROM public.user_training_state
WHERE public.can_view_training_analytics(auth.uid());

GRANT SELECT ON public.v_training_completion_by_role TO authenticated;
GRANT SELECT ON public.v_training_step_funnel TO authenticated;
GRANT SELECT ON public.v_training_dismissals TO authenticated;
