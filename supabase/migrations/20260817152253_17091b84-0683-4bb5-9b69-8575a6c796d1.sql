CREATE TABLE public.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  organization_slug text,
  hotel_id text,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_threads TO authenticated;
GRANT ALL ON public.assistant_threads TO service_role;
ALTER TABLE public.assistant_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own threads" ON public.assistant_threads FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.assistant_threads(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null default '',
  model text,
  scopes_used text[] not null default '{}',
  refused boolean not null default false,
  created_at timestamptz not null default now()
);
CREATE INDEX assistant_messages_thread_idx ON public.assistant_messages(thread_id, created_at);
GRANT SELECT, INSERT, DELETE ON public.assistant_messages TO authenticated;
GRANT ALL ON public.assistant_messages TO service_role;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own messages" ON public.assistant_messages FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.assistant_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  organization_slug text,
  hotel_id text,
  requested_scope text not null,
  question text not null default '',
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  decided_by uuid,
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
CREATE INDEX assistant_access_requests_user_idx ON public.assistant_access_requests(user_id, status);
GRANT SELECT, INSERT, UPDATE ON public.assistant_access_requests TO authenticated;
GRANT ALL ON public.assistant_access_requests TO service_role;
ALTER TABLE public.assistant_access_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "requester reads own" ON public.assistant_access_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "requester creates own" ON public.assistant_access_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "approvers read org" ON public.assistant_access_requests FOR SELECT TO authenticated
  USING (
    public.get_current_user_role()::text IN ('admin','top_management','top_management_manager','manager')
    AND (public.get_current_user_role()::text = 'admin' OR organization_slug = public.pi_user_org())
  );
CREATE POLICY "approvers decide org" ON public.assistant_access_requests FOR UPDATE TO authenticated
  USING (
    public.get_current_user_role()::text IN ('admin','top_management','top_management_manager','manager')
    AND (public.get_current_user_role()::text = 'admin' OR organization_slug = public.pi_user_org())
  )
  WITH CHECK (
    public.get_current_user_role()::text IN ('admin','top_management','top_management_manager','manager')
    AND (public.get_current_user_role()::text = 'admin' OR organization_slug = public.pi_user_org())
  );

CREATE TABLE public.assistant_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  organization_slug text,
  hotel_id text,
  role text,
  question text not null default '',
  refused boolean not null default false,
  scopes_used text[] not null default '{}',
  model text,
  created_at timestamptz not null default now()
);
CREATE INDEX assistant_audit_log_org_idx ON public.assistant_audit_log(organization_slug, created_at DESC);
GRANT SELECT ON public.assistant_audit_log TO authenticated;
GRANT ALL ON public.assistant_audit_log TO service_role;
ALTER TABLE public.assistant_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit" ON public.assistant_audit_log FOR SELECT TO authenticated
  USING (
    public.get_current_user_role()::text = 'admin'
    OR (public.get_current_user_role()::text IN ('top_management','top_management_manager')
        AND organization_slug = public.pi_user_org())
  );

CREATE TRIGGER assistant_threads_updated_at BEFORE UPDATE ON public.assistant_threads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();