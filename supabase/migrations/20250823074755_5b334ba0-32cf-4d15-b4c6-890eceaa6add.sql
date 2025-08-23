-- Add hotel field and other missing fields to tickets table
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS hotel TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS sla_breach_reason TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS attachment_urls TEXT[];
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS sub_category TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS sub_sub_category TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS sla_due_date TIMESTAMP WITH TIME ZONE;

-- Create ticket_categories table for structured category management
CREATE TABLE IF NOT EXISTS public.ticket_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  department user_role NOT NULL,
  category_key TEXT NOT NULL,
  category_name TEXT NOT NULL,
  sub_category_key TEXT,
  sub_category_name TEXT,
  sub_sub_category_key TEXT,
  sub_sub_category_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(department, category_key, sub_category_key, sub_sub_category_key)
);

-- Enable RLS on ticket_categories
ALTER TABLE public.ticket_categories ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for ticket_categories
CREATE POLICY "All authenticated users can view categories" 
ON public.ticket_categories 
FOR SELECT 
USING (true);