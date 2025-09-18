-- First, clean up duplicate dirty linen counts keeping only the latest entry
WITH duplicates AS (
  SELECT 
    housekeeper_id, 
    room_id, 
    linen_item_id, 
    work_date,
    MIN(id) as keep_id
  FROM public.dirty_linen_counts
  GROUP BY housekeeper_id, room_id, linen_item_id, work_date
  HAVING COUNT(*) > 1
)
DELETE FROM public.dirty_linen_counts dlc
WHERE EXISTS (
  SELECT 1 FROM duplicates d 
  WHERE d.housekeeper_id = dlc.housekeeper_id 
    AND d.room_id = dlc.room_id 
    AND d.linen_item_id = dlc.linen_item_id 
    AND d.work_date = dlc.work_date 
    AND d.keep_id != dlc.id
);

-- Now add the unique constraint
ALTER TABLE public.dirty_linen_counts 
ADD CONSTRAINT dirty_linen_counts_unique 
UNIQUE (housekeeper_id, room_id, linen_item_id, work_date);

-- Create PMS upload summary table for managers/admins to view later
CREATE TABLE IF NOT EXISTS public.pms_upload_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid REFERENCES public.profiles(id) NOT NULL,
  upload_date timestamp with time zone DEFAULT now(),
  processed_rooms integer DEFAULT 0,
  updated_rooms integer DEFAULT 0,
  assigned_rooms integer DEFAULT 0,
  checkout_rooms jsonb DEFAULT '[]'::jsonb,
  daily_cleaning_rooms jsonb DEFAULT '[]'::jsonb,
  errors jsonb DEFAULT '[]'::jsonb,
  hotel_filter text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on PMS upload summary
ALTER TABLE public.pms_upload_summary ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for PMS upload summary
CREATE POLICY "Managers and admins can view PMS upload summaries"
ON public.pms_upload_summary
FOR SELECT
USING (get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role]));

CREATE POLICY "Managers and admins can create PMS upload summaries"
ON public.pms_upload_summary
FOR INSERT
WITH CHECK (
  get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role])
  AND uploaded_by = auth.uid()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_pms_upload_summary_date ON public.pms_upload_summary(upload_date DESC);
CREATE INDEX IF NOT EXISTS idx_pms_upload_summary_user ON public.pms_upload_summary(uploaded_by);