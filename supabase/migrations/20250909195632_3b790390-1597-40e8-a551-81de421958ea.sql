-- Fix the remaining functions with mutable search paths
-- Update the remaining functions to have secure search_path

-- Fix user_can_view_ticket
CREATE OR REPLACE FUNCTION public.user_can_view_ticket(ticket_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tickets t 
    WHERE t.id = ticket_id 
    AND EXISTS (
      SELECT 1
      FROM public.get_user_access_config(public.get_user_role(auth.uid())) config(department, access_scope, can_manage_all)
      WHERE (
        config.can_manage_all = true 
        OR (
          (config.department = 'all' OR config.department = t.department OR (config.department = 'front_office' AND t.department = 'reception'))
          AND (
            config.access_scope = 'all_hotels'
            OR (config.access_scope = 'hotel_only' AND ((SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = public.get_hotel_name_from_id(t.hotel) OR (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = t.hotel))
            OR (config.access_scope = 'assigned_and_created' AND (t.assigned_to = auth.uid() OR t.created_by = auth.uid() OR (((SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = public.get_hotel_name_from_id(t.hotel) OR (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = t.hotel) AND config.department = t.department)))
          )
        )
      )
    )
  );
$function$;

-- Fix get_current_user_role
CREATE OR REPLACE FUNCTION public.get_current_user_role()
 RETURNS public.user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$function$;

-- Fix get_user_role
CREATE OR REPLACE FUNCTION public.get_user_role(user_id uuid)
 RETURNS public.user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT role FROM public.profiles WHERE id = user_id;
$function$;

-- Fix get_user_role_safe
CREATE OR REPLACE FUNCTION public.get_user_role_safe(user_id uuid)
 RETURNS public.user_role
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT role FROM public.profiles WHERE id = user_id;
$function$;

-- Fix has_ticket_creation_permission
CREATE OR REPLACE FUNCTION public.has_ticket_creation_permission(_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role public.user_role;
  v_user_allowed boolean;
  v_role_allowed boolean;
begin
  select role into v_role from public.profiles where id = _user_id;

  select can_create into v_user_allowed 
  from public.ticket_creation_config 
  where user_id = _user_id;

  if v_user_allowed is not null then
    return v_user_allowed;
  end if;

  if v_role is not null then
    select can_create into v_role_allowed 
    from public.ticket_creation_config 
    where role = v_role;

    if v_role_allowed is not null then
      return v_role_allowed;
    end if;
  end if;

  return true; -- default allow if not configured
end;
$function$;