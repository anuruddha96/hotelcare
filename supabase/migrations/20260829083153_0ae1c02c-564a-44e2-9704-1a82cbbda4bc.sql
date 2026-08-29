ALTER TABLE public.revenue_rate_drafts
  ADD COLUMN IF NOT EXISTS decision_id uuid REFERENCES public.revenue_date_decisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS reason_detail text;

CREATE INDEX IF NOT EXISTS revenue_rate_drafts_decision_id_idx ON public.revenue_rate_drafts(decision_id);

ALTER TABLE public.revenue_date_decisions
  ADD COLUMN IF NOT EXISTS window_id text,
  ADD COLUMN IF NOT EXISTS simulated_cells jsonb,
  ADD COLUMN IF NOT EXISTS cells_simulated integer NOT NULL DEFAULT 0;

ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS expected_sellable_rooms integer;

ALTER TABLE public.revenue_rate_drafts
  DROP CONSTRAINT IF EXISTS revenue_rate_drafts_whole_euro_chk;
ALTER TABLE public.revenue_rate_drafts
  ADD CONSTRAINT revenue_rate_drafts_whole_euro_chk
  CHECK (new_price IS NULL OR new_price = round(new_price)) NOT VALID;

ALTER TABLE public.revenue_rate_push_items
  DROP CONSTRAINT IF EXISTS revenue_rate_push_items_whole_euro_chk;
ALTER TABLE public.revenue_rate_push_items
  ADD CONSTRAINT revenue_rate_push_items_whole_euro_chk
  CHECK (target_price IS NULL OR target_price = round(target_price)) NOT VALID;

ALTER TABLE public.revenue_date_decisions
  DROP CONSTRAINT IF EXISTS revenue_date_decisions_whole_euro_chk;
ALTER TABLE public.revenue_date_decisions
  ADD CONSTRAINT revenue_date_decisions_whole_euro_chk
  CHECK (
    (target_price IS NULL OR target_price = round(target_price))
    AND (current_price IS NULL OR current_price = round(current_price))
    AND (movement IS NULL OR movement = round(movement))
  ) NOT VALID;