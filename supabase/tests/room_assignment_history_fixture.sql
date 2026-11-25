-- Run only on a disposable database after housekeeping_tenant_guard_fixture.sql.
ALTER TABLE public.profiles ADD COLUMN full_name text;
UPDATE public.profiles SET full_name = CASE id::text
  WHEN '00000000-0000-4000-8000-000000000011' THEN 'Manager'
  WHEN '00000000-0000-4000-8000-000000000014' THEN 'Cleaner A'
  WHEN '00000000-0000-4000-8000-000000000017' THEN 'Cleaner B'
  ELSE 'Other' END;
ALTER TABLE public.rooms ADD COLUMN room_number text NOT NULL DEFAULT '042';
ALTER TABLE public.room_assignments ADD COLUMN assigned_by uuid;
