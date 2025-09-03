-- Create function to resolve email by username (nickname) for login
create or replace function public.get_email_by_nickname(p_nickname text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email
  from public.profiles
  where nickname = p_nickname
  limit 1;
$$;