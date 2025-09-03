-- EMERGENCY FIX: Temporarily disable RLS on profiles to stop infinite recursion
-- This will allow the application to function while we fix the root cause

-- Disable RLS entirely on profiles table temporarily
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;

-- We'll re-enable with proper policies in the next step after testing