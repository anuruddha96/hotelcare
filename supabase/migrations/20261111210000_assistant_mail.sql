-- HotelCare AI: personal mailbox connection (Gmail / Microsoft 365 via OAuth,
-- or any other mailbox via IMAP + SMTP with the person's own password).
--
-- A manager connects their OWN mailbox. The assistant can then search and read
-- it and prepare replies, but an email only leaves after the person taps Send
-- on a card that shows the exact recipients, subject and text.
--
-- Tokens, OAuth states and drafts are server-only: RLS is on and there is no
-- policy for signed-in users, so only the edge functions (service role) can
-- reach them. The send log is readable by administrators, like the assistant
-- audit log. It records who sent what to whom and when — never the body.

-- 1. Connected mailboxes ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assistant_mail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_slug text,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft', 'imap')),
  email text NOT NULL,
  display_name text,
  -- OAuth: the encrypted refresh token. IMAP: the encrypted mailbox password.
  refresh_token_ciphertext text NOT NULL,
  -- IMAP only: {imap_host, imap_port, smtp_host, smtp_port, username}. No secrets.
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  access_token_ciphertext text,
  access_token_expires_at timestamptz,
  scopes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reconnect_required')),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, email)
);

-- 2. One-time OAuth states ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assistant_mail_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_slug text,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  return_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Drafts waiting for the person's tap -------------------------------------
CREATE TABLE IF NOT EXISTS public.assistant_mail_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_slug text,
  account_id uuid NOT NULL REFERENCES public.assistant_mail_accounts(id) ON DELETE CASCADE,
  assistant_thread_id uuid,
  to_addresses text[] NOT NULL,
  cc_addresses text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  body text NOT NULL,
  reply_to_message_id text,
  reply_thread_id text,
  reply_header_message_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'discarded', 'failed')),
  error text,
  provider_message_id text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '48 hours',
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_mail_drafts_owner_idx
  ON public.assistant_mail_drafts (user_id, created_at DESC);

-- 4. Send log (no message bodies) --------------------------------------------
CREATE TABLE IF NOT EXISTS public.assistant_mail_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_slug text,
  provider text NOT NULL,
  from_email text NOT NULL,
  to_addresses text[] NOT NULL,
  cc_addresses text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  is_reply boolean NOT NULL DEFAULT false,
  outcome text NOT NULL CHECK (outcome IN ('sent', 'failed', 'connected', 'disconnected')),
  error text,
  draft_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_mail_log_org_idx
  ON public.assistant_mail_log (organization_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_mail_log_user_idx
  ON public.assistant_mail_log (user_id, created_at DESC);

-- Access ------------------------------------------------------------------
ALTER TABLE public.assistant_mail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_mail_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_mail_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_mail_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.assistant_mail_accounts, public.assistant_mail_oauth_states,
  public.assistant_mail_drafts, public.assistant_mail_log FROM anon, authenticated;
GRANT ALL ON public.assistant_mail_accounts, public.assistant_mail_oauth_states,
  public.assistant_mail_drafts, public.assistant_mail_log TO service_role;
GRANT SELECT ON public.assistant_mail_log TO authenticated;

DROP POLICY IF EXISTS "admins read mail log" ON public.assistant_mail_log;
CREATE POLICY "admins read mail log" ON public.assistant_mail_log FOR SELECT TO authenticated
  USING (
    public.get_current_user_role()::text = 'admin'
    OR (public.get_current_user_role()::text IN ('top_management', 'top_management_manager')
        AND organization_slug = public.pi_user_org())
  );

DROP TRIGGER IF EXISTS assistant_mail_accounts_updated_at ON public.assistant_mail_accounts;
CREATE TRIGGER assistant_mail_accounts_updated_at BEFORE UPDATE ON public.assistant_mail_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS assistant_mail_drafts_updated_at ON public.assistant_mail_drafts;
CREATE TRIGGER assistant_mail_drafts_updated_at BEFORE UPDATE ON public.assistant_mail_drafts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
