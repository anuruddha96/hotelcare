ALTER TABLE public.user_training_state
  ADD COLUMN IF NOT EXISTS deferred_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_auto_start_at timestamptz;