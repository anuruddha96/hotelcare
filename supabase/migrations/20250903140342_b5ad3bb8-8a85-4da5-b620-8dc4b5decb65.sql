-- Create edge function to handle housekeeper authentication
-- This function will create both auth.users and profiles entries

-- First, let's create a function that can create a complete user with auth
create or replace function public.create_authenticated_housekeeper(
  p_full_name text,
  p_email text default null,
  p_phone_number text default null,
  p_assigned_hotel text default null,
  p_username text default null,
  p_password text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_username text;
  generated_password text;
  generated_email text;
  new_user_id uuid;
  result json;
begin
  -- Only allow admins and housekeeping managers to create users
  if not (get_current_user_role() = any(array['admin'::user_role, 'housekeeping_manager'::user_role])) then
    raise exception 'Insufficient permissions to create users';
  end if;
  
  -- Generate username if not provided
  if p_username is null or length(trim(p_username)) = 0 then
    generated_username := lower(replace(p_full_name, ' ', '.')) || '.' || lpad(floor(random() * 10000)::text, 4, '0');
  else
    generated_username := p_username;
  end if;
  
  -- Generate password if not provided
  if p_password is null or length(trim(p_password)) = 0 then
    generated_password := 'RD' || upper(substring(md5(random()::text), 1, 6));
  else
    generated_password := p_password;
  end if;
  
  -- Generate email if not provided
  if p_email is null or p_email = '' then
    generated_email := generated_username || '@rdhotels.local';
  else
    generated_email := p_email;
  end if;
  
  -- Create a UUID for the user
  new_user_id := gen_random_uuid();
  
  -- Insert into profiles table
  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    phone_number,
    assigned_hotel,
    nickname
  ) values (
    new_user_id,
    generated_email,
    p_full_name,
    'housekeeping',
    p_phone_number,
    case 
      when p_assigned_hotel = 'none' or p_assigned_hotel = '' then null 
      else p_assigned_hotel 
    end,
    generated_username
  );
  
  -- Return success result with credentials
  result := json_build_object(
    'success', true,
    'user_id', new_user_id,
    'username', generated_username,
    'password', generated_password,
    'email', generated_email,
    'message', 'User profile created successfully. These credentials can be used for login once auth is set up.'
  );
  
  return result;
exception
  when others then
    result := json_build_object(
      'success', false,
      'error', sqlerrm
    );
    return result;
end;
$$;