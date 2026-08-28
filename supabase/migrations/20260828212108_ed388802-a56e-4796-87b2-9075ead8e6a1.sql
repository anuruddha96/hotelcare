CREATE TABLE public.assistant_paid_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_slug text,
  hotel_id text,
  question text,
  amount_eur numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.assistant_paid_questions TO authenticated;
GRANT ALL ON public.assistant_paid_questions TO service_role;
ALTER TABLE public.assistant_paid_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see their own paid questions"
  ON public.assistant_paid_questions FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Admins see organization paid questions"
  ON public.assistant_paid_questions FOR SELECT TO authenticated
  USING (
    organization_slug = public.pi_user_org()
    AND public.get_current_user_role() IN ('admin','top_management','top_management_manager')
  );
CREATE INDEX idx_assistant_paid_questions_user_day
  ON public.assistant_paid_questions (user_id, created_at DESC);