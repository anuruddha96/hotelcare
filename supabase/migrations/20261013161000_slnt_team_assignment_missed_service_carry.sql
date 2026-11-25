-- SLNT uses its own team task queue. When a task is claimed and creates a
-- room_assignment, the existing shared carry engine must attach any missed
-- DND/No Service debt from the same continuing reservation. Do not generate
-- unrostered tasks or change SLNT housekeeper assignments.
CREATE OR REPLACE FUNCTION public.hc_portfolio_carry_property_id(p_hotel text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $body$
  SELECT CASE lower(btrim(coalesce(p_hotel,'')))
    WHEN 'mika-downtown' THEN 'mika-downtown'
    WHEN 'hotel mika downtown' THEN 'mika-downtown'
    WHEN 'mika downtown' THEN 'mika-downtown'
    WHEN 'ottofiori' THEN 'ottofiori'
    WHEN 'hotel ottofiori' THEN 'ottofiori'
    WHEN 'gozsdu-court' THEN 'gozsdu-court'
    WHEN 'gozsdu court budapest' THEN 'gozsdu-court'
    WHEN 'slnt-group' THEN 'slnt-group'
    WHEN 'slnt group' THEN 'slnt-group'
    ELSE NULL
  END
$body$;
