CREATE TABLE public.assistant_issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_slug text,
  hotel_id text,
  thread_id uuid REFERENCES public.assistant_threads(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'other',
  severity text NOT NULL DEFAULT 'normal',
  title text NOT NULL,
  user_description text,
  ai_summary text,
  current_route text,
  module text,
  tab text,
  entity_type text,
  entity_id text,
  device text,
  app_language text,
  status text NOT NULL DEFAULT 'new',
  admin_notes text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assistant_issue_reports_user_idx ON public.assistant_issue_reports (user_id, created_at DESC);
CREATE INDEX assistant_issue_reports_org_idx ON public.assistant_issue_reports (organization_slug, status, created_at DESC);

GRANT SELECT, INSERT ON public.assistant_issue_reports TO authenticated;
GRANT ALL ON public.assistant_issue_reports TO service_role;
ALTER TABLE public.assistant_issue_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own assistant issue reports"
  ON public.assistant_issue_reports FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.get_current_user_role() = 'admin');

CREATE POLICY "Users create their own assistant issue reports"
  ON public.assistant_issue_reports FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER update_assistant_issue_reports_updated_at
  BEFORE UPDATE ON public.assistant_issue_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.assistant_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_slug text,
  hotel_id text,
  thread_id uuid REFERENCES public.assistant_threads(id) ON DELETE CASCADE,
  message_id text,
  helpful boolean NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assistant_feedback_thread_idx ON public.assistant_feedback (thread_id, created_at DESC);

GRANT SELECT, INSERT ON public.assistant_feedback TO authenticated;
GRANT ALL ON public.assistant_feedback TO service_role;
ALTER TABLE public.assistant_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own assistant feedback"
  ON public.assistant_feedback FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.get_current_user_role() = 'admin');

CREATE POLICY "Users create their own assistant feedback"
  ON public.assistant_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());