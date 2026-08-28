ALTER TABLE public.assistant_threads
  ALTER COLUMN organization_slug SET DEFAULT public.pi_user_org(),
  ALTER COLUMN hotel_id SET DEFAULT public.pi_user_hotel();