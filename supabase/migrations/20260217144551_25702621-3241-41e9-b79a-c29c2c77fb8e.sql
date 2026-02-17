
-- Create a function to upsert assignment patterns (increment pair_count for existing pairs)
CREATE OR REPLACE FUNCTION public.upsert_assignment_pattern(
  p_hotel text,
  p_room_a text,
  p_room_b text,
  p_org_slug text DEFAULT 'rdhotels'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO assignment_patterns (hotel, room_number_a, room_number_b, organization_slug, pair_count, last_seen_at)
  VALUES (p_hotel, p_room_a, p_room_b, p_org_slug, 1, now())
  ON CONFLICT (hotel, room_number_a, room_number_b, organization_slug)
  DO UPDATE SET
    pair_count = assignment_patterns.pair_count + 1,
    last_seen_at = now();
END;
$$;
