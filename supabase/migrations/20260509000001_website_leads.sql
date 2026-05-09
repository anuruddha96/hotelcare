-- Website lead capture table for rdhotels.hu public website
CREATE TABLE IF NOT EXISTS public.website_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_type TEXT NOT NULL DEFAULT 'contact', -- 'contact' or 'career'
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  message TEXT,
  interest TEXT, -- 'management' | 'revenue' | 'hr' | 'other'
  position TEXT, -- for career applications
  language TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.website_leads ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (public lead capture)
CREATE POLICY "Allow public inserts on website_leads"
  ON public.website_leads
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Only authenticated users can read leads
CREATE POLICY "Allow authenticated reads on website_leads"
  ON public.website_leads
  FOR SELECT
  TO authenticated
  USING (true);
