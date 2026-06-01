-- Training v2: extend schema for role-aware, smart, cross-page training
ALTER TABLE public.training_guides
  ADD COLUMN IF NOT EXISTS target_roles text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'core',
  ADD COLUMN IF NOT EXISTS auto_start boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS priority int NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS icon text;

ALTER TABLE public.training_guide_steps
  ADD COLUMN IF NOT EXISTS route text,
  ADD COLUMN IF NOT EXISTS tab text,
  ADD COLUMN IF NOT EXISTS precondition text,
  ADD COLUMN IF NOT EXISTS wait_for_event text,
  ADD COLUMN IF NOT EXISTS optional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS cta_label_key text;

-- Per-user state (one row per user) for promos + dismissal + resume hint
CREATE TABLE IF NOT EXISTS public.user_training_state (
  user_id uuid PRIMARY KEY,
  seen_promos text[] NOT NULL DEFAULT '{}'::text[],
  dismissed_until timestamptz,
  last_guide_slug text,
  last_step int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_training_state TO authenticated;
GRANT ALL ON public.user_training_state TO service_role;

ALTER TABLE public.user_training_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own training state" ON public.user_training_state;
CREATE POLICY "Users manage their own training state"
ON public.user_training_state
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);