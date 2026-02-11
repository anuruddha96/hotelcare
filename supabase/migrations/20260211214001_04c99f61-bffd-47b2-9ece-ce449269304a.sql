-- Fix get_email_by_nickname to fallback to auth.users email when profiles.email is empty
CREATE OR REPLACE FUNCTION public.get_email_by_nickname(p_nickname text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT COALESCE(
    NULLIF(p.email, ''),
    (SELECT a.email FROM auth.users a WHERE a.id = p.id)
  )
  FROM public.profiles p
  WHERE LOWER(p.nickname) = LOWER(p_nickname)
  LIMIT 1;
$$;

-- Also sync existing profiles with empty emails from auth.users
UPDATE public.profiles p
SET email = a.email
FROM auth.users a
WHERE p.id = a.id
AND (p.email IS NULL OR p.email = '' OR p.email LIKE '%@rdhotels.local')
AND a.email IS NOT NULL
AND a.email != '';