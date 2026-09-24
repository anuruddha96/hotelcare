DROP TABLE IF EXISTS public.room_assignments CASCADE;
DROP TABLE IF EXISTS public.rooms CASCADE;

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY,
  organization_slug text,
  status text,
  pms_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.room_assignments (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.rooms(id),
  assigned_to uuid,
  status text NOT NULL DEFAULT 'assigned'
);
