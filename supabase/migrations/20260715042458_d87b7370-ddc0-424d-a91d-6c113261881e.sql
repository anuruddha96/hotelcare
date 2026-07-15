CREATE OR REPLACE FUNCTION public.hotel_has_active_previo(_hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pms_configurations
    WHERE hotel_id = _hotel_id
      AND pms_type = 'previo'
      AND is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.hotel_has_active_previo(text) TO authenticated;