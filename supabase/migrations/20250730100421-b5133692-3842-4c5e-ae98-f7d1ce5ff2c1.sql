-- Create enum for user roles
CREATE TYPE user_role AS ENUM ('housekeeping', 'reception', 'maintenance', 'manager', 'admin');

-- Create enum for ticket status
CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'completed');

-- Create enum for ticket priority
CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'housekeeping',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create tickets table
CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  room_number TEXT NOT NULL,
  priority ticket_priority NOT NULL DEFAULT 'medium',
  status ticket_status NOT NULL DEFAULT 'open',
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  assigned_to UUID REFERENCES public.profiles(id),
  photo_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create comments table
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  content TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Create function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS user_role AS $$
  SELECT role FROM public.profiles WHERE id = user_id;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can insert profiles" ON public.profiles
  FOR INSERT WITH CHECK (get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE USING (get_user_role(auth.uid()) = 'admin');

-- Tickets policies
CREATE POLICY "All authenticated users can view tickets" ON public.tickets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Housekeeping and reception can create tickets" ON public.tickets
  FOR INSERT WITH CHECK (
    get_user_role(auth.uid()) IN ('housekeeping', 'reception', 'manager', 'admin')
  );

CREATE POLICY "Assigned users and managers can update tickets" ON public.tickets
  FOR UPDATE USING (
    assigned_to = auth.uid() OR 
    get_user_role(auth.uid()) IN ('manager', 'admin')
  );

-- Comments policies
CREATE POLICY "Users can view comments on tickets they can see" ON public.comments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create comments" ON public.comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create function to handle new user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    'housekeeping'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to generate ticket numbers
CREATE OR REPLACE FUNCTION public.generate_ticket_number()
RETURNS TEXT AS $$
DECLARE
  today_date TEXT := to_char(current_date, 'YYYYMMDD');
  ticket_count INTEGER;
  ticket_number TEXT;
BEGIN
  -- Get count of tickets created today
  SELECT COUNT(*) INTO ticket_count
  FROM public.tickets
  WHERE DATE(created_at) = current_date;
  
  -- Generate ticket number
  ticket_number := 'MT-' || today_date || '-' || LPAD((ticket_count + 1)::TEXT, 4, '0');
  
  RETURN ticket_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to auto-generate ticket number on insert
CREATE OR REPLACE FUNCTION public.set_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := generate_ticket_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for ticket number generation
CREATE TRIGGER set_ticket_number_trigger
  BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_ticket_number();

-- Create update timestamp function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updating timestamps
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tickets_updated_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();