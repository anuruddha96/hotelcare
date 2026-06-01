ALTER TABLE public.user_tour_progress
  ADD COLUMN IF NOT EXISTS current_step int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_steps int[] NOT NULL DEFAULT '{}'::int[],
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'in_progress',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();