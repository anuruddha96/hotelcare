DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY,
  hotel text,
  organization_slug text,
  room_number text,
  status text,
  is_checkout_room boolean,
  towel_change_required boolean,
  linen_change_required boolean,
  is_dnd boolean,
  dnd_marked_at timestamptz,
  notes text,
  pms_metadata jsonb default '{}'::jsonb
);

CREATE TABLE public.housekeeping_notes (
  id uuid PRIMARY KEY,
  room_id uuid,
  note_type text,
  created_at timestamptz
);

CREATE TABLE public.room_assignments (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  assigned_to uuid,
  assigned_by uuid,
  assignment_date date NOT NULL,
  assignment_type text,
  status text,
  priority integer default 1,
  estimated_duration integer,
  organization_slug text,
  ready_to_clean boolean default false,
  supervisor_approved boolean,
  created_at timestamptz default now(),
  updated_at timestamptz,
  is_dnd boolean,
  dnd_attempt_count integer,
  notes text,
  manager_instruction_text text,
  service_result text
);

CREATE TABLE public.housekeeping_room_snapshots (
  id uuid PRIMARY KEY,
  business_date date NOT NULL,
  room_id uuid NOT NULL,
  hotel text,
  organization_slug text,
  room_number text,
  room_status text,
  is_checkout_room boolean,
  is_dnd boolean,
  towel_change_required boolean,
  linen_change_required boolean,
  room_notes text,
  pms_metadata jsonb,
  had_dnd boolean,
  had_no_service boolean,
  had_room_cleaning_request boolean,
  had_extra_towels_request boolean,
  had_ready_to_clean boolean,
  assignment_notes text,
  source text,
  updated_at timestamptz default now()
);

CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job(jobid serial primary key, jobname text unique);
CREATE OR REPLACE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO cron.job(jobname) VALUES ($1)
  ON CONFLICT(jobname) DO UPDATE SET jobname=excluded.jobname
  RETURNING jobid INTO v_id;
  RETURN v_id;
END $$;

CREATE TABLE public._extensions(name text);
