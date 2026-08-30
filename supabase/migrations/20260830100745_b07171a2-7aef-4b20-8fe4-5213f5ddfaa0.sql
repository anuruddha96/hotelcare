ALTER TABLE public.revenue_date_decisions
  ADD COLUMN IF NOT EXISTS movement_requested numeric,
  ADD COLUMN IF NOT EXISTS limited_by_room_type text;