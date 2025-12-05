-- Create function to get hotels for current user's organization
CREATE OR REPLACE FUNCTION public.get_user_organization_hotels()
RETURNS TABLE (
  id uuid,
  hotel_id text,
  hotel_name text,
  organization_id uuid,
  settings jsonb,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_org_slug text;
  org_id uuid;
BEGIN
  -- Get user's organization slug from their profile
  SELECT p.organization_slug INTO user_org_slug
  FROM profiles p
  WHERE p.id = auth.uid();
  
  IF user_org_slug IS NULL THEN
    RETURN;
  END IF;
  
  -- Get organization ID from slug
  SELECT o.id INTO org_id
  FROM organizations o
  WHERE o.slug = user_org_slug AND o.is_active = true;
  
  IF org_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Return hotels for this organization
  RETURN QUERY
  SELECT h.id, h.hotel_id, h.hotel_name, h.organization_id, h.settings, h.is_active
  FROM hotel_configurations h
  WHERE h.organization_id = org_id AND h.is_active = true
  ORDER BY h.hotel_name;
END;
$$;